import type { Metadata } from 'next';
import { WorkspaceHome } from './workspace-home';

export const metadata: Metadata = {
  title: '工作台 · NovelBrain',
};

export default function WorkspacePage() {
  return <WorkspaceHome />;
}
