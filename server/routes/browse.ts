import type TheMovieDb from '@server/api/themoviedb';
import type { TvSortOptions } from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbMovieResult,
  TmdbTvDetails,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import {
  BROWSE_DEFAULT_REGION,
  BROWSE_GENRES,
  BROWSE_RATING_MIN_VOTES,
  BROWSE_SERIES_STATUSES,
  BROWSE_SORTS,
  BROWSE_STATUSES,
  BROWSE_TYPES,
  type BrowseGenreId,
  type BrowseSort,
} from '@server/constants/browse';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  mapMovieDetailsToResult,
  mapMovieResult,
  mapTvDetailsToResult,
  mapTvResult,
} from '@server/models/Search';
import { createTmdbWithRegionLanguage } from '@server/routes/discover';
import { Router } from 'express';
import { In } from 'typeorm';
import { z } from 'zod';

const PAGE_SIZE = 20;
const TMDB_PAGE_SIZE = 20;
// TMDB never returns pages past 500
const MAX_TMDB_PAGE = 500;
// Upper bound of TMDB pages read per request when filters drop most results
const MAX_FETCHES = 6;
const DETAILS_CONCURRENCY = 10;
// TMDB search pages checked when filtering the library by name
const LIBRARY_SEARCH_PAGES = 3;

const csv = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(/[,|]/)
          .map((part) => part.trim())
          .filter(Boolean)
      : []
  );
const csvNumbers = csv.pipe(
  z.array(z.string().regex(/^\d+$/).transform(Number))
);
const optionalNumber = z.coerce.number().optional();

const BrowseQuerySchema = z.object({
  type: z.enum(BROWSE_TYPES).default('all'),
  sortBy: z.enum(BROWSE_SORTS).optional(),
  cursor: z.string().optional(),
  query: z.string().trim().optional(),
  releaseDateGte: z.string().optional(),
  releaseDateLte: z.string().optional(),
  genres: csv.pipe(
    z.array(z.enum(Object.keys(BROWSE_GENRES) as [BrowseGenreId]))
  ),
  excludeGenres: csv.pipe(
    z.array(z.enum(Object.keys(BROWSE_GENRES) as [BrowseGenreId]))
  ),
  keywords: csvNumbers,
  excludeKeywords: csvNumbers,
  language: z.string().optional(),
  withRuntimeGte: optionalNumber,
  withRuntimeLte: optionalNumber,
  voteAverageGte: optionalNumber,
  voteAverageLte: optionalNumber,
  voteCountGte: optionalNumber,
  voteCountLte: optionalNumber,
  certifications: csv,
  excludeCertifications: csv,
  watchProviders: csvNumbers,
  excludeWatchProviders: csvNumbers,
  studios: csvNumbers,
  seriesStatus: csvNumbers,
  excludeSeriesStatus: csvNumbers,
  status: z.enum(BROWSE_STATUSES).optional(),
  // The OpenAPI validator already turns it into a boolean
  watchlist: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((value) => value === true || value === 'true'),
});

type BrowseQuery = z.infer<typeof BrowseQuerySchema>;
type ItemType = 'movie' | 'tv';

type Item =
  | { mediaType: 'movie'; result: TmdbMovieResult }
  | { mediaType: 'tv'; result: TmdbTvResult };

type Details =
  | { mediaType: 'movie'; details: TmdbMovieDetails }
  | { mediaType: 'tv'; details: TmdbTvDetails };

interface StreamPosition {
  page: number;
  index: number;
  done?: boolean;
}

type Cursor =
  | { streams: Partial<Record<string, StreamPosition>> }
  | { offset: number };

interface Stream {
  key: string;
  fetch: (page: number) => Promise<{ items: Item[]; totalPages: number }>;
}

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeCursor = (cursor?: string): Cursor | undefined => {
  if (!cursor) {
    return undefined;
  }

  const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());

  if (
    typeof decoded !== 'object' ||
    !decoded ||
    !(
      typeof decoded.offset === 'number' ||
      (typeof decoded.streams === 'object' && decoded.streams)
    )
  ) {
    throw new Error('Invalid cursor');
  }

  return decoded;
};

const getRegion = (user?: User): string => {
  const userRegion = user?.settings?.streamingRegion;

  return (
    (userRegion && userRegion !== 'all' ? userRegion : undefined) ||
    getSettings().main.discoverRegion ||
    BROWSE_DEFAULT_REGION
  );
};

const releaseDate = (item: Item): string =>
  (item.mediaType === 'movie'
    ? item.result.release_date
    : item.result.first_air_date) ?? '';

// Negative when `a` comes first. Titles without a date always go last.
const compareItems =
  (sortBy: BrowseSort) =>
  (a: Item, b: Item): number => {
    switch (sortBy) {
      case 'release_date.desc':
      case 'release_date.asc': {
        const dateA = releaseDate(a);
        const dateB = releaseDate(b);

        if (!dateA || !dateB) {
          return dateA ? -1 : dateB ? 1 : 0;
        }

        const order = dateA.localeCompare(dateB);
        return sortBy === 'release_date.asc' ? order : -order;
      }
      case 'vote_average.desc':
        return b.result.vote_average - a.result.vote_average;
      default:
        return b.result.popularity - a.result.popularity;
    }
  };

const genreIds = (genres: BrowseGenreId[], type: ItemType): number[] => [
  ...new Set(genres.flatMap((genre) => BROWSE_GENRES[genre][type])),
];

const hasFilters = (query: BrowseQuery): boolean =>
  !!(
    query.query ||
    query.releaseDateGte ||
    query.releaseDateLte ||
    query.genres.length ||
    query.keywords.length ||
    query.excludeKeywords.length ||
    query.language ||
    query.withRuntimeGte !== undefined ||
    query.withRuntimeLte !== undefined ||
    query.voteAverageGte !== undefined ||
    query.voteAverageLte !== undefined ||
    query.voteCountGte !== undefined ||
    query.voteCountLte !== undefined ||
    query.excludeGenres.length ||
    query.certifications.length ||
    query.excludeCertifications.length ||
    query.watchProviders.length ||
    query.excludeWatchProviders.length ||
    query.studios.length ||
    query.seriesStatus.length ||
    query.excludeSeriesStatus.length ||
    query.status ||
    query.watchlist
  );

// Filters checked against the title details, for search and library results
const hasDetailFilters = (query: BrowseQuery): boolean =>
  hasFilters({
    ...query,
    query: undefined,
    status: undefined,
    watchlist: false,
  });

const toDate = (value?: string): string | undefined =>
  value ? new Date(value).toISOString().split('T')[0] : undefined;

const inRange = (value: number | undefined, gte?: number, lte?: number) =>
  (gte === undefined && lte === undefined) ||
  (value !== undefined &&
    (gte === undefined || value >= gte) &&
    (lte === undefined || value <= lte));

const normalizeText = (text = ''): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const matchesDetails = (
  { mediaType, details }: Details,
  query: BrowseQuery,
  region: string
): boolean => {
  const date =
    mediaType === 'movie' ? details.release_date : details.first_air_date;
  const releaseGte = toDate(query.releaseDateGte);
  const releaseLte = toDate(query.releaseDateLte);

  if (
    (releaseGte && (!date || date < releaseGte)) ||
    (releaseLte && (!date || date > releaseLte))
  ) {
    return false;
  }

  if (query.genres.length) {
    const wanted = genreIds(query.genres, mediaType);

    if (!details.genres.some((genre) => wanted.includes(genre.id))) {
      return false;
    }
  }

  if (query.excludeGenres.length) {
    const unwanted = genreIds(query.excludeGenres, mediaType);

    if (details.genres.some((genre) => unwanted.includes(genre.id))) {
      return false;
    }
  }

  const keywords = (
    mediaType === 'movie'
      ? details.keywords?.keywords
      : details.keywords?.results
  )?.map((keyword) => keyword.id);

  if (
    query.keywords.some((keyword) => !keywords?.includes(keyword)) ||
    query.excludeKeywords.some((keyword) => keywords?.includes(keyword))
  ) {
    return false;
  }

  if (query.language && details.original_language !== query.language) {
    return false;
  }

  const runtime =
    mediaType === 'movie' ? details.runtime : details.episode_run_time?.[0];

  if (
    !inRange(runtime, query.withRuntimeGte, query.withRuntimeLte) ||
    !inRange(
      details.vote_average,
      query.voteAverageGte,
      query.voteAverageLte
    ) ||
    !inRange(details.vote_count, query.voteCountGte, query.voteCountLte)
  ) {
    return false;
  }

  if (query.certifications.length || query.excludeCertifications.length) {
    const certification =
      mediaType === 'movie'
        ? details.release_dates?.results
            .find((release) => release.iso_3166_1 === region)
            ?.release_dates.find((date) => date.certification)?.certification
        : details.content_ratings?.results.find(
            (rating) => rating.iso_3166_1 === region
          )?.rating;

    if (
      query.certifications.length &&
      (!certification || !query.certifications.includes(certification))
    ) {
      return false;
    }

    if (certification && query.excludeCertifications.includes(certification)) {
      return false;
    }
  }

  if (query.watchProviders.length) {
    const providers =
      details['watch/providers']?.results?.[region]?.flatrate ?? [];

    if (
      !providers.some((provider) =>
        query.watchProviders.includes(provider.provider_id)
      )
    ) {
      return false;
    }
  }

  if (query.excludeWatchProviders.length) {
    const providers =
      details['watch/providers']?.results?.[region]?.flatrate ?? [];

    if (
      providers.some((provider) =>
        query.excludeWatchProviders.includes(provider.provider_id)
      )
    ) {
      return false;
    }
  }

  if (
    query.studios.length &&
    !details.production_companies.some((company) =>
      query.studios.includes(company.id)
    )
  ) {
    return false;
  }

  if (
    query.seriesStatus.length &&
    (mediaType !== 'tv' ||
      !query.seriesStatus.some(
        (status) => BROWSE_SERIES_STATUSES[status] === details.status
      ))
  ) {
    return false;
  }

  if (
    mediaType === 'tv' &&
    query.excludeSeriesStatus.some(
      (status) => BROWSE_SERIES_STATUSES[status] === details.status
    )
  ) {
    return false;
  }

  return true;
};

const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await mapper(items[index]);
      }
    })
  );

  return results;
};

// Cached by the TMDB client (12 hours)
const getDetails = async (
  tmdb: TheMovieDb,
  item: { mediaType: ItemType; tmdbId: number },
  language: string
): Promise<Details | undefined> => {
  try {
    return item.mediaType === 'movie'
      ? {
          mediaType: 'movie',
          details: await tmdb.getMovie({ movieId: item.tmdbId, language }),
        }
      : {
          mediaType: 'tv',
          details: await tmdb.getTvShow({ tvId: item.tmdbId, language }),
        };
  } catch {
    // Removed from TMDB
    return undefined;
  }
};

const detailsToItem = (details: Details): Item =>
  details.mediaType === 'movie'
    ? { mediaType: 'movie', result: mapMovieDetailsToResult(details.details) }
    : { mediaType: 'tv', result: mapTvDetailsToResult(details.details) };

// Position of the next item of a stream, counted from its first result
const rankOf = (position: StreamPosition): number =>
  (position.page - 1) * TMDB_PAGE_SIZE + position.index;

// Merges sorted TMDB result streams into one page, keeping a position for each.
// 'rank' alternates between streams by position: TMDB popularity is not on the
// same scale for movies and series (series are several times higher), so
// comparing it would list every series before the first movie.
const mergeStreams = async (
  streams: Stream[],
  positions: Partial<Record<string, StreamPosition>>,
  compare: ((a: Item, b: Item) => number) | 'rank'
): Promise<{ items: Item[]; positions: Record<string, StreamPosition> }> => {
  const state = streams.map((stream) => ({
    stream,
    position: { ...(positions[stream.key] ?? { page: 1, index: 0 }) },
    items: [] as Item[],
    totalPages: 0,
  }));
  let fetches = 0;

  const load = async (entry: (typeof state)[number]) => {
    fetches++;
    const page = await entry.stream.fetch(entry.position.page);
    entry.items = page.items;
    entry.totalPages = Math.min(page.totalPages, MAX_TMDB_PAGE);
  };

  // Moves past exhausted pages; false when out of fetch budget
  const settle = async (entry: (typeof state)[number]): Promise<boolean> => {
    while (!entry.position.done && entry.position.index >= entry.items.length) {
      if (entry.position.page >= entry.totalPages) {
        entry.position.done = true;
      } else if (fetches >= MAX_FETCHES) {
        return false;
      } else {
        entry.position.page++;
        entry.position.index = 0;
        await load(entry);
      }
    }

    return true;
  };

  await Promise.all(state.map((entry) => !entry.position.done && load(entry)));

  const items: Item[] = [];

  while (items.length < PAGE_SIZE) {
    const settled = await Promise.all(state.map(settle));

    // A stream still loading could hold the next item: stop here
    if (settled.includes(false)) {
      break;
    }

    let best: (typeof state)[number] | undefined;

    for (const entry of state) {
      if (
        !entry.position.done &&
        (!best ||
          (compare === 'rank'
            ? rankOf(entry.position) < rankOf(best.position)
            : compare(
                entry.items[entry.position.index],
                best.items[best.position.index]
              ) < 0))
      ) {
        best = entry;
      }
    }

    if (!best) {
      break;
    }

    items.push(best.items[best.position.index]);
    best.position.index++;
  }

  return {
    items,
    positions: Object.fromEntries(
      state.map((entry) => [entry.stream.key, entry.position])
    ),
  };
};

const getLibraryCandidates = async (
  query: BrowseQuery,
  user?: User
): Promise<{ mediaType: ItemType; tmdbId: number }[]> => {
  let candidates: { mediaType: ItemType; tmdbId: number }[] | undefined;

  if (query.status) {
    const media = await getRepository(Media).find({
      select: ['tmdbId', 'mediaType'],
      where: {
        status: In(
          query.status === 'available'
            ? [MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE]
            : [MediaStatus.PENDING, MediaStatus.PROCESSING]
        ),
      },
    });

    candidates = media.map((item) => ({
      mediaType: item.mediaType === MediaType.MOVIE ? 'movie' : 'tv',
      tmdbId: item.tmdbId,
    }));
  }

  if (query.watchlist) {
    const watchlist = user
      ? await getRepository(Watchlist).find({
          select: ['tmdbId', 'mediaType'],
          where: { requestedBy: { id: user.id } },
        })
      : [];
    const onWatchlist = new Set(
      watchlist.map((item) => `${item.mediaType}:${item.tmdbId}`)
    );

    candidates = candidates
      ? candidates.filter((item) =>
          onWatchlist.has(`${item.mediaType}:${item.tmdbId}`)
        )
      : watchlist.map((item) => ({
          mediaType: item.mediaType === MediaType.MOVIE ? 'movie' : 'tv',
          tmdbId: item.tmdbId,
        }));
  }

  return candidates ?? [];
};

const browseRoutes = Router();

browseRoutes.get('/', async (req, res, next) => {
  const parsed = BrowseQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return next({
      status: 400,
      message: `Invalid query: ${parsed.error.issues
        .map((issue) => issue.path.join('.'))
        .join(', ')}`,
    });
  }

  const query = parsed.data;
  let cursor: Cursor | undefined;

  try {
    cursor = decodeCursor(query.cursor);
  } catch {
    return next({ status: 400, message: 'Invalid cursor.' });
  }

  const tmdb = createTmdbWithRegionLanguage(req.user);
  const language = req.locale ?? 'en';
  const region = getRegion(req.user);

  // Series-only filters restrict the list to series
  const seriesOnly = query.seriesStatus.length > 0;
  const types = (query.type === 'all' ? ['movie', 'tv'] : [query.type])
    .filter((type) => !seriesOnly || type === 'tv')
    .filter(
      (type) =>
        !query.genres.length || genreIds(query.genres, type as ItemType).length
    ) as ItemType[];
  const sortBy = query.sortBy ?? 'popularity.desc';

  try {
    let items: Item[] = [];
    let nextCursor: Cursor | undefined;
    let mode: 'trending' | 'discover' | 'search' | 'library';

    if (query.status || query.watchlist) {
      mode = 'library';
      const offset = cursor && 'offset' in cursor ? cursor.offset : 0;
      const candidates = (await getLibraryCandidates(query, req.user)).filter(
        (item) => types.includes(item.mediaType)
      );
      const details = await mapLimit(candidates, DETAILS_CONCURRENCY, (item) =>
        getDetails(tmdb, item, language)
      );
      const name = normalizeText(query.query);
      // TMDB search also matches translated titles
      const searchMatches = new Set(
        query.query
          ? (
              await Promise.all(
                Array.from({ length: LIBRARY_SEARCH_PAGES }, (_, index) =>
                  tmdb.searchMulti({
                    query: query.query as string,
                    page: index + 1,
                    language,
                  })
                )
              )
            ).flatMap((data) =>
              data.results.map((result) => `${result.media_type}:${result.id}`)
            )
          : []
      );
      const matches = details
        .filter((item): item is Details => !!item)
        .filter(
          (item) =>
            !name ||
            searchMatches.has(`${item.mediaType}:${item.details.id}`) ||
            [
              'title' in item.details ? item.details.title : item.details.name,
              'original_title' in item.details
                ? item.details.original_title
                : item.details.original_name,
            ].some((title) => normalizeText(title).includes(name))
        )
        .filter((item) => matchesDetails(item, query, region))
        .map(detailsToItem)
        .sort(compareItems(sortBy));

      items = matches.slice(offset, offset + PAGE_SIZE);
      nextCursor =
        offset + PAGE_SIZE < matches.length
          ? { offset: offset + PAGE_SIZE }
          : undefined;
    } else {
      let streams: Stream[];
      // Search results keep TMDB's relevance order
      let compare: ((a: Item, b: Item) => number) | 'rank' =
        sortBy === 'popularity.desc' ? 'rank' : compareItems(sortBy);

      if (query.query) {
        mode = 'search';
        const searchType = types.length === 2 ? 'all' : types[0];
        const filterDetails = hasDetailFilters(query);
        compare = () => 0;

        streams = !searchType
          ? []
          : [
              {
                key: searchType,
                fetch: async (page) => {
                  const data =
                    searchType === 'movie'
                      ? await tmdb.searchMovies({
                          query: query.query as string,
                          page,
                          language,
                        })
                      : searchType === 'tv'
                        ? await tmdb.searchTvShows({
                            query: query.query as string,
                            page,
                            language,
                          })
                        : await tmdb.searchMulti({
                            query: query.query as string,
                            page,
                            language,
                          });
                  const found = data.results
                    .map((result) => ({
                      mediaType: (result.media_type ?? searchType) as string,
                      result,
                    }))
                    .filter((item): item is Item =>
                      types.includes(item.mediaType as ItemType)
                    );

                  if (!filterDetails) {
                    return { items: found, totalPages: data.total_pages };
                  }

                  const details = await mapLimit(
                    found,
                    DETAILS_CONCURRENCY,
                    (item) =>
                      getDetails(
                        tmdb,
                        { mediaType: item.mediaType, tmdbId: item.result.id },
                        language
                      )
                  );

                  return {
                    items: found.filter((_item, index) => {
                      const itemDetails = details[index];
                      return (
                        !!itemDetails &&
                        matchesDetails(itemDetails, query, region)
                      );
                    }),
                    totalPages: data.total_pages,
                  };
                },
              },
            ];
      } else if (!hasFilters(query) && !query.sortBy) {
        mode = 'trending';
        const trendingType = types.length === 2 ? 'all' : types[0];

        streams = [
          {
            key: trendingType,
            fetch: async (page) => {
              const data =
                trendingType === 'movie'
                  ? await tmdb.getMovieTrending({ page, language })
                  : trendingType === 'tv'
                    ? await tmdb.getTvTrending({ page, language })
                    : await tmdb.getAllTrending({ page, language });

              return {
                items: data.results
                  .map((result) => ({
                    mediaType: (result.media_type ?? trendingType) as string,
                    result,
                  }))
                  .filter((item): item is Item =>
                    types.includes(item.mediaType as ItemType)
                  ),
                totalPages: data.total_pages,
              };
            },
          },
        ];
        compare = () => 0;
      } else {
        mode = 'discover';

        // TMDB has no "without" for these: send what is left after the
        // exclusions (an excluded rating only exists in the region's list)
        const regionCertifications = query.excludeCertifications.length
          ? [
              ...new Set(
                [
                  ...(await tmdb.getMovieCertifications()).certifications[
                    region
                  ],
                  ...(await tmdb.getTvCertifications()).certifications[region],
                ].map((item) => item.certification)
              ),
            ]
          : [];
        const certifications = (
          query.certifications.length
            ? query.certifications
            : regionCertifications
        ).filter((item) => !query.excludeCertifications.includes(item));
        const seriesStatuses = (
          query.seriesStatus.length
            ? query.seriesStatus
            : query.excludeSeriesStatus.length
              ? Object.keys(BROWSE_SERIES_STATUSES).map(Number)
              : []
        ).filter((item) => !query.excludeSeriesStatus.includes(item));
        const watchProviders = query.watchProviders.filter(
          (item) => !query.excludeWatchProviders.includes(item)
        );
        const hasProviders =
          watchProviders.length || query.excludeWatchProviders.length;

        const common = {
          language,
          originalLanguage: query.language,
          keywords: query.keywords.join(',') || undefined,
          excludeKeywords: query.excludeKeywords.join(',') || undefined,
          withRuntimeGte: query.withRuntimeGte?.toString(),
          withRuntimeLte: query.withRuntimeLte?.toString(),
          voteAverageGte: query.voteAverageGte?.toString(),
          voteAverageLte: query.voteAverageLte?.toString(),
          voteCountGte: (
            query.voteCountGte ??
            (sortBy === 'vote_average.desc'
              ? BROWSE_RATING_MIN_VOTES
              : undefined)
          )?.toString(),
          voteCountLte: query.voteCountLte?.toString(),
          studio: query.studios.join('|') || undefined,
          watchProviders: watchProviders.join('|') || undefined,
          excludeWatchProviders:
            query.excludeWatchProviders.join('|') || undefined,
          watchRegion: hasProviders ? region : undefined,
          watchMonetizationTypes: hasProviders ? 'flatrate' : undefined,
          certification: certifications.join('|') || undefined,
          certificationCountry: certifications.length ? region : undefined,
        };

        streams = types.map((type) => ({
          key: type,
          fetch: async (page) => {
            const genre = genreIds(query.genres, type).join('|') || undefined;
            const excludeGenre =
              genreIds(query.excludeGenres, type).join('|') || undefined;
            const data =
              type === 'movie'
                ? await tmdb.getDiscoverMovies({
                    ...common,
                    page,
                    sortBy,
                    genre,
                    excludeGenre,
                    primaryReleaseDateGte: toDate(query.releaseDateGte),
                    primaryReleaseDateLte: toDate(query.releaseDateLte),
                  })
                : await tmdb.getDiscoverTv({
                    ...common,
                    page,
                    sortBy: sortBy.replace(
                      'release_date',
                      'first_air_date'
                    ) as TvSortOptions,
                    genre,
                    excludeGenre,
                    firstAirDateGte: toDate(query.releaseDateGte),
                    firstAirDateLte: toDate(query.releaseDateLte),
                    withStatus: seriesStatuses.join('|') || undefined,
                  });

            return {
              items: data.results.map(
                (result) => ({ mediaType: type, result }) as Item
              ),
              totalPages: data.total_pages,
            };
          },
        }));
      }

      const merged = await mergeStreams(
        streams,
        cursor && 'streams' in cursor ? cursor.streams : {},
        compare
      );

      items = merged.items;
      nextCursor = Object.values(merged.positions).every(
        (position) => position.done
      )
        ? undefined
        : { streams: merged.positions };
    }

    const media = await Media.getRelatedMedia(
      req.user,
      items.map((item) => ({
        tmdbId: item.result.id,
        mediaType: item.mediaType,
      })),
      { includeActiveRequest: true }
    );
    const findMedia = (item: Item) =>
      media.find(
        (med) =>
          med.tmdbId === item.result.id && med.mediaType === item.mediaType
      );

    return res.status(200).json({
      mode,
      seriesOnly,
      nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
      results: items.map((item) =>
        item.mediaType === 'movie'
          ? mapMovieResult(item.result, findMedia(item))
          : mapTvResult(item.result, findMedia(item))
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving the browse list', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve the browse list.',
    });
  }
});

export default browseRoutes;
