import type { Metadata } from 'next';
import { NewProjectWizard } from './new-project-wizard';

export const metadata: Metadata = {
  title: '新建作品 · NovelBrain',
};

export default function NewProjectPage() {
  return <NewProjectWizard />;
}
