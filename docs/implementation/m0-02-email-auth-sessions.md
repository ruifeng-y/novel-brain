# M0-02 邮箱注册、登录与会话

> Issue: #68
> Capability IDs: ACCT-001, ACCT-009
> UI parity matrix: auth

## 实现范围

- 邮箱验证码注册，验证码通过 Mailpit SMTP 发送，有效期 10 分钟。
- 注册验证码、登录和 IP/邮箱限流由 Redis 持久计数。
- 密码使用 Argon2id 哈希；会话使用 opaque token，数据库只保存 SHA-256 哈希。
- `nb_session` Cookie 使用 `HttpOnly`、`SameSite=Lax`，生产可开启 `Secure`。
- 所有写请求校验同源 `Origin` 和 double-submit CSRF token。
- `/login`、`/register` 使用签收原型结构；工作区要求有效会话，过期会话重定向登录页。
- 退出登录撤销服务端会话并清除认证 Cookie。

## 数据与契约

- 新增 `users`、`sessions`、`email_verification_codes`。
- 共享 Zod 契约覆盖注册、登录、CSRF、当前账号和会话。
- OpenAPI 由 NestJS Swagger 从控制器生成，并派生 TypeScript 类型。

## 验证接缝

- API：通过 `/api/v1/auth/*` HTTP 边界和真实 PostgreSQL/Redis 集成测试验证。
- Web：通过 Playwright 验证注册、登录、退出、过期会话、限流和四档响应式。
- 邮件：API 集成测试使用捕获式 fake gateway；Compose 真实链路使用 Mailpit。

## 边界

- 找回密码、恢复账号和账号资料属于后续 ticket。
- 生产 golden 仍需按 ADR 0027 在作者签收后创建。

## 验证结果

- `pnpm check`：通过，14 个单元/契约测试。
- `pnpm test:integration`：通过，5 个真实 PostgreSQL/Redis HTTP 集成测试。
- `pnpm test:e2e`：通过，10 个 Playwright 测试，覆盖注册、登录、登出、过期会话、限流、权限态和四档响应式。
- 真实 Compose + Mailpit 浏览器链路：注册验证码发送、注册、进入工作区、退出登录全部通过。
- 真实 API 链路：登出后使用旧 `nb_session` Cookie 调用 `/auth/me` 返回 `401 AUTH_SESSION_INVALID`。
