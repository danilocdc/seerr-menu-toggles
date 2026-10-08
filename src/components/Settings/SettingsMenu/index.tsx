import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import SlideCheckbox from '@app/components/Common/SlideCheckbox';
import MenuIcon, { useMenuIcons } from '@app/components/Layout/MenuIcon';
import { menuMessages, SidebarLinks } from '@app/components/Layout/Sidebar';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import {
  ArrowDownOnSquareIcon,
  ArrowPathIcon,
  Bars3Icon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type { MenuItem, MenuSettings } from '@server/constants/menu';
import {
  DEFAULT_MENU_ICON,
  DEFAULT_MENU_ITEMS,
  UNHIDEABLE_MENU_ITEMS,
} from '@server/constants/menu';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-aria';
import type { IntlShape } from 'react-intl';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Settings.SettingsMenu', {
  menu: 'Menu',
  menuItems: 'Menu Items',
  menuItemsDescription:
    'Drag to reorder the sidebar and the mobile menu. Items below a collapsed group, up to the next one, only show after clicking it. A hidden item can still be opened by its address; Users and Settings are always shown.',
  customItemsTip:
    'A custom item opens any Seerr page. To list movies or series with filters, apply the filters on the Movies or Series page and copy its address.',
  collapsedGroup: 'Collapsed group',
  name: 'Name',
  url: 'Address',
  urlInvalid: 'Use a Seerr address, such as /discover/movies?genre=27',
  chooseIcon: 'Choose icon',
  searchIcons: 'Search icons',
  shown: 'Shown',
  alwaysShown: 'Always shown',
  dragToReorder: 'Drag to reorder',
  addItem: 'Add Item',
  addGroup: 'Add Group',
  resetMenu: 'Reset to Default',
  toastSettingsSuccess: 'Settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
});

const DRAG_TYPE = 'menu-item-index';

type DropPosition = 'above' | 'below' | null;

// Accepts a path or a full address of this Seerr, and returns the path
const toSeerrPath = (url: string) => {
  try {
    const parsed = new URL(url.trim(), window.location.origin);
    return parsed.origin === window.location.origin
      ? parsed.pathname + parsed.search
      : undefined;
  } catch {
    return undefined;
  }
};

interface IconPickerProps {
  intl: IntlShape;
  onSelect: (icon: string) => void;
}

const IconPicker = ({ intl, onSelect }: IconPickerProps) => {
  const sets = useMenuIcons();
  const [search, setSearch] = useState('');

  if (!sets) {
    return <LoadingSpinner />;
  }

  const query = search.trim().toLowerCase();
  const icons = Object.keys(sets.outline).filter((name) =>
    name.toLowerCase().includes(query)
  );

  return (
    <div className="mt-3">
      <input
        type="text"
        aria-label={intl.formatMessage(messages.searchIcons)}
        placeholder={intl.formatMessage(messages.searchIcons)}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="mt-2 grid max-h-64 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-10 lg:grid-cols-12">
        {icons.map((name) => {
          const Icon = sets.outline[name];
          return (
            <button
              key={name}
              type="button"
              title={name.replace(/Icon$/, '')}
              onClick={() => onSelect(name)}
              className="flex h-10 items-center justify-center rounded text-gray-300 hover:bg-gray-700 hover:text-white"
            >
              <Icon className="h-6 w-6" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface MenuRowProps {
  item: MenuItem;
  index: number;
  intl: IntlShape;
  isInGroup: boolean;
  isPickerOpen: boolean;
  onTogglePicker: () => void;
  onChange: (item: MenuItem) => void;
  onDelete: () => void;
  onMove: (from: number, to: number) => void;
}

const MenuRow = ({
  item,
  index,
  intl,
  isInGroup,
  isPickerOpen,
  onTogglePicker,
  onChange,
  onDelete,
  onMove,
}: MenuRowProps) => {
  const ref = useRef<HTMLLIElement>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition>(null);

  const { dragProps, isDragging } = useDrag({
    getItems: () => [{ [DRAG_TYPE]: String(index) }],
  });

  const { dropProps } = useDrop({
    ref,
    onDropMove: (e) => {
      if (ref.current) {
        setDropPosition(e.y < ref.current.offsetHeight / 2 ? 'above' : 'below');
      }
    },
    onDropExit: () => setDropPosition(null),
    onDrop: async (e) => {
      const position = dropPosition;
      setDropPosition(null);
      const dragItem = e.items.find(
        (i) => i.kind === 'text' && i.types.has(DRAG_TYPE)
      );
      if (dragItem?.kind !== 'text') {
        return;
      }
      const from = Number(await dragItem.getText(DRAG_TYPE));
      // Target index once the dragged row has been taken out of the list
      let to = position === 'below' ? index + 1 : index;
      if (from < to) {
        to--;
      }
      if (from !== to) {
        onMove(from, to);
      }
    },
  });

  const isHidden = item.type !== 'group' && item.hidden;
  const builtinLink =
    item.type === 'builtin'
      ? SidebarLinks.find((link) => link.id === item.id)
      : undefined;
  const isUnhideable =
    item.type === 'builtin' && UNHIDEABLE_MENU_ITEMS.includes(item.id);
  const shownLabel = intl.formatMessage(
    isUnhideable ? messages.alwaysShown : messages.shown
  );

  return (
    <li
      ref={ref}
      {...dropProps}
      className={`relative rounded-md border bg-gray-800 p-2 ${
        isInGroup ? 'ml-8' : ''
      } ${
        item.type === 'group'
          ? 'border-dashed border-indigo-500'
          : 'border-gray-700'
      } ${isDragging ? 'opacity-50' : ''} ${isHidden ? 'opacity-60' : ''}`}
    >
      {dropPosition === 'above' && (
        <div className="absolute -top-1.5 left-0 w-full border-t-4 border-indigo-500" />
      )}
      {dropPosition === 'below' && (
        <div className="absolute -bottom-1.5 left-0 w-full border-t-4 border-indigo-500" />
      )}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <div
            {...dragProps}
            title={intl.formatMessage(messages.dragToReorder)}
            aria-label={intl.formatMessage(messages.dragToReorder)}
            className="cursor-grab text-gray-400 hover:text-white active:cursor-grabbing"
          >
            <Bars3Icon className="h-6 w-6" />
          </div>
          {builtinLink?.messagesKey && (
            <div className="flex h-10 items-center">
              {builtinLink.svgIcon}
              {intl.formatMessage(menuMessages[builtinLink.messagesKey])}
            </div>
          )}
          {item.type === 'group' && (
            <div className="flex h-10 items-center whitespace-nowrap text-indigo-300">
              <ChevronRightIcon className="mr-3 h-6 w-6" />
              {intl.formatMessage(messages.collapsedGroup)}
            </div>
          )}
          {item.type === 'custom' && (
            <button
              type="button"
              title={intl.formatMessage(messages.chooseIcon)}
              aria-label={intl.formatMessage(messages.chooseIcon)}
              onClick={onTogglePicker}
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded border ${
                isPickerOpen
                  ? 'border-indigo-500 bg-gray-700'
                  : 'border-gray-500 bg-gray-900 hover:bg-gray-700'
              }`}
            >
              <MenuIcon name={item.icon} className="h-6 w-6" />
            </button>
          )}
        </div>
        {item.type !== 'builtin' && (
          <input
            type="text"
            aria-label={intl.formatMessage(messages.name)}
            placeholder={intl.formatMessage(messages.name)}
            value={item.name}
            onChange={(e) => onChange({ ...item, name: e.target.value })}
            className="lg:w-56"
          />
        )}
        {item.type === 'custom' && (
          <input
            type="text"
            aria-label={intl.formatMessage(messages.url)}
            placeholder={intl.formatMessage(messages.url)}
            value={item.url}
            onChange={(e) => onChange({ ...item, url: e.target.value })}
            className="lg:flex-1"
          />
        )}
        {item.type === 'group' && (
          <div className="flex items-center lg:ml-auto">
            <Button
              buttonSize="sm"
              buttonType="danger"
              title={intl.formatMessage(globalMessages.delete)}
              onClick={onDelete}
            >
              <TrashIcon />
            </Button>
          </div>
        )}
        {item.type !== 'group' && (
          <div className="flex items-center gap-3 lg:ml-auto">
            <div
              className={`flex items-center gap-1 whitespace-nowrap text-sm ${
                isUnhideable ? 'pointer-events-none opacity-50' : ''
              }`}
              title={shownLabel}
            >
              <SlideCheckbox
                checked={!item.hidden}
                onClick={() => onChange({ ...item, hidden: !item.hidden })}
              />
              {shownLabel}
            </div>
            {item.type === 'custom' && (
              <Button
                buttonSize="sm"
                buttonType="danger"
                title={intl.formatMessage(globalMessages.delete)}
                onClick={onDelete}
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        )}
      </div>
      {item.type === 'custom' && item.url.trim() && !toSeerrPath(item.url) && (
        <div className="error mt-2">
          {intl.formatMessage(messages.urlInvalid)}
        </div>
      )}
      {item.type === 'custom' && isPickerOpen && (
        <IconPicker
          intl={intl}
          onSelect={(icon) => {
            onChange({ ...item, icon });
            onTogglePicker();
          }}
        />
      )}
    </li>
  );
};

const SettingsMenu = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MenuSettings>('/api/v1/settings/menu');
  const [items, setItems] = useState<MenuItem[]>();
  const [pickerIndex, setPickerIndex] = useState<number>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (data) {
      setItems(data.items);
    }
  }, [data]);

  if (!items && !error) {
    return <LoadingSpinner />;
  }

  if (!items) {
    return null;
  }

  // Items after a group row are shown nested under it
  const firstGroupIndex = items.findIndex((item) => item.type === 'group');
  const openPartEnd = firstGroupIndex === -1 ? items.length : firstGroupIndex;

  const moveItem = (from: number, to: number) => {
    const moved = items.slice();
    const [item] = moved.splice(from, 1);
    moved.splice(to, 0, item);
    setItems(moved);
    setPickerIndex(undefined);
  };

  // New items go at the end of the open part of the menu
  const addItem = () => {
    const added = items.slice();
    added.splice(openPartEnd, 0, {
      type: 'custom',
      name: '',
      url: '',
      icon: DEFAULT_MENU_ICON,
      hidden: false,
    });
    setItems(added);
    setPickerIndex(undefined);
  };

  // A new group goes at the end; its items are the ones dragged below it
  const addGroup = () => {
    setItems([...items, { type: 'group', name: '' }]);
    setPickerIndex(undefined);
  };

  // Default menu (no groups); custom items are kept, hidden, at the end
  const resetItems = () => {
    setItems([
      ...DEFAULT_MENU_ITEMS,
      ...items.flatMap((item) =>
        item.type === 'custom' ? [{ ...item, hidden: true }] : []
      ),
    ]);
    setPickerIndex(undefined);
  };

  const isValid = items.every(
    (item) =>
      item.type === 'builtin' ||
      (item.name.trim() && (item.type === 'group' || toSeerrPath(item.url)))
  );

  const save = async () => {
    setIsSubmitting(true);
    try {
      await axios.post('/api/v1/settings/menu', {
        items: items.map((item) =>
          item.type === 'builtin'
            ? item
            : item.type === 'group'
              ? { ...item, name: item.name.trim() }
              : { ...item, name: item.name.trim(), url: toSeerrPath(item.url) }
        ),
      });
      revalidate();
      mutate('/api/v1/settings/public');
      addToast(intl.formatMessage(messages.toastSettingsSuccess), {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch {
      addToast(intl.formatMessage(messages.toastSettingsFailure), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.menu),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.menuItems)}</h3>
        <p className="description">
          {intl.formatMessage(messages.menuItemsDescription)}
        </p>
      </div>
      <div className="section">
        <ul className="space-y-2">
          {items.map((item, index) => (
            <MenuRow
              key={index}
              item={item}
              index={index}
              intl={intl}
              isInGroup={firstGroupIndex !== -1 && index > firstGroupIndex}
              isPickerOpen={pickerIndex === index}
              onTogglePicker={() =>
                setPickerIndex(pickerIndex === index ? undefined : index)
              }
              onChange={(changed) =>
                setItems(items.map((i, n) => (n === index ? changed : i)))
              }
              onDelete={() => {
                setItems(items.filter((_, n) => n !== index));
                setPickerIndex(undefined);
              }}
              onMove={moveItem}
            />
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-2">
            <Button onClick={addItem}>
              <PlusIcon />
              <span>{intl.formatMessage(messages.addItem)}</span>
            </Button>
            <Button onClick={addGroup}>
              <PlusIcon />
              <span>{intl.formatMessage(messages.addGroup)}</span>
            </Button>
            <Button onClick={resetItems}>
              <ArrowPathIcon />
              <span>{intl.formatMessage(messages.resetMenu)}</span>
            </Button>
          </div>
          <p className="text-sm text-gray-400">
            {intl.formatMessage(messages.customItemsTip)}
          </p>
        </div>
        <div className="actions">
          <div className="flex justify-end">
            <span className="ml-3 inline-flex rounded-md shadow-sm">
              <Button
                buttonType="primary"
                disabled={isSubmitting || !isValid}
                onClick={() => save()}
              >
                <ArrowDownOnSquareIcon />
                <span>
                  {isSubmitting
                    ? intl.formatMessage(globalMessages.saving)
                    : intl.formatMessage(globalMessages.save)}
                </span>
              </Button>
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default SettingsMenu;
