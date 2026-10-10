import {
  BROWSE_FILTERS,
  BROWSE_PARAMS,
  FilterEditor,
  FilterSummary,
  isFilterActive,
  messages,
  type BrowseFilter,
  type BrowseValues,
} from '@app/components/Browse/filters';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from '@headlessui/react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { BarsArrowDownIcon, FilmIcon } from '@heroicons/react/24/solid';
import {
  BROWSE_SORTS,
  BROWSE_TYPES,
  type BrowseSort,
  type BrowseType,
} from '@server/constants/browse';
import { MediaStatus } from '@server/constants/media';
import type { MovieResult, TvResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';

const listMessages = defineMessages('components.Browse', {
  typeAll: 'Movies & Series',
  typeMovie: 'Movies',
  typeTv: 'Series',
  sortTrending: 'Trending',
  sortRelevance: 'Relevance',
  sortPopularity: 'Popularity',
  sortReleaseDateDesc: 'Release Date (Newest)',
  sortReleaseDateAsc: 'Release Date (Oldest)',
  sortRating: 'TMDB Rating',
});

const TYPE_LABELS: Record<BrowseType, keyof typeof listMessages> = {
  all: 'typeAll',
  movie: 'typeMovie',
  tv: 'typeTv',
};

const SORT_LABELS: Record<BrowseSort, keyof typeof listMessages> = {
  'popularity.desc': 'sortPopularity',
  'release_date.desc': 'sortReleaseDateDesc',
  'release_date.asc': 'sortReleaseDateAsc',
  'vote_average.desc': 'sortRating',
};

interface BrowseResponse {
  mode: 'trending' | 'discover' | 'search' | 'library';
  seriesOnly: boolean;
  nextCursor: string | null;
  results: (MovieResult | TvResult)[];
}

const firstValue = (value?: string | string[]) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

const Browse = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const { hasPermission } = useUser();
  const [editing, setEditing] = useState<BrowseFilter>();
  const [showEditor, setShowEditor] = useState(false);
  const [draft, setDraft] = useState<BrowseValues>({});

  // The URL holds the filters, so a filtered list can be shared or bookmarked
  const values: BrowseValues = useMemo(
    () =>
      Object.fromEntries(
        BROWSE_PARAMS.map((param) => [param, firstValue(router.query[param])])
      ),
    [router.query]
  );
  const type = (firstValue(router.query.type) ?? 'all') as BrowseType;
  const sortBy = firstValue(router.query.sortBy) as BrowseSort | undefined;
  const activeFilters = BROWSE_FILTERS.filter((filter) =>
    isFilterActive(filter, values)
  );
  const isTrending = !activeFilters.length && !sortBy;
  const isLibrary = !!values.status || !!values.watchlist;

  const updateQuery = (changes: Record<string, string | undefined>) => {
    const query = Object.fromEntries(
      Object.entries({ ...router.query, ...changes }).filter(
        ([, value]) => value !== undefined && value !== ''
      )
    );
    router.push({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  const clearFilter = (filter: BrowseFilter) =>
    updateQuery(
      Object.fromEntries(filter.params.map((param) => [param, undefined]))
    );

  const openEditor = (filter: BrowseFilter) => {
    if (filter.id === 'watchlist') {
      updateQuery({ watchlist: 'true' });
      return;
    }

    setDraft(
      Object.fromEntries(filter.params.map((param) => [param, values[param]]))
    );
    setEditing(filter);
    setShowEditor(true);
  };

  const applyEditor = () => {
    if (editing) {
      updateQuery(
        Object.fromEntries(
          editing.params.map((param) => [param, draft[param] || undefined])
        )
      );
    }
    setShowEditor(false);
  };

  // The API validator rejects raw reserved characters (commas, "+" for spaces)
  const queryString = Object.entries({
    ...values,
    type: type !== 'all' ? type : undefined,
    sortBy,
  })
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => `${key}=${encodeURIExtraParams(value)}`)
    .join('&');

  const { data, error, size, setSize } = useSWRInfinite<BrowseResponse>(
    (_index, previous: BrowseResponse | null) => {
      if (previous && !previous.nextCursor) {
        return null;
      }

      const cursor = previous?.nextCursor
        ? `cursor=${encodeURIExtraParams(previous.nextCursor)}`
        : '';
      return `/api/v1/browse?${[queryString, cursor].filter(Boolean).join('&')}`;
    },
    {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  // TMDB repeats titles across pages, and movie and series ids can collide
  const titles = useMemo(() => {
    const seen = new Set<string>();
    const hideBlocklisted =
      currentSettings.hideBlocklisted &&
      hasPermission(Permission.MANAGE_BLOCKLIST);

    return (data ?? [])
      .flatMap((page) => page.results)
      .filter((title) => {
        const key = `${title.mediaType}-${title.id}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);

        const status = title.mediaInfo?.status;
        // The Status and On My List filters ask for these titles on purpose
        return !(
          (!isLibrary &&
            currentSettings.hideAvailable &&
            (status === MediaStatus.AVAILABLE ||
              status === MediaStatus.PARTIALLY_AVAILABLE)) ||
          (!isLibrary &&
            currentSettings.hideRequested &&
            title.mediaInfo?.hasActiveRequest) ||
          (hideBlocklisted && status === MediaStatus.BLOCKLISTED)
        );
      });
  }, [data, currentSettings, hasPermission, isLibrary]);

  const isLoadingInitialData = !data && !error;
  const isLoadingMore =
    !!data && size > 0 && typeof data[size - 1] === 'undefined';
  const isReachingEnd = !!data && !data[data.length - 1]?.nextCursor;

  if (error && !titles.length) {
    return <ErrorPage statusCode={500} />;
  }

  // The admin can rename the menu item
  const title =
    currentSettings.menuItems.find(
      (item) => item.type === 'builtin' && item.id === 'browse'
    )?.name || intl.formatMessage(messages.browse);
  const availableFilters = BROWSE_FILTERS.filter(
    (filter) => !isFilterActive(filter, values)
  );

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-2">
        <Header>{title}</Header>
      </div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {activeFilters.map((filter) => (
            <span
              key={filter.id}
              className="inline-flex items-center rounded-full border border-indigo-500 bg-indigo-600/30 text-sm text-white"
            >
              {filter.id === 'watchlist' ? (
                <span className="py-1 pl-3 pr-1">
                  <FilterSummary filter={filter} values={values} />
                </span>
              ) : (
                <button
                  type="button"
                  className="py-1 pl-3 pr-1 hover:text-indigo-200"
                  onClick={() => openEditor(filter)}
                >
                  <FilterSummary filter={filter} values={values} />
                </button>
              )}
              <button
                type="button"
                className="mr-1 rounded-full p-1 text-indigo-200 hover:bg-indigo-500/50 hover:text-white"
                aria-label={intl.formatMessage(messages.removeFilter)}
                onClick={() => clearFilter(filter)}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </span>
          ))}
          {availableFilters.length > 0 && (
            <Menu>
              <MenuButton className="inline-flex items-center rounded-full border border-dashed border-gray-500 px-3 py-1 text-sm text-gray-300 transition hover:border-gray-300 hover:text-white">
                <PlusIcon className="mr-1 h-4 w-4" />
                {intl.formatMessage(messages.addFilter)}
              </MenuButton>
              <MenuItems
                anchor="bottom start"
                className="z-50 max-h-80 w-60 overflow-y-auto rounded-md border border-gray-700 bg-gray-800 p-1 shadow-lg [--anchor-gap:8px] focus:outline-none"
              >
                {availableFilters.map((filter) => (
                  <MenuItem key={filter.id}>
                    <button
                      type="button"
                      className="block w-full rounded px-3 py-2 text-left text-sm text-gray-200 data-[focus]:bg-gray-700 data-[focus]:text-white"
                      onClick={() => openEditor(filter)}
                    >
                      {intl.formatMessage(messages[filter.id])}
                    </button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-none">
          <div className="flex flex-grow">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <FilmIcon className="h-6 w-6" />
            </span>
            <select
              id="type"
              name="type"
              className="rounded-r-only"
              value={type}
              onChange={(e) =>
                updateQuery({
                  type: e.target.value !== 'all' ? e.target.value : undefined,
                })
              }
            >
              {BROWSE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {intl.formatMessage(listMessages[TYPE_LABELS[value]])}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-grow">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <BarsArrowDownIcon className="h-6 w-6" />
            </span>
            {/* Search results keep TMDB's relevance order */}
            <select
              id="sortBy"
              name="sortBy"
              className="rounded-r-only"
              disabled={!!values.query}
              value={
                values.query
                  ? ''
                  : (sortBy ?? (isTrending ? '' : 'popularity.desc'))
              }
              onChange={(e) => updateQuery({ sortBy: e.target.value })}
            >
              {values.query ? (
                <option value="">
                  {intl.formatMessage(listMessages.sortRelevance)}
                </option>
              ) : (
                isTrending && (
                  <option value="" disabled>
                    {intl.formatMessage(listMessages.sortTrending)}
                  </option>
                )
              )}
              {BROWSE_SORTS.map((value) => (
                <option key={value} value={value}>
                  {intl.formatMessage(listMessages[SORT_LABELS[value]])}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <ListView
        items={titles}
        isEmpty={isReachingEnd && !titles.length}
        isLoading={isLoadingInitialData || isLoadingMore}
        isReachingEnd={isReachingEnd}
        onScrollBottom={() => setSize(size + 1)}
      />
      <Transition
        as="div"
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        show={showEditor}
      >
        {editing && (
          <Modal
            title={intl.formatMessage(messages[editing.id])}
            okText={intl.formatMessage(messages.apply)}
            cancelText={intl.formatMessage(globalMessages.cancel)}
            onOk={applyEditor}
            onCancel={() => setShowEditor(false)}
          >
            <FilterEditor
              filter={editing}
              values={draft}
              setValues={setDraft}
              onSubmit={applyEditor}
            />
          </Modal>
        )}
      </Transition>
    </>
  );
};

export default Browse;
