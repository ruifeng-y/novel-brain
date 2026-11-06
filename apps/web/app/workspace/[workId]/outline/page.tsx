import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { OutlineWorkspace } from "../../../../components/outline-workspace";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function OutlinePage({
  params,
  searchParams,
}: {
  params: Promise<{ workId: string }>;
  searchParams: Promise<{ nodeId?: string }>;
}) {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }
  const { workId } = await params;
  const { nodeId } = await searchParams;

  return (
    <AppShell user={auth.data.user}>
      <OutlineWorkspace initialNodeId={nodeId} workId={workId} />
    </AppShell>
  );
}
