// Sidebar and mobile menu, ordered and edited in Settings > Menu
export const BUILTIN_MENU_ITEMS = [
  'discover',
  'browse',
  'movies',
  'series',
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

// Hidden in the default menu and when added to a saved one
export const HIDDEN_BY_DEFAULT_MENU_ITEMS: readonly BuiltinMenuItemId[] = [
  'browse',
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

// Items after a group, up to the next one, are shown in a collapsed section,
// opened with a click
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
  hidden: HIDDEN_BY_DEFAULT_MENU_ITEMS.includes(id),
});

export const DEFAULT_MENU_ITEMS: MenuItem[] =
  BUILTIN_MENU_ITEMS.map(builtinItem);

// Keeps every built-in item once, so saved lists stay valid when built-in
// items are added
export const normalizeMenuItems = (items: MenuItem[]): MenuItem[] => {
  const seen = new Set<BuiltinMenuItemId>();
  const normalized = items
    .filter((item) => {
      if (item.type === 'builtin') {
        if (seen.has(item.id) || !BUILTIN_MENU_ITEMS.includes(item.id)) {
          return false;
        }
        seen.add(item.id);
      }
      return true;
    })
    .map((item) =>
      item.type === 'builtin' && UNHIDEABLE_MENU_ITEMS.includes(item.id)
        ? { ...item, hidden: false }
        : item
    );

  // A new built-in item goes right after the one before it in the default
  // order, or at the top
  BUILTIN_MENU_ITEMS.forEach((id, order) => {
    if (seen.has(id)) {
      return;
    }
    const previous = BUILTIN_MENU_ITEMS[order - 1];
    const index = normalized.findIndex(
      (item) => item.type === 'builtin' && item.id === previous
    );
    normalized.splice(index + 1, 0, builtinItem(id));
    seen.add(id);
  });
  return normalized;
};
