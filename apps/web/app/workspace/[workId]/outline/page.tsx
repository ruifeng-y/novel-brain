import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { OutlineWorkspace } from "../../../../components/outline-workspace";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function OutlinePage({ params }: { params: Promise<{ workId: string }> }) {
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
      <OutlineWorkspace workId={workId} />
    </AppShell>
  );
}
