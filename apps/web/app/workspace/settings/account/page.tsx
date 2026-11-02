import type { Metadata } from 'next';
import { AccountSettings } from './account-settings';

export const metadata: Metadata = {
  title: '账号设置 · NovelBrain',
};

export default function AccountSettingsPage() {
  return <AccountSettings />;
}
