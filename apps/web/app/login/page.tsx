import { redirect } from "next/navigation";

import { AuthForm } from "../../components/auth-form";
import { getCurrentAuthState } from "../../lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const auth = await getCurrentAuthState();
  if (auth.status === "authenticated") {
    redirect("/workspace");
  }
  const reason = (await searchParams).reason;

  return (
    <AuthForm
      mode="login"
      permissionDenied={auth.status === "forbidden" || reason === "permission"}
      sessionExpired={reason === "session-expired"}
    />
  );
}
