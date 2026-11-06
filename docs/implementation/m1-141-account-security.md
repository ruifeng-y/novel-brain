# M1-141 账号资料、笔名、密码恢复与登录设备

> Issue: #141
> Capability IDs: ACCT-002, ACCT-003, ACCT-004
> UI parity matrix: auth, account-settings

## 实现范围

- 忘记密码与重置密码：邮件链接、30 分钟有效期、单次使用、数据库仅保存 SHA-256 token hash；重置成功后撤销该账号全部登录设备。
- 登录设备：列出当前与历史活跃设备，支持退出单个设备、退出其他设备和退出所有设备；撤销立即在服务端生效。
- 账号资料：显示名称、个人简介、头像链接，使用 `version` 乐观锁更新。
- 多笔名：创建、编辑、删除、切换默认笔名；名称在账号内唯一，始终保留一个默认笔名。
- 找回密码、资料、笔名和会话操作均使用真实 HTTP API；作者界面只显示作者语言。

## 数据与契约

- 新增 `password_resets` 与 `pen_names`，并为 `users` 增加 `bio`、`avatar_url`、`version`。
- 迁移合并 integration 的 `0023–0027` 后重新生成为 `0028_harsh_odin.sql`。
- 共享 Zod 契约新增密码恢复、账号资料、笔名和登录设备响应；头像只接受 `http`/`https` URL。
- 所有资料、笔名和会话查询均按当前会话用户隔离；笔名写入使用用户级 advisory lock 与版本检查。

## 验证接缝

- 契约：`packages/contracts/test/contracts.test.ts`。
- API：`apps/api/test/auth.integration.test.ts`，使用真实 PostgreSQL/Redis 与 Nest HTTP 路由。
- Web：`apps/web/e2e/parity/auth.spec.ts`、`apps/web/e2e/parity/account-settings.spec.ts`。

## 验证结果

- `pnpm check`：13 个测试文件、113 项通过，含 format、lint、typecheck。
- `apps/api/test/auth.integration.test.ts`：23 项通过，覆盖过期/重放/枚举防护、并发重置、并发撤销、跨用户笔名与会话访问、默认笔名不变量。
- `apps/web/e2e/parity/auth.spec.ts` + `account-settings.spec.ts`：23 项通过，覆盖真实邮件找回、资料/笔名/会话 CRUD，以及 loading/error/disabled/permission/rate-limit/session-expired 四档视口。
- `pnpm --filter @novel-brain/api openapi:generate`：通过，生成密码恢复、会话与用户笔名路由。

## 边界与遗留

- auth 与 account-settings 因 M1 新增内容回退为 `production-built`，生产 golden 需按 ADR 0027 重新截图并由作者签收。
- 密码重置记录的定期清理、账号导出与永久删除仍由 #134 承担。
- 本 ticket 不包含作品级笔名选择；作品资料写入继续使用现有 `penName` 字段。
