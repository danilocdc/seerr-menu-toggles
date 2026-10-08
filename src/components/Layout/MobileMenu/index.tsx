import Badge from '@app/components/Common/Badge';
import MenuIcon from '@app/components/Layout/MenuIcon';
import { menuMessages } from '@app/components/Layout/Sidebar';
import useClickOutside from '@app/hooks/useClickOutside';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  buildMenuLinks,
  isCurrentUrl,
  useOpenGroups,
} from '@app/utils/menuLinks';
import { Transition } from '@headlessui/react';
import {
  ChevronRightIcon,
  ClockIcon,
  CogIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  FilmIcon,
  RectangleStackIcon,
  SparklesIcon,
  TvIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import {
  ClockIcon as FilledClockIcon,
  CogIcon as FilledCogIcon,
  ExclamationTriangleIcon as FilledExclamationTriangleIcon,
  EyeSlashIcon as FilledEyeSlashIcon,
  FilmIcon as FilledFilmIcon,
  RectangleStackIcon as FilledRectangleStackIcon,
  SparklesIcon as FilledSparklesIcon,
  TvIcon as FilledTvIcon,
  UsersIcon as FilledUsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type { BuiltinMenuItemId } from '@server/constants/menu';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Fragment,
  cloneElement,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import { useIntl } from 'react-intl';

interface MobileMenuProps {
  pendingRequestsCount: number;
  openIssuesCount: number;
  revalidateIssueCount: () => void;
  revalidateRequestsCount: () => void;
}

interface MenuLink {
  href: string;
  svgIcon: JSX.Element;
  svgIconSelected: JSX.Element;
  content: React.ReactNode;
  // Custom items have no activeRegExp: they match their full URL
  activeRegExp?: RegExp;
  as?: string;
  requiredPermission?: Permission | Permission[];
  permissionType?: 'and' | 'or';
  dataTestId?: string;
  id?: BuiltinMenuItemId;
}

const MobileMenu = ({
  pendingRequestsCount,
  openIssuesCount,
  revalidateIssueCount,
  revalidateRequestsCount,
}: MobileMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const intl = useIntl();
  const [isOpen, setIsOpen] = useState(false);
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const router = useRouter();
  useClickOutside(ref, () => {
    setTimeout(() => {
      if (isOpen) {
        setIsOpen(false);
      }
    }, 150);
  });

  const toggle = () => setIsOpen(!isOpen);

  const menuLinks: MenuLink[] = [
    {
      id: 'discover',
      href: '/',
      content: intl.formatMessage(menuMessages.dashboard),
      svgIcon: <SparklesIcon className="h-6 w-6" />,
      svgIconSelected: <FilledSparklesIcon className="h-6 w-6" />,
      activeRegExp: /^\/(discover\/?)?$/,
    },
    {
      id: 'movies',
      href: '/discover/movies',
      content: intl.formatMessage(menuMessages.browsemovies),
      svgIcon: <FilmIcon className="h-6 w-6" />,
      svgIconSelected: <FilledFilmIcon className="h-6 w-6" />,
      activeRegExp: /^\/discover\/movies$/,
    },
    {
      id: 'series',
      href: '/discover/tv',
      content: intl.formatMessage(menuMessages.browsetv),
      svgIcon: <TvIcon className="h-6 w-6" />,
      svgIconSelected: <FilledTvIcon className="h-6 w-6" />,
      activeRegExp: /^\/discover\/tv$/,
    },
    {
      id: 'browse',
      href: '/browse',
      content: intl.formatMessage(menuMessages.browse),
      svgIcon: <RectangleStackIcon className="h-6 w-6" />,
      svgIconSelected: <FilledRectangleStackIcon className="h-6 w-6" />,
      activeRegExp: /^\/browse$/,
    },
    {
      id: 'requests',
      href: '/requests',
      content: intl.formatMessage(menuMessages.requests),
      svgIcon: <ClockIcon className="h-6 w-6" />,
      svgIconSelected: <FilledClockIcon className="h-6 w-6" />,
      activeRegExp: /^\/requests/,
    },
    {
      id: 'blocklist',
      href: '/blocklist',
      content: intl.formatMessage(menuMessages.blocklist),
      svgIcon: <EyeSlashIcon className="h-6 w-6" />,
      svgIconSelected: <FilledEyeSlashIcon className="h-6 w-6" />,
      activeRegExp: /^\/blocklist/,
      requiredPermission: [
        Permission.MANAGE_BLOCKLIST,
        Permission.VIEW_BLOCKLIST,
      ],
      permissionType: 'or',
    },
    {
      id: 'issues',
      href: '/issues',
      content: intl.formatMessage(menuMessages.issues),
      svgIcon: <ExclamationTriangleIcon className="h-6 w-6" />,
      svgIconSelected: <FilledExclamationTriangleIcon className="h-6 w-6" />,
      activeRegExp: /^\/issues/,
      requiredPermission: [
        Permission.MANAGE_ISSUES,
        Permission.CREATE_ISSUES,
        Permission.VIEW_ISSUES,
      ],
      permissionType: 'or',
    },
    {
      id: 'users',
      href: '/users',
      content: intl.formatMessage(menuMessages.users),
      svgIcon: <UsersIcon className="mr-3 h-6 w-6" />,
      svgIconSelected: <FilledUsersIcon className="mr-3 h-6 w-6" />,
      activeRegExp: /^\/users/,
      requiredPermission: Permission.MANAGE_USERS,
      dataTestId: 'sidebar-menu-users',
    },
    {
      id: 'settings',
      href: '/settings',
      content: intl.formatMessage(menuMessages.settings),
      svgIcon: <CogIcon className="mr-3 h-6 w-6" />,
      svgIconSelected: <FilledCogIcon className="mr-3 h-6 w-6" />,
      activeRegExp: /^\/settings/,
      requiredPermission: Permission.ADMIN,
      dataTestId: 'sidebar-menu-settings',
    },
  ];

  const hasLinkPermission = (link: MenuLink) =>
    !link.requiredPermission ||
    hasPermission(link.requiredPermission, {
      type: link.permissionType ?? 'and',
    });

  const { links, groups } = buildMenuLinks(
    currentSettings.menuItems,
    Object.fromEntries(menuLinks.map((link) => [link.id, link])) as Record<
      BuiltinMenuItemId,
      MenuLink
    >,
    (item): MenuLink => ({
      href: item.url,
      content: item.name,
      svgIcon: <MenuIcon name={item.icon} className="h-6 w-6" />,
      svgIconSelected: <MenuIcon name={item.icon} solid className="h-6 w-6" />,
    })
  );
  const visibleLinks = links.filter(hasLinkPermission);
  // Groups without a visible item are left out
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      links: group.links.filter(hasLinkPermission),
    }))
    .filter((group) => group.links.length > 0);
  // Collapsed groups are only reachable from the expanded menu
  const hasMoreButton = visibleLinks.length > 5 || visibleGroups.length > 0;

  // A custom item with filters wins over the built-in page it points to
  const isCustomLinkActive = [
    ...visibleLinks,
    ...visibleGroups.flatMap((group) => group.links),
  ].some(
    (link) => !link.activeRegExp && isCurrentUrl(link.href, router.asPath)
  );
  const isLinkActive = (link: MenuLink): boolean =>
    link.activeRegExp
      ? !isCustomLinkActive && !!router.pathname.match(link.activeRegExp)
      : isCurrentUrl(link.href, router.asPath);

  const { isGroupOpen, toggleGroup } = useOpenGroups(
    visibleGroups.flatMap((group, index) =>
      group.links.some(isLinkActive) ? [index] : []
    )
  );

  useEffect(() => {
    if (openIssuesCount) {
      revalidateIssueCount();
    }

    if (pendingRequestsCount) {
      revalidateRequestsCount();
    }
  }, [
    revalidateIssueCount,
    revalidateRequestsCount,
    pendingRequestsCount,
    openIssuesCount,
  ]);

  const renderOverlayLink = (link: MenuLink) => {
    const isActive = isLinkActive(link);
    return (
      <Link
        key={`mobile-menu-link-${link.href}`}
        href={link.href}
        className={`flex items-center ${isActive ? 'text-indigo-500' : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setIsOpen(false);
          }
        }}
        onClick={() => setIsOpen(false)}
        role="button"
        tabIndex={0}
      >
        {cloneElement(isActive ? link.svgIconSelected : link.svgIcon, {
          className: 'h-5 w-5',
        })}
        <span className="ml-2">{link.content}</span>
        {link.href === '/requests' &&
          pendingRequestsCount > 0 &&
          hasPermission(Permission.MANAGE_REQUESTS) && (
            <div className="ml-auto flex">
              <Badge className="rounded-md border-indigo-500 bg-gradient-to-br from-indigo-600 to-purple-600">
                {pendingRequestsCount}
              </Badge>
            </div>
          )}
        {link.href === '/issues' &&
          openIssuesCount > 0 &&
          hasPermission(Permission.MANAGE_ISSUES) && (
            <div className="ml-auto flex">
              <Badge className="rounded-md border-indigo-500 bg-gradient-to-br from-indigo-600 to-purple-600">
                {openIssuesCount}
              </Badge>
            </div>
          )}
      </Link>
    );
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <Transition
        show={isOpen}
        as="div"
        ref={ref}
        enter="transition duration-500"
        enterFrom="opacity-0 translate-y-0"
        enterTo="opacity-100 -translate-y-full"
        leave="transition duration-500"
        leaveFrom="opacity-100 -translate-y-full"
        leaveTo="opacity-0 translate-y-0"
        className="absolute left-0 right-0 top-0 flex w-full -translate-y-full flex-col space-y-6 border-t border-gray-600 bg-gray-900/90 px-6 py-6 font-semibold text-gray-100 backdrop-blur"
      >
        {visibleLinks.map(renderOverlayLink)}
        {visibleGroups.map((group, index) => (
          <Fragment key={`group-${index}`}>
            <button
              type="button"
              onClick={() => toggleGroup(index)}
              aria-expanded={isGroupOpen(index)}
              className="flex items-center text-gray-300"
            >
              <ChevronRightIcon
                className={`h-5 w-5 transition-transform ${
                  isGroupOpen(index) ? 'rotate-90' : ''
                }`}
              />
              <span className="ml-2">{group.name}</span>
            </button>
            {isGroupOpen(index) && (
              <div className="flex flex-col space-y-6 pl-7">
                {group.links.map(renderOverlayLink)}
              </div>
            )}
          </Fragment>
        ))}
      </Transition>
      <div className="padding-bottom-safe border-t border-gray-600 bg-gray-800/90 backdrop-blur">
        <div className="flex h-full items-center justify-between px-6 py-4 text-gray-100">
          {visibleLinks.slice(0, hasMoreButton ? 4 : 5).map((link) => {
            const isActive = isLinkActive(link) && !isOpen;
            return (
              <Link
                key={`mobile-menu-link-${link.href}`}
                href={link.href}
                className={`relative flex flex-col items-center space-y-1 ${
                  isActive ? 'text-indigo-500' : ''
                }`}
              >
                {cloneElement(isActive ? link.svgIconSelected : link.svgIcon, {
                  className: 'h-6 w-6',
                })}
                {link.href === '/requests' &&
                  pendingRequestsCount > 0 &&
                  hasPermission(Permission.MANAGE_REQUESTS) && (
                    <div className="absolute bottom-3 left-3">
                      <Badge
                        className={`bg-gradient-to-br ${
                          isLinkActive(link)
                            ? 'border-indigo-600 from-indigo-700 to-purple-700'
                            : 'border-indigo-500 from-indigo-600 to-purple-600'
                        } flex ${
                          pendingRequestsCount > 99 ? 'w-6' : 'w-4'
                        } h-4 items-center justify-center !px-[5px] !py-[7px] text-[8px]`}
                      >
                        {pendingRequestsCount > 99
                          ? '99+'
                          : pendingRequestsCount}
                      </Badge>
                    </div>
                  )}
              </Link>
            );
          })}
          {hasMoreButton && (
            <button
              className={`flex flex-col items-center space-y-1 ${
                isOpen ? 'text-indigo-500' : ''
              }`}
              onClick={() => toggle()}
            >
              {isOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <EllipsisHorizontalIcon className="h-6 w-6" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileMenu;
