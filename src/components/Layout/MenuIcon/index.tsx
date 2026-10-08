import { DEFAULT_MENU_ICON } from '@server/constants/menu';
import type { ComponentType, SVGProps } from 'react';
import { useEffect, useState } from 'react';

type IconSet = Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

interface IconSets {
  outline: IconSet;
  solid: IconSet;
}

let iconSets: IconSets | undefined;
let loadingIconSets: Promise<IconSets> | undefined;

// The full icon sets are loaded on demand, only where custom menu items need them
const loadIconSets = () => {
  loadingIconSets ??= Promise.all([
    import('@heroicons/react/24/outline'),
    import('@heroicons/react/24/solid'),
  ]).then(([outline, solid]) => {
    iconSets = {
      outline: outline as unknown as IconSet,
      solid: solid as unknown as IconSet,
    };
    return iconSets;
  });
  return loadingIconSets;
};

export const useMenuIcons = () => {
  const [sets, setSets] = useState(iconSets);

  useEffect(() => {
    if (!sets) {
      loadIconSets().then(setSets);
    }
  }, [sets]);

  return sets;
};

interface MenuIconProps {
  name: string;
  solid?: boolean;
  className?: string;
}

const MenuIcon = ({ name, solid = false, className }: MenuIconProps) => {
  const sets = useMenuIcons();
  const set = sets?.[solid ? 'solid' : 'outline'];
  const Icon = set?.[name] ?? set?.[DEFAULT_MENU_ICON];

  return Icon ? <Icon className={className} /> : <span className={className} />;
};

export default MenuIcon;
