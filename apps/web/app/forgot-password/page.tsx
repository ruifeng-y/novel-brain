import { redirect } from "next/navigation";

import { PasswordRecoveryForm } from "../../components/password-recovery-form";
import { getCurrentAuthState } from "../../lib/auth";

export default async function ForgotPasswordPage() {
  const auth = await getCurrentAuthState();
  if (auth.status === "authenticated") {
    redirect("/workspace");
  }

  return <PasswordRecoveryForm mode="forgot" />;
}
