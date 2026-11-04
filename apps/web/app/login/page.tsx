import { redirect } from "next/navigation";

import { AuthForm } from "../../components/auth-form";
import { getCurrentAuth } from "../../lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  if (await getCurrentAuth()) {
    redirect("/workspace");
  }
  const reason = (await searchParams).reason;

  return (
    <AuthForm
      mode="login"
      permissionDenied={reason === "permission"}
      sessionExpired={reason === "session-expired"}
    />
  );
}
