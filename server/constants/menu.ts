// Sidebar and mobile menu, ordered and edited in Settings > Menu
export const BUILTIN_MENU_ITEMS = [
  'discover',
  'movies',
  'series',
  'browse',
  'requests',
  'blocklist',
  'issues',
  'users',
  'settings',
] as const;

export type BuiltinMenuItemId = (typeof BUILTIN_MENU_ITEMS)[number];

// Always shown, so an admin cannot lock themselves out
export const UNHIDEABLE_MENU_ITEMS: readonly BuiltinMenuItemId[] = [
  'users',
  'settings',
];

export const DEFAULT_MENU_ICON = 'BookmarkIcon';

export interface BuiltinMenuItem {
  type: 'builtin';
  id: BuiltinMenuItemId;
  hidden: boolean;
}

export interface CustomMenuItem {
  type: 'custom';
  name: string;
  // Seerr path, usually a discover page with filters
  url: string;
  // Heroicons component name
  icon: string;
  hidden: boolean;
}

// Items after the group are shown in a collapsed section, opened with a click
export interface MenuGroupItem {
  type: 'group';
  name: string;
}

export type MenuItem = BuiltinMenuItem | CustomMenuItem | MenuGroupItem;

export interface MenuSettings {
  items: MenuItem[];
}

const builtinItem = (id: BuiltinMenuItemId): BuiltinMenuItem => ({
  type: 'builtin',
  id,
  hidden: false,
});

const DEFAULT_GROUP: MenuGroupItem = { type: 'group', name: 'More' };

export const DEFAULT_MENU_ITEMS: MenuItem[] = [
  ...BUILTIN_MENU_ITEMS.map(builtinItem),
  DEFAULT_GROUP,
];

// Keeps every built-in item once and exactly one group, so saved lists stay
// valid when built-in items are added
export const normalizeMenuItems = (items: MenuItem[]): MenuItem[] => {
  const seen = new Set<BuiltinMenuItemId>();
  let hasGroup = false;
  const normalized = items
    .filter((item) => {
      if (item.type === 'builtin') {
        if (seen.has(item.id) || !BUILTIN_MENU_ITEMS.includes(item.id)) {
          return false;
        }
        seen.add(item.id);
      } else if (item.type === 'group') {
        if (hasGroup) {
          return false;
        }
        hasGroup = true;
      }
      return true;
    })
    .map((item) =>
      item.type === 'builtin' && UNHIDEABLE_MENU_ITEMS.includes(item.id)
        ? { ...item, hidden: false }
        : item
    );

  if (!hasGroup) {
    normalized.push(DEFAULT_GROUP);
  }
  // New built-in items go at the end of the open part of the menu
  const groupIndex = normalized.findIndex((item) => item.type === 'group');
  normalized.splice(
    groupIndex,
    0,
    ...BUILTIN_MENU_ITEMS.filter((id) => !seen.has(id)).map(builtinItem)
  );
  return normalized;
};
