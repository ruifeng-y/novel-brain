import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { WritingWorkspace } from "../../../../components/writing-workspace";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function WritingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workId: string }>;
  searchParams: Promise<{ chapterId?: string }>;
}) {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }
  const { workId } = await params;
  const { chapterId } = await searchParams;

  return (
    <AppShell user={auth.data.user}>
      <WritingWorkspace initialChapterId={chapterId} workId={workId} />
    </AppShell>
  );
}
