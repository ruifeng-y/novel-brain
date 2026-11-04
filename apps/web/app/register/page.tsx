import { redirect } from "next/navigation";

import { AuthForm } from "../../components/auth-form";
import { getCurrentAuth } from "../../lib/auth";

export default async function RegisterPage() {
  if (await getCurrentAuth()) {
    redirect("/workspace");
  }

  return <AuthForm mode="register" />;
}
