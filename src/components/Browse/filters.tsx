import CachedImage from '@app/components/Common/CachedImage';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import MultiRangeSlider from '@app/components/Common/MultiRangeSlider';
import Tooltip from '@app/components/Common/Tooltip';
import { KeywordSelector } from '@app/components/Selector';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import type { TmdbCompanySearchResponse } from '@server/api/themoviedb/interfaces';
import {
  BROWSE_DEFAULT_REGION,
  BROWSE_GENRES,
  BROWSE_SERIES_STATUSES,
  type BrowseGenreId,
} from '@server/constants/browse';
import type { Language } from '@server/lib/settings';
import type {
  Keyword,
  ProductionCompany,
  WatchProviderDetails,
} from '@server/models/common';
import axios from 'axios';
import orderBy from 'lodash/orderBy';
import { useCallback, useMemo } from 'react';
import type { IntlShape } from 'react-intl';
import { useIntl } from 'react-intl';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import useSWR from 'swr';

export const messages = defineMessages('components.Browse', {
  browse: 'Browse',
  addFilter: 'Add Filter',
  removeFilter: 'Remove filter',
  apply: 'Apply',
  query: 'Name',
  releaseDate: 'Release Date',
  genres: 'Genres',
  keywords: 'Keywords',
  excludeKeywords: 'Exclude Keywords',
  language: 'Original Language',
  certifications: 'Content Rating',
  runtime: 'Runtime',
  voteAverage: 'TMDB User Score',
  voteCount: 'TMDB User Vote Count',
  watchProviders: 'Streaming Services',
  studios: 'Studio',
  seriesStatus: 'Series Status',
  status: 'Status',
  watchlist: 'On My List',
  from: 'From',
  to: 'To',
  fromValue: 'from {value}',
  toValue: 'until {value}',
  rangeValue: '{min} – {max}',
  atLeast: '≥ {value}',
  atMost: '≤ {value}',
  minutes: '{value} min',
  seriesOnly: '{value} (series only)',
  seriesOnlyHint:
    'Included statuses only apply to series: movies are hidden while one is included. Excluded statuses keep movies.',
  triStateHint:
    'Click once to include, twice to exclude, three times to clear.',
  notValue: 'not {value}',
  queryPlaceholder: 'Title in any language…',
  selectLanguage: 'Select a language…',
  searchStudios: 'Search studios…',
  startTyping: 'Start typing to search.',
  noOptions: 'No results.',
  certificationsHint: 'Ratings for {region}.',
  watchProvidersHint: 'Subscription services in {region}.',
  runtimeText: '{minValue}–{maxValue} minute runtime',
  voteAverageText: 'Score between {minValue} and {maxValue}',
  voteCountText: 'Number of votes between {minValue} and {maxValue}',
});

export const BROWSE_PARAMS = [
  'query',
  'releaseDateGte',
  'releaseDateLte',
  'genres',
  'excludeGenres',
  'keywords',
  'excludeKeywords',
  'language',
  'certifications',
  'excludeCertifications',
  'withRuntimeGte',
  'withRuntimeLte',
  'voteAverageGte',
  'voteAverageLte',
  'voteCountGte',
  'voteCountLte',
  'watchProviders',
  'excludeWatchProviders',
  'studios',
  'seriesStatus',
  'excludeSeriesStatus',
  'status',
  'watchlist',
] as const;
export type BrowseParam = (typeof BROWSE_PARAMS)[number];
export type BrowseValues = Partial<Record<BrowseParam, string>>;

// Order of the "Add Filter" menu
export const BROWSE_FILTERS = [
  { id: 'query', params: ['query'] },
  { id: 'genres', params: ['genres', 'excludeGenres'] },
  { id: 'releaseDate', params: ['releaseDateGte', 'releaseDateLte'] },
  { id: 'watchProviders', params: ['watchProviders', 'excludeWatchProviders'] },
  { id: 'status', params: ['status'] },
  { id: 'watchlist', params: ['watchlist'] },
  { id: 'language', params: ['language'] },
  { id: 'certifications', params: ['certifications', 'excludeCertifications'] },
  { id: 'runtime', params: ['withRuntimeGte', 'withRuntimeLte'] },
  { id: 'voteAverage', params: ['voteAverageGte', 'voteAverageLte'] },
  { id: 'voteCount', params: ['voteCountGte', 'voteCountLte'] },
  { id: 'keywords', params: ['keywords'] },
  { id: 'excludeKeywords', params: ['excludeKeywords'] },
  { id: 'studios', params: ['studios'] },
  { id: 'seriesStatus', params: ['seriesStatus', 'excludeSeriesStatus'] },
] as const satisfies readonly { id: string; params: readonly BrowseParam[] }[];
export type BrowseFilter = (typeof BROWSE_FILTERS)[number];

// Same ranges as the upstream filter slide-over
const RANGES = {
  runtime: { min: 0, max: 400 },
  voteAverage: { min: 1, max: 10 },
  voteCount: { min: 0, max: 1000 },
};

export const splitList = (value?: string): string[] =>
  value ? value.split(/[,|]/).filter(Boolean) : [];

export const isFilterActive = (filter: BrowseFilter, values: BrowseValues) =>
  filter.params.some((param) => !!values[param]);

// Same rule as the endpoint: the user's streaming region, then the server's
export const useBrowseRegion = (): string => {
  const { user } = useUser();
  const { currentSettings } = useSettings();
  const userRegion = user?.settings?.streamingRegion;

  return (
    (userRegion && userRegion !== 'all' ? userRegion : undefined) ||
    currentSettings.discoverRegion ||
    BROWSE_DEFAULT_REGION
  );
};

const fetchAll = <T,>(urls: string[]): Promise<T[]> =>
  Promise.all(urls.map((url) => axios.get<T>(url).then((res) => res.data)));

// Names of the keywords or studios in a filter
const useNames = (path: 'keyword' | 'studio', value?: string) => {
  const ids = splitList(value);
  const { data } = useSWR<(Keyword | ProductionCompany | null)[]>(
    ids.length ? ids.map((id) => `/api/v1/${path}/${id}`) : null,
    fetchAll
  );

  return ids.map(
    (id) => data?.find((item) => item?.id === Number(id))?.name ?? id
  );
};

// Movie and series providers of the region, merged
const useWatchProviders = (region: string, enabled = true) => {
  const { data: movie } = useSWR<WatchProviderDetails[]>(
    enabled ? `/api/v1/watchproviders/movies?watchRegion=${region}` : null
  );
  const { data: tv } = useSWR<WatchProviderDetails[]>(
    enabled ? `/api/v1/watchproviders/tv?watchRegion=${region}` : null
  );

  const providers = useMemo(() => {
    const merged = new Map<number, WatchProviderDetails>();
    [...(movie ?? []), ...(tv ?? [])].forEach((provider) => {
      if (!merged.has(provider.id)) {
        merged.set(provider.id, provider);
      }
    });
    return orderBy([...merged.values()], ['display_priority'], ['asc']);
  }, [movie, tv]);

  return { providers, isLoading: !movie || !tv };
};

interface CertificationsResponse {
  certifications: Record<
    string,
    { certification: string; meaning?: string; order?: number }[]
  >;
}

// Movie and series ratings of the region, merged
const useCertifications = (region: string, enabled = true) => {
  const { data: movie } = useSWR<CertificationsResponse>(
    enabled ? '/api/v1/certifications/movie' : null
  );
  const { data: tv } = useSWR<CertificationsResponse>(
    enabled ? '/api/v1/certifications/tv' : null
  );

  const certifications = useMemo(() => {
    const merged = new Map<string, number>();
    [
      ...(movie?.certifications[region] ?? []),
      ...(tv?.certifications[region] ?? []),
    ].forEach(({ certification, order }) => {
      if (!merged.has(certification)) {
        merged.set(certification, order ?? 0);
      }
    });
    return orderBy(
      [...merged.entries()].map(([certification, order]) => ({
        certification,
        order,
      })),
      ['order'],
      ['asc']
    ).map((item) => item.certification);
  }, [movie, tv, region]);

  return { certifications, isLoading: !movie || !tv };
};

const languageName = (intl: IntlShape, code: string) =>
  intl.formatDisplayName(code, { type: 'language', fallback: 'none' }) ?? code;

const formatDate = (intl: IntlShape, value: string) =>
  intl.formatDate(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const formatRange = (
  intl: IntlShape,
  min?: string,
  max?: string,
  format: (value: string) => string = (value) => value
) =>
  min && max
    ? intl.formatMessage(messages.rangeValue, {
        min: format(min),
        max: format(max),
      })
    : min
      ? intl.formatMessage(messages.atLeast, { value: format(min) })
      : intl.formatMessage(messages.atMost, { value: format(max ?? '') });

const genreName = (id: string) =>
  BROWSE_GENRES[id as BrowseGenreId]?.name ?? id;

// Text of a filter chip
export const FilterSummary = ({
  filter,
  values,
}: {
  filter: BrowseFilter;
  values: BrowseValues;
}) => {
  const intl = useIntl();
  const region = useBrowseRegion();
  const keywordNames = useNames(
    'keyword',
    filter.id === 'keywords'
      ? values.keywords
      : filter.id === 'excludeKeywords'
        ? values.excludeKeywords
        : undefined
  );
  const studioNames = useNames(
    'studio',
    filter.id === 'studios' ? values.studios : undefined
  );
  const { providers } = useWatchProviders(
    region,
    filter.id === 'watchProviders'
  );
  const list = (items: string[]) => intl.formatList(items);
  // "A, B, not C"
  const triList = (include: string[], exclude: string[]) =>
    list([
      ...include,
      ...exclude.map((item) =>
        intl.formatMessage(messages.notValue, { value: item })
      ),
    ]);

  const providerName = (id: string) =>
    providers.find((provider) => provider.id === Number(id))?.name ?? id;
  const statusName = (id: string) => BROWSE_SERIES_STATUSES[Number(id)] ?? id;

  const summary = (): string | undefined => {
    switch (filter.id) {
      case 'query':
        return `“${values.query}”`;
      case 'releaseDate':
        return values.releaseDateGte && values.releaseDateLte
          ? intl.formatMessage(messages.rangeValue, {
              min: formatDate(intl, values.releaseDateGte),
              max: formatDate(intl, values.releaseDateLte),
            })
          : values.releaseDateGte
            ? intl.formatMessage(messages.fromValue, {
                value: formatDate(intl, values.releaseDateGte),
              })
            : intl.formatMessage(messages.toValue, {
                value: formatDate(intl, values.releaseDateLte ?? ''),
              });
      case 'genres':
        return triList(
          splitList(values.genres).map(genreName),
          splitList(values.excludeGenres).map(genreName)
        );
      case 'keywords':
      case 'excludeKeywords':
        return list(keywordNames);
      case 'studios':
        return list(studioNames);
      case 'language':
        return languageName(intl, values.language ?? '');
      case 'certifications':
        return triList(
          splitList(values.certifications),
          splitList(values.excludeCertifications)
        );
      case 'runtime':
        return intl.formatMessage(messages.minutes, {
          value: formatRange(
            intl,
            values.withRuntimeGte,
            values.withRuntimeLte
          ),
        });
      case 'voteAverage':
        return formatRange(intl, values.voteAverageGte, values.voteAverageLte);
      case 'voteCount':
        return formatRange(intl, values.voteCountGte, values.voteCountLte);
      case 'watchProviders':
        return triList(
          splitList(values.watchProviders).map(providerName),
          splitList(values.excludeWatchProviders).map(providerName)
        );
      case 'seriesStatus': {
        const statuses = triList(
          splitList(values.seriesStatus).map(statusName),
          splitList(values.excludeSeriesStatus).map(statusName)
        );

        return values.seriesStatus
          ? intl.formatMessage(messages.seriesOnly, { value: statuses })
          : statuses;
      }
      case 'status':
        return intl.formatMessage(
          values.status === 'available'
            ? globalMessages.available
            : globalMessages.requested
        );
      default:
        return undefined;
    }
  };

  const text = summary();
  const label = intl.formatMessage(messages[filter.id]);

  return <>{text ? `${label}: ${text}` : label}</>;
};

type TriState = 'include' | 'exclude' | undefined;

// A list filter keeps its included items in one param and its excluded items
// in another; each click moves an item include -> exclude -> none
const triState = (
  values: BrowseValues,
  includeParam: BrowseParam,
  excludeParam: BrowseParam,
  item: string
): TriState =>
  splitList(values[includeParam]).includes(item)
    ? 'include'
    : splitList(values[excludeParam]).includes(item)
      ? 'exclude'
      : undefined;

const cycleTriState = (
  values: BrowseValues,
  includeParam: BrowseParam,
  excludeParam: BrowseParam,
  item: string
): BrowseValues => {
  const without = (param: BrowseParam) =>
    splitList(values[param])
      .filter((current) => current !== item)
      .join(',') || undefined;
  const withItem = (param: BrowseParam) =>
    [...splitList(values[param]), item].join(',');

  switch (triState(values, includeParam, excludeParam, item)) {
    case 'include':
      return {
        ...values,
        [includeParam]: without(includeParam),
        [excludeParam]: withItem(excludeParam),
      };
    case 'exclude':
      return { ...values, [excludeParam]: without(excludeParam) };
    default:
      return { ...values, [includeParam]: withItem(includeParam) };
  }
};

const pillClass = (state: TriState | boolean) =>
  `rounded-full border px-3 py-1 text-sm transition ${
    state === true || state === 'include'
      ? 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500'
      : state === 'exclude'
        ? 'border-red-500 bg-red-700 text-white line-through hover:bg-red-600'
        : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-400 hover:text-white'
  }`;

const TriStatePills = ({
  items,
  includeParam,
  excludeParam,
  values,
  setValues,
}: {
  items: { id: string; label: string }[];
  includeParam: BrowseParam;
  excludeParam: BrowseParam;
  values: BrowseValues;
  setValues: React.Dispatch<React.SetStateAction<BrowseValues>>;
}) => {
  const intl = useIntl();

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm text-gray-400">
        {intl.formatMessage(messages.triStateHint)}
      </span>
      <div className="flex flex-wrap gap-2">
        {items.map(({ id, label }) => {
          const state = triState(values, includeParam, excludeParam, id);

          return (
            <button
              key={id}
              type="button"
              className={pillClass(state)}
              onClick={() =>
                setValues((current) =>
                  cycleTriState(current, includeParam, excludeParam, id)
                )
              }
            >
              {state === 'include' && '✓ '}
              {state === 'exclude' && '✕ '}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const StudioSelector = ({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value?: string) => void;
}) => {
  const intl = useIntl();
  const ids = splitList(value);
  const names = useNames('studio', value);

  const loadOptions = async (inputValue: string) => {
    if (!inputValue) {
      return [];
    }

    const results = await axios.get<TmdbCompanySearchResponse>(
      '/api/v1/search/company',
      { params: { query: inputValue } }
    );

    return results.data.results.map((result) => ({
      label: result.name,
      value: result.id,
    }));
  };

  return (
    <AsyncSelect
      className="react-select-container"
      classNamePrefix="react-select"
      isMulti
      cacheOptions
      value={ids.map((id, index) => ({
        label: names[index],
        value: Number(id),
      }))}
      noOptionsMessage={({ inputValue }) =>
        intl.formatMessage(
          inputValue ? messages.noOptions : messages.startTyping
        )
      }
      loadOptions={loadOptions}
      placeholder={intl.formatMessage(messages.searchStudios)}
      onChange={(options) =>
        onChange(options.map((option) => option.value).join(',') || undefined)
      }
    />
  );
};

const LanguageSelect = ({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value?: string) => void;
}) => {
  const intl = useIntl();
  const { data: languages } = useSWR<Language[]>('/api/v1/languages');

  const options = useMemo(
    () =>
      orderBy(
        (languages ?? []).map((language) => ({
          value: language.iso_639_1,
          label:
            intl.formatDisplayName(language.iso_639_1, {
              type: 'language',
              fallback: 'none',
            }) ?? language.english_name,
        })),
        ['label'],
        ['asc']
      ),
    [intl, languages]
  );

  return (
    <Select
      className="react-select-container"
      classNamePrefix="react-select"
      options={options}
      isClearable
      isLoading={!languages}
      value={options.find((option) => option.value === value) ?? null}
      placeholder={intl.formatMessage(messages.selectLanguage)}
      onChange={(option) => onChange(option?.value)}
    />
  );
};

const RangeEditor = ({
  range,
  minParam,
  maxParam,
  values,
  setValues,
  text,
}: {
  range: { min: number; max: number };
  minParam: BrowseParam;
  maxParam: BrowseParam;
  values: BrowseValues;
  setValues: React.Dispatch<React.SetStateAction<BrowseValues>>;
  text: (min: number, max: number) => string;
}) => {
  // The slider calls these on every render where they change: keep them stable
  const update = useCallback(
    (param: BrowseParam, value: number, bound: number) =>
      setValues((current) => {
        const next = value === bound ? undefined : value.toString();
        return current[param] === next
          ? current
          : { ...current, [param]: next };
      }),
    [setValues]
  );
  const onUpdateMin = useCallback(
    (min: number) => update(minParam, min, range.min),
    [update, minParam, range.min]
  );
  const onUpdateMax = useCallback(
    (max: number) => update(maxParam, max, range.max),
    [update, maxParam, range.max]
  );
  const min = values[minParam] ? Number(values[minParam]) : undefined;
  const max = values[maxParam] ? Number(values[maxParam]) : undefined;

  return (
    <div className="relative z-0 pb-6 pt-4">
      <MultiRangeSlider
        min={range.min}
        max={range.max}
        defaultMinValue={min}
        defaultMaxValue={max}
        onUpdateMin={onUpdateMin}
        onUpdateMax={onUpdateMax}
        subText={text(min ?? range.min, max ?? range.max)}
      />
    </div>
  );
};

// Editor shown in the modal when a filter is added or its chip is clicked
export const FilterEditor = ({
  filter,
  values,
  setValues,
  onSubmit,
}: {
  filter: BrowseFilter;
  values: BrowseValues;
  setValues: React.Dispatch<React.SetStateAction<BrowseValues>>;
  onSubmit: () => void;
}) => {
  const intl = useIntl();
  const region = useBrowseRegion();
  const { providers, isLoading: providersLoading } = useWatchProviders(
    region,
    filter.id === 'watchProviders'
  );
  const { certifications, isLoading: certificationsLoading } =
    useCertifications(region, filter.id === 'certifications');
  const set = (param: BrowseParam, value?: string) =>
    setValues((current) => ({ ...current, [param]: value || undefined }));

  switch (filter.id) {
    case 'query':
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            type="search"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={values.query ?? ''}
            placeholder={intl.formatMessage(messages.queryPlaceholder)}
            onChange={(e) => set('query', e.target.value)}
          />
        </form>
      );
    case 'releaseDate':
      return (
        <div className="flex flex-col gap-4 sm:flex-row">
          {(
            [
              ['releaseDateGte', messages.from],
              ['releaseDateLte', messages.to],
            ] as const
          ).map(([param, label]) => (
            <label key={param} className="flex flex-1 flex-col gap-2">
              <span>{intl.formatMessage(label)}</span>
              <input
                type="date"
                value={values[param] ?? ''}
                onChange={(e) => set(param, e.target.value)}
              />
            </label>
          ))}
        </div>
      );
    case 'genres':
      return (
        <TriStatePills
          items={Object.entries(BROWSE_GENRES).map(([id, genre]) => ({
            id,
            label: genre.name,
          }))}
          includeParam="genres"
          excludeParam="excludeGenres"
          values={values}
          setValues={setValues}
        />
      );
    case 'keywords':
    case 'excludeKeywords':
      return (
        <KeywordSelector
          isMulti
          defaultValue={values[filter.id]}
          onChange={(options) =>
            set(filter.id, options?.map((option) => option.value).join(','))
          }
        />
      );
    case 'language':
      return (
        <LanguageSelect
          value={values.language}
          onChange={(value) => set('language', value)}
        />
      );
    case 'certifications':
      return (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-gray-400">
            {intl.formatMessage(messages.certificationsHint, { region })}
          </span>
          {certificationsLoading ? (
            <SmallLoadingSpinner />
          ) : (
            <TriStatePills
              items={certifications.map((certification) => ({
                id: certification,
                label: certification,
              }))}
              includeParam="certifications"
              excludeParam="excludeCertifications"
              values={values}
              setValues={setValues}
            />
          )}
        </div>
      );
    case 'runtime':
      return (
        <RangeEditor
          range={RANGES.runtime}
          minParam="withRuntimeGte"
          maxParam="withRuntimeLte"
          values={values}
          setValues={setValues}
          text={(minValue, maxValue) =>
            intl.formatMessage(messages.runtimeText, { minValue, maxValue })
          }
        />
      );
    case 'voteAverage':
      return (
        <RangeEditor
          range={RANGES.voteAverage}
          minParam="voteAverageGte"
          maxParam="voteAverageLte"
          values={values}
          setValues={setValues}
          text={(minValue, maxValue) =>
            intl.formatMessage(messages.voteAverageText, { minValue, maxValue })
          }
        />
      );
    case 'voteCount':
      return (
        <RangeEditor
          range={RANGES.voteCount}
          minParam="voteCountGte"
          maxParam="voteCountLte"
          values={values}
          setValues={setValues}
          text={(minValue, maxValue) =>
            intl.formatMessage(messages.voteCountText, { minValue, maxValue })
          }
        />
      );
    case 'watchProviders':
      return (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-gray-400">
            {intl.formatMessage(messages.watchProvidersHint, { region })}{' '}
            {intl.formatMessage(messages.triStateHint)}
          </span>
          {providersLoading ? (
            <SmallLoadingSpinner />
          ) : (
            <div className="provider-icons grid gap-2">
              {providers.map((provider) => {
                const state = triState(
                  values,
                  'watchProviders',
                  'excludeWatchProviders',
                  provider.id.toString()
                );
                return (
                  <Tooltip content={provider.name} key={provider.id}>
                    <button
                      type="button"
                      className={`provider-container relative w-full rounded-lg ring-1 ${
                        state === 'include'
                          ? 'bg-gray-600 ring-indigo-500 hover:bg-gray-500'
                          : state === 'exclude'
                            ? 'bg-red-900 ring-red-500 hover:bg-red-800'
                            : 'bg-gray-700 ring-gray-500 hover:bg-gray-600'
                      }`}
                      onClick={() =>
                        setValues((current) =>
                          cycleTriState(
                            current,
                            'watchProviders',
                            'excludeWatchProviders',
                            provider.id.toString()
                          )
                        )
                      }
                    >
                      <div className="relative m-2 aspect-1">
                        <CachedImage
                          type="tmdb"
                          src={`https://image.tmdb.org/t/p/original${provider.logoPath}`}
                          alt={provider.name}
                          fill
                          className={`rounded-lg object-contain ${
                            state === 'exclude' ? 'opacity-40 grayscale' : ''
                          }`}
                        />
                      </div>
                      {state && (
                        <div
                          className={`pointer-events-none absolute -left-1 -top-1 opacity-90 ${
                            state === 'exclude'
                              ? 'text-red-200'
                              : 'text-indigo-100'
                          }`}
                        >
                          {state === 'exclude' ? (
                            <XCircleIcon className="h-6 w-6" />
                          ) : (
                            <CheckCircleIcon className="h-6 w-6" />
                          )}
                        </div>
                      )}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      );
    case 'studios':
      return (
        <StudioSelector
          value={values.studios}
          onChange={(value) => set('studios', value)}
        />
      );
    case 'seriesStatus':
      return (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-gray-400">
            {intl.formatMessage(messages.seriesOnlyHint)}
          </span>
          <TriStatePills
            items={Object.entries(BROWSE_SERIES_STATUSES).map(([id, name]) => ({
              id,
              label: name,
            }))}
            includeParam="seriesStatus"
            excludeParam="excludeSeriesStatus"
            values={values}
            setValues={setValues}
          />
        </div>
      );
    case 'status':
      return (
        <div className="flex flex-wrap gap-2">
          {(
            [
              [undefined, globalMessages.all],
              ['requested', globalMessages.requested],
              ['available', globalMessages.available],
            ] as const
          ).map(([status, label]) => (
            <button
              key={status ?? 'all'}
              type="button"
              className={pillClass(values.status === status)}
              onClick={() => set('status', status)}
            >
              {intl.formatMessage(label)}
            </button>
          ))}
        </div>
      );
    default:
      return null;
  }
};
