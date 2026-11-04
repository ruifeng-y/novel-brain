import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { WorksDashboard } from "../../components/works-dashboard";
import { getCurrentAuthState } from "../../lib/auth";

export default async function WorkspacePage() {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }

  return (
    <AppShell user={auth.data.user}>
      <WorksDashboard displayName={auth.data.user.displayName} />
    </AppShell>
  );
}
