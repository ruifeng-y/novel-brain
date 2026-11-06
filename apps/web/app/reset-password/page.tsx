import { PasswordRecoveryForm } from "../../components/password-recovery-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const tokenParam = (await searchParams).token;
  const token = typeof tokenParam === "string" ? tokenParam : "";

  return <PasswordRecoveryForm mode="reset" token={token} />;
}
