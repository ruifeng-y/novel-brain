import type { Metadata } from 'next';
import { ModelSettings } from './model-settings';

export const metadata: Metadata = {
  title: '模型设置 · NovelBrain',
};

export default function ModelSettingsPage() {
  return <ModelSettings />;
}
