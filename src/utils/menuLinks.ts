import type {
  BuiltinMenuItemId,
  CustomMenuItem,
  MenuItem,
} from '@server/constants/menu';
import { useEffect, useState } from 'react';

// Compares a menu item URL with the current path, ignoring query parameter order
export const isCurrentUrl = (url: string, asPath: string) => {
  const normalize = (value: string) => {
    const { pathname, searchParams } = new URL(value, 'http://localhost');
    searchParams.sort();
    return `${pathname}?${searchParams}`;
  };
  return normalize(url) === normalize(asPath);
};

export interface MenuGroup<T> {
  name: string;
  links: T[];
}

// Turns the saved menu into links, split into the open part of the menu and
// the collapsed groups
export const buildMenuLinks = <T>(
  items: MenuItem[],
  builtinLinks: Record<BuiltinMenuItemId, T>,
  toCustomLink: (item: CustomMenuItem) => T
) => {
  const links: T[] = [];
  const groups: MenuGroup<T>[] = [];

  items.forEach((item) => {
    if (item.type === 'group') {
      groups.push({ name: item.name, links: [] });
    } else if (!item.hidden) {
      (groups[groups.length - 1]?.links ?? links).push(
        item.type === 'builtin' ? builtinLinks[item.id] : toCustomLink(item)
      );
    }
  });

  return { links, groups };
};

// Which collapsed groups are open; a group opens by itself when it holds the
// current page
export const useOpenGroups = (activeGroups: number[]) => {
  const [openGroups, setOpenGroups] = useState<number[]>([]);
  const activeKey = activeGroups.join(',');

  useEffect(() => {
    if (activeKey) {
      setOpenGroups((current) => [
        ...new Set([...current, ...activeKey.split(',').map(Number)]),
      ]);
    }
  }, [activeKey]);

  return {
    isGroupOpen: (index: number) => openGroups.includes(index),
    toggleGroup: (index: number) =>
      setOpenGroups((current) =>
        current.includes(index)
          ? current.filter((open) => open !== index)
          : [...current, index]
      ),
  };
};
