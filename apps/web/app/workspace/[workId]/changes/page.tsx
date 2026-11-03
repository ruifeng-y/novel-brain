import { WorkShellPage } from '../../../_components/work-shell-page';

export default async function ChangesPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params;
  return (
    <WorkShellPage
      active="changes"
      description="修改请求、影响分析、平行版本、版本图和回滚记录会在这里汇总。"
      eyebrow="版本"
      title="修改与版本"
      workId={workId}
    />
  );
}
