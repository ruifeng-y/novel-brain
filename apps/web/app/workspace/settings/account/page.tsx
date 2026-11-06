import { redirect } from "next/navigation";

import { AccountSecurityPanel } from "../../../../components/account-security-panel";
import { AppShell } from "../../../../components/app-shell";
import { ModelConfigPanel } from "../../../../components/model-config-panel";
import { getCurrentAuthState } from "../../../../lib/auth";

export default async function AccountSettingsPage() {
  const auth = await getCurrentAuthState();
  if (auth.status === "unauthenticated") {
    redirect("/login?reason=session-expired");
  }
  if (auth.status === "forbidden") {
    redirect("/login?reason=permission");
  }

  return (
    <AppShell user={auth.data.user}>
      <section className="page-head">
        <div>
          <p className="eyebrow">账号与模型</p>
          <h1>把写作环境准备好</h1>
          <p className="page-sub">
            资料、笔名和登录设备由你管理；模型 Key 只显示掩码，费用由你自己的服务商账户承担。
          </p>
        </div>
      </section>
      <ModelConfigPanel />
      <AccountSecurityPanel initialUser={auth.data.user} />
    </AppShell>
  );
}
