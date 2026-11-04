import { redirect } from "next/navigation";

import { AuthForm } from "../../components/auth-form";
import { getCurrentAuthState } from "../../lib/auth";

export default async function RegisterPage() {
  const auth = await getCurrentAuthState();
  if (auth.status === "authenticated") {
    redirect("/workspace");
  }

  return <AuthForm mode="register" permissionDenied={auth.status === "forbidden"} />;
}
