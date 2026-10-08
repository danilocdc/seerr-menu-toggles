import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsMenu from '@app/components/Settings/SettingsMenu';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const SettingsMenuPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsMenu />
    </SettingsLayout>
  );
};

export default SettingsMenuPage;
