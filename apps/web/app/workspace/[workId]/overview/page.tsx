import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { WorkOverview } from "../../../../components/work-overview";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function WorkOverviewPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }
  const { workId } = await params;

  return (
    <AppShell user={auth.data.user}>
      <WorkOverview workId={workId} />
    </AppShell>
  );
}
