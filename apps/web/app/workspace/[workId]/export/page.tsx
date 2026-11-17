import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ExportPublishWorkspace } from "../../../../components/export-publish-workspace";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function ExportPublishPage({
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
      <ExportPublishWorkspace workId={workId} />
    </AppShell>
  );
}
