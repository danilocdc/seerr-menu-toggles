import Badge from '@app/components/Common/Badge';
import MenuIcon from '@app/components/Layout/MenuIcon';
import VersionStatus from '@app/components/Layout/VersionStatus';
import useClickOutside from '@app/hooks/useClickOutside';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { buildMenuLinks, isCurrentUrl } from '@app/utils/menuLinks';
import { Transition, TransitionChild } from '@headlessui/react';
import {
  ChevronRightIcon,
  ClockIcon,
  CogIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  FilmIcon,
  SparklesIcon,
  TvIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { BuiltinMenuItemId } from '@server/constants/menu';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

export const menuMessages = defineMessages('components.Layout.Sidebar', {
  dashboard: 'Discover',
  browsemovies: 'Movies',
  browsetv: 'Series',
  requests: 'Requests',
  blocklist: 'Blocklist',
  issues: 'Issues',
  users: 'Users',
  settings: 'Settings',
});

interface SidebarProps {
  open?: boolean;
  setClosed: () => void;
  pendingRequestsCount: number;
  openIssuesCount: number;
  revalidateIssueCount: () => void;
  revalidateRequestsCount: () => void;
}

export interface SidebarLinkProps {
  href: string;
  svgIcon: React.ReactNode;
  // Built-in items use messagesKey and activeRegExp; custom items use text
  messagesKey?: keyof typeof menuMessages;
  text?: string;
  activeRegExp?: RegExp;
  as?: string;
  requiredPermission?: Permission | Permission[];
  permissionType?: 'and' | 'or';
  dataTestId?: string;
  id?: BuiltinMenuItemId;
}

export const SidebarLinks: SidebarLinkProps[] = [
  {
    href: '/',
    id: 'discover',
    messagesKey: 'dashboard',
    svgIcon: <SparklesIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/(discover\/?)?$/,
  },
  {
    href: '/discover/movies',
    id: 'movies',
    messagesKey: 'browsemovies',
    svgIcon: <FilmIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/discover\/movies$/,
  },
  {
    href: '/discover/tv',
    id: 'series',
    messagesKey: 'browsetv',
    svgIcon: <TvIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/discover\/tv$/,
  },
  {
    href: '/requests',
    id: 'requests',
    messagesKey: 'requests',
    svgIcon: <ClockIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/requests/,
  },
  {
    href: '/blocklist',
    id: 'blocklist',
    messagesKey: 'blocklist',
    svgIcon: <EyeSlashIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/blocklist/,
    requiredPermission: [
      Permission.MANAGE_BLOCKLIST,
      Permission.VIEW_BLOCKLIST,
    ],
    permissionType: 'or',
  },
  {
    href: '/issues',
    id: 'issues',
    messagesKey: 'issues',
    svgIcon: <ExclamationTriangleIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/issues/,
    requiredPermission: [
      Permission.MANAGE_ISSUES,
      Permission.CREATE_ISSUES,
      Permission.VIEW_ISSUES,
    ],
    permissionType: 'or',
  },
  {
    href: '/users',
    id: 'users',
    messagesKey: 'users',
    svgIcon: <UsersIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/users/,
    requiredPermission: Permission.MANAGE_USERS,
    dataTestId: 'sidebar-menu-users',
  },
  {
    href: '/settings',
    id: 'settings',
    messagesKey: 'settings',
    svgIcon: <CogIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/settings/,
    requiredPermission: Permission.ADMIN,
    dataTestId: 'sidebar-menu-settings',
  },
];

const builtinLinks = Object.fromEntries(
  SidebarLinks.map((link) => [link.id, link])
) as Record<BuiltinMenuItemId, SidebarLinkProps>;

const Sidebar = ({
  open,
  setClosed,
  pendingRequestsCount,
  openIssuesCount,
  revalidateIssueCount,
  revalidateRequestsCount,
}: SidebarProps) => {
  const navRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  useClickOutside(navRef, () => setClosed());

  const hasLinkPermission = (link: SidebarLinkProps) =>
    !link.requiredPermission ||
    hasPermission(link.requiredPermission, {
      type: link.permissionType ?? 'and',
    });

  const { links, groupLinks, groupName } = buildMenuLinks(
    currentSettings.menuItems,
    builtinLinks,
    (item): SidebarLinkProps => ({
      href: item.url,
      text: item.name,
      svgIcon: <MenuIcon name={item.icon} className="mr-3 h-6 w-6" />,
    })
  );
  const visibleLinks = links.filter(hasLinkPermission);
  const visibleGroupLinks = groupLinks.filter(hasLinkPermission);

  // A custom item with filters wins over the built-in page it points to
  const isCustomLinkActive = [...visibleLinks, ...visibleGroupLinks].some(
    (link) => !link.activeRegExp && isCurrentUrl(link.href, router.asPath)
  );
  const isLinkActive = (link: SidebarLinkProps) =>
    link.activeRegExp
      ? !isCustomLinkActive && !!router.pathname.match(link.activeRegExp)
      : isCurrentUrl(link.href, router.asPath);

  const [isGroupOpen, setIsGroupOpen] = useState(false);
  const isGroupLinkActive = visibleGroupLinks.some(isLinkActive);

  useEffect(() => {
    if (isGroupLinkActive) {
      setIsGroupOpen(true);
    }
  }, [isGroupLinkActive]);

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

  const renderMobileLink = (sidebarLink: SidebarLinkProps) => {
    return (
      <Link
        key={`mobile-${sidebarLink.messagesKey ?? sidebarLink.href}`}
        href={sidebarLink.href}
        as={sidebarLink.as}
        onClick={() => setClosed()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setClosed();
          }
        }}
        role="button"
        tabIndex={0}
        className={`flex items-center rounded-md px-2 py-2 text-base font-medium leading-6 text-white transition duration-150 ease-in-out focus:outline-none ${
          isLinkActive(sidebarLink)
            ? 'bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
            : 'hover:bg-gray-700 focus:bg-gray-700'
        } `}
        data-testid={`${sidebarLink.dataTestId}-mobile`}
      >
        {sidebarLink.svgIcon}
        {sidebarLink.messagesKey
          ? intl.formatMessage(menuMessages[sidebarLink.messagesKey])
          : sidebarLink.text}
      </Link>
    );
  };

  const renderDesktopLink = (sidebarLink: SidebarLinkProps) => {
    return (
      <Link
        key={`desktop-${sidebarLink.messagesKey ?? sidebarLink.href}`}
        href={sidebarLink.href}
        as={sidebarLink.as}
        className={`group flex items-center rounded-md px-2 py-2 text-lg font-medium leading-6 text-white transition duration-150 ease-in-out focus:outline-none ${
          isLinkActive(sidebarLink)
            ? 'bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
            : 'hover:bg-gray-700 focus:bg-gray-700'
        } `}
        data-testid={sidebarLink.dataTestId}
      >
        {sidebarLink.svgIcon}
        {sidebarLink.messagesKey
          ? intl.formatMessage(menuMessages[sidebarLink.messagesKey])
          : sidebarLink.text}
        {sidebarLink.messagesKey === 'requests' &&
          pendingRequestsCount > 0 &&
          hasPermission(Permission.MANAGE_REQUESTS) && (
            <div className="ml-auto flex">
              <Badge
                className={`rounded-md bg-gradient-to-br ${
                  isLinkActive(sidebarLink)
                    ? 'border-indigo-600 from-indigo-700 to-purple-700'
                    : 'border-indigo-500 from-indigo-600 to-purple-600'
                }`}
              >
                {pendingRequestsCount}
              </Badge>
            </div>
          )}
        {sidebarLink.messagesKey === 'issues' &&
          openIssuesCount > 0 &&
          hasPermission(Permission.MANAGE_ISSUES) && (
            <div className="ml-auto flex">
              <Badge
                className={`rounded-md bg-gradient-to-br ${
                  isLinkActive(sidebarLink)
                    ? 'border-indigo-600 from-indigo-700 to-purple-700'
                    : 'border-indigo-500 from-indigo-600 to-purple-600'
                }`}
              >
                {openIssuesCount}
              </Badge>
            </div>
          )}
      </Link>
    );
  };

  const renderGroup = (
    renderLink: (sidebarLink: SidebarLinkProps) => React.ReactNode,
    textSize: string
  ) =>
    groupName !== undefined &&
    visibleGroupLinks.length > 0 && (
      <>
        <button
          type="button"
          onClick={() => setIsGroupOpen(!isGroupOpen)}
          aria-expanded={isGroupOpen}
          className={`flex w-full items-center rounded-md px-2 py-2 ${textSize} font-medium leading-6 text-gray-300 transition duration-150 ease-in-out hover:bg-gray-700 hover:text-white focus:bg-gray-700 focus:outline-none`}
        >
          <ChevronRightIcon
            className={`mr-3 h-6 w-6 transition-transform ${
              isGroupOpen ? 'rotate-90' : ''
            }`}
          />
          {groupName}
        </button>
        {isGroupOpen && (
          <div className="space-y-4 pl-6">
            {visibleGroupLinks.map(renderLink)}
          </div>
        )}
      </>
    );

  return (
    <>
      <div className="lg:hidden">
        <Transition as={Fragment} show={open}>
          <div className="fixed inset-0 z-40 flex">
            <TransitionChild
              as="div"
              enter="transition-opacity ease-linear duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity ease-linear duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0">
                <div className="absolute inset-0 bg-gray-900 opacity-90" />
              </div>
            </TransitionChild>
            <TransitionChild
              as="div"
              enter="transition-transform ease-in-out duration-300"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition-transform ease-in-out duration-300"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <>
                <div className="sidebar relative flex h-full w-full max-w-xs flex-1 flex-col bg-gray-800">
                  <div className="sidebar-close-button absolute right-0 -mr-14 p-1">
                    <button
                      className="flex h-12 w-12 items-center justify-center rounded-full focus:bg-gray-600 focus:outline-none"
                      aria-label="Close sidebar"
                      onClick={() => setClosed()}
                    >
                      <XMarkIcon className="h-6 w-6 text-white" />
                    </button>
                  </div>
                  <div
                    ref={navRef}
                    className="flex flex-1 flex-col overflow-y-auto pb-8 pt-4 sm:pb-4"
                  >
                    <div className="flex flex-shrink-0 items-center px-2">
                      <span className="w-full px-4 text-xl text-gray-50">
                        <Link href="/" className="relative block h-24 w-64">
                          <Image src="/logo_full.svg" alt="Logo" fill />
                        </Link>
                      </span>
                    </div>
                    <nav className="mt-10 flex-1 space-y-4 px-4">
                      {visibleLinks.map(renderMobileLink)}
                      {renderGroup(renderMobileLink, 'text-base')}
                    </nav>
                    {hasPermission(Permission.ADMIN) && (
                      <div className="px-2">
                        <VersionStatus onClick={() => setClosed()} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="w-14 flex-shrink-0">
                  {/* <!-- Force sidebar to shrink to fit close icon --> */}
                </div>
              </>
            </TransitionChild>
          </div>
        </Transition>
      </div>

      <div className="fixed bottom-0 left-0 top-0 z-30 hidden lg:flex lg:flex-shrink-0">
        <div className="sidebar flex w-64 flex-col">
          <div className="flex h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col overflow-y-auto pb-4">
              <div className="flex flex-shrink-0 items-center">
                <span className="w-full px-4 py-2 text-2xl text-gray-50">
                  <Link href="/" className="relative block h-24">
                    <Image
                      src="/logo_full.svg"
                      alt="Logo"
                      fill
                      loading="eager"
                    />
                  </Link>
                </span>
              </div>
              <nav className="mt-8 flex-1 space-y-4 px-4">
                {visibleLinks.map(renderDesktopLink)}
                {renderGroup(renderDesktopLink, 'text-lg')}
              </nav>
              {hasPermission(Permission.ADMIN) && (
                <div className="px-2">
                  <VersionStatus />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
