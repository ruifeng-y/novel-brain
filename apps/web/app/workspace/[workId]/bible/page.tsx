import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { StoryBibleWorkspace } from "../../../../components/story-bible";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function StoryBiblePage({ params }: { params: Promise<{ workId: string }> }) {
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
      <StoryBibleWorkspace workId={workId} />
    </AppShell>
  );
}
