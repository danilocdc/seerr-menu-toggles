import type {
  BuiltinMenuItemId,
  CustomMenuItem,
  MenuItem,
} from '@server/constants/menu';

// Compares a menu item URL with the current path, ignoring query parameter order
export const isCurrentUrl = (url: string, asPath: string) => {
  const normalize = (value: string) => {
    const { pathname, searchParams } = new URL(value, 'http://localhost');
    searchParams.sort();
    return `${pathname}?${searchParams}`;
  };
  return normalize(url) === normalize(asPath);
};

// Turns the saved menu into links, split into the open part of the menu and
// the collapsed group
export const buildMenuLinks = <T>(
  items: MenuItem[],
  builtinLinks: Record<BuiltinMenuItemId, T>,
  toCustomLink: (item: CustomMenuItem) => T
) => {
  const links: T[] = [];
  const groupLinks: T[] = [];
  let groupName: string | undefined;

  items.forEach((item) => {
    if (item.type === 'group') {
      groupName = item.name;
    } else if (!item.hidden) {
      (groupName === undefined ? links : groupLinks).push(
        item.type === 'builtin' ? builtinLinks[item.id] : toCustomLink(item)
      );
    }
  });

  return { links, groupLinks, groupName };
};
