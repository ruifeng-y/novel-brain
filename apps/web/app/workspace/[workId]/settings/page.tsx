import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { SettingsCenter } from "../../../../components/settings-center";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workId: string }>;
  searchParams: Promise<{ column?: string; entityId?: string }>;
}) {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }
  const { workId } = await params;
  const { column, entityId } = await searchParams;

  return (
    <AppShell user={auth.data.user}>
      <SettingsCenter initialColumn={column} initialEntityId={entityId} workId={workId} />
    </AppShell>
  );
}
