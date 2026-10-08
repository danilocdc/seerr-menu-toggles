// Browse page: one list of movies and series with filters that apply to both

export const BROWSE_TYPES = ['all', 'movie', 'tv'] as const;
export type BrowseType = (typeof BROWSE_TYPES)[number];

export const BROWSE_SORTS = [
  'popularity.desc',
  'release_date.desc',
  'release_date.asc',
  'vote_average.desc',
] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];

export const BROWSE_STATUSES = ['requested', 'available'] as const;
export type BrowseStatus = (typeof BROWSE_STATUSES)[number];

// TMDB `with_status` codes; the details endpoint returns the names
export const BROWSE_SERIES_STATUSES: Record<number, string> = {
  0: 'Returning Series',
  1: 'Planned',
  2: 'In Production',
  3: 'Ended',
  4: 'Canceled',
  5: 'Pilot',
};

// One genre list for movies and series. A genre matches every TMDB genre that
// contains it ("Action" = movie Action + series Action & Adventure); a type
// with no matching TMDB genre has no results for that genre.
export const BROWSE_GENRES = {
  action: { name: 'Action', movie: [28], tv: [10759] },
  adventure: { name: 'Adventure', movie: [12], tv: [10759] },
  animation: { name: 'Animation', movie: [16], tv: [16] },
  comedy: { name: 'Comedy', movie: [35], tv: [35] },
  crime: { name: 'Crime', movie: [80], tv: [80] },
  documentary: { name: 'Documentary', movie: [99], tv: [99] },
  drama: { name: 'Drama', movie: [18], tv: [18] },
  family: { name: 'Family', movie: [10751], tv: [10751] },
  fantasy: { name: 'Fantasy', movie: [14], tv: [10765] },
  history: { name: 'History', movie: [36], tv: [] },
  horror: { name: 'Horror', movie: [27], tv: [] },
  kids: { name: 'Kids', movie: [10751, 16], tv: [10762] },
  music: { name: 'Music', movie: [10402], tv: [] },
  mystery: { name: 'Mystery', movie: [9648], tv: [9648] },
  news: { name: 'News', movie: [], tv: [10763] },
  politics: { name: 'Politics', movie: [], tv: [10768] },
  reality: { name: 'Reality', movie: [], tv: [10764] },
  romance: { name: 'Romance', movie: [10749], tv: [] },
  scifi: { name: 'Science Fiction', movie: [878], tv: [10765] },
  soap: { name: 'Soap', movie: [], tv: [10766] },
  talk: { name: 'Talk', movie: [], tv: [10767] },
  thriller: { name: 'Thriller', movie: [53], tv: [] },
  tvMovie: { name: 'TV Movie', movie: [10770], tv: [] },
  war: { name: 'War', movie: [10752], tv: [10768] },
  western: { name: 'Western', movie: [37], tv: [37] },
} as const satisfies Record<
  string,
  { name: string; movie: readonly number[]; tv: readonly number[] }
>;
export type BrowseGenreId = keyof typeof BROWSE_GENRES;

// Used when no region is set for the user or the server
export const BROWSE_DEFAULT_REGION = 'BR';

// Sorting by rating without a vote count filter puts titles with a single
// 10/10 vote first
export const BROWSE_RATING_MIN_VOTES = 100;
