import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { NewProjectWizard } from "../../../components/new-project-wizard";
import { getCurrentAuthState } from "../../../lib/auth";

export default async function NewProjectPage() {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }

  return (
    <AppShell user={auth.data.user}>
      <NewProjectWizard />
    </AppShell>
  );
}
