import { createServer } from "node:http";

const port = 3001;
const origin = "http://localhost:3000";
let sequence = 1;
let sessions = new Map();
let users = new Map();

function reset() {
  sequence = 1;
  sessions = new Map();
  users = new Map([
    [
      "lin@example.com",
      {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c01",
        email: "lin@example.com",
        password: "StrongPassword123",
        displayName: "林见鹿",
        createdAt: new Date("2026-11-04T08:00:00.000Z").toISOString(),
      },
    ],
  ]);
}

reset();

function envelope(data) {
  return { data, requestId: `req_mock_${sequence++}`, meta: {} };
}

function uuid7(index) {
  return `0190f5e2-7e7a-7f4e-8d38-${String(index).padStart(12, "0")}`;
}

function error(status, code, message) {
  return {
    status,
    body: {
      error: { code, message, details: {}, requestId: `req_mock_${sequence++}` },
    },
  };
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((pair) => pair.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function userPayload(user) {
  return {
    id: user.id,
    emailMasked: `${user.email.slice(0, 2)}***@${user.email.split("@")[1]}`,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

function sessionPayload(session) {
  return {
    id: session.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    current: true,
    userAgent: "playwright",
    createdAt: new Date().toISOString(),
  };
}

function createSession(user, response) {
  const token = `session-${sequence++}`;
  const session = {
    id: uuid7(sequence),
    token,
    user,
  };
  sessions.set(token, session);
  response.setHeader(
    "set-cookie",
    `nb_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
  );
  return session;
}

async function body(request) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
  }
  return data ? JSON.parse(data) : {};
}

function requireCsrf(request, cookies) {
  if (
    request.headers.origin !== origin ||
    !cookies.nb_csrf ||
    request.headers["x-csrf-token"] !== cookies.nb_csrf
  ) {
    return error(403, "AUTH_CSRF_INVALID", "CSRF 校验失败");
  }
  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const cookies = parseCookies(request.headers.cookie);

  if (url.pathname === "/__test/reset") {
    reset();
    json(response, 200, { reset: true });
    return;
  }

  if (url.pathname === "/api/v1/health") {
    json(
      response,
      200,
      envelope({ status: "ok", service: "api", timestamp: new Date().toISOString() }),
    );
    return;
  }

  if (url.pathname === "/api/v1/health/ready") {
    json(
      response,
      200,
      envelope({
        status: "ready",
        service: "api",
        timestamp: new Date().toISOString(),
        checks: [
          { name: "database", status: "up", latencyMs: 1 },
          { name: "queue", status: "up", latencyMs: 1 },
        ],
      }),
    );
    return;
  }

  if (url.pathname === "/api/v1/auth/csrf" && request.method === "GET") {
    const token = `csrf-${sequence++}-token-value-with-sufficient-length`;
    response.setHeader("set-cookie", `nb_csrf=${token}; HttpOnly; SameSite=Lax; Path=/`);
    json(response, 200, envelope({ token }));
    return;
  }

  if (request.method === "POST") {
    const csrfFailure = requireCsrf(request, cookies);
    if (csrfFailure) {
      json(response, csrfFailure.status, csrfFailure.body);
      return;
    }
  }

  if (url.pathname === "/api/v1/auth/register/send-code" && request.method === "POST") {
    const input = await body(request);
    if (String(input.email).startsWith("rate-limited@")) {
      const failure = error(429, "AUTH_RATE_LIMITED", "请求过于频繁，请稍后再试");
      json(response, failure.status, failure.body);
      return;
    }
    json(
      response,
      200,
      envelope({ sent: true, expiresAt: new Date(Date.now() + 600_000).toISOString() }),
    );
    return;
  }

  if (url.pathname === "/api/v1/auth/register" && request.method === "POST") {
    const input = await body(request);
    if (input.code !== "123456") {
      const failure = error(400, "AUTH_CODE_INVALID", "验证码错误");
      json(response, failure.status, failure.body);
      return;
    }
    const user = {
      id: uuid7(sequence),
      email: String(input.email).toLowerCase(),
      password: input.password,
      displayName: input.displayName,
      createdAt: new Date().toISOString(),
    };
    users.set(user.email, user);
    const session = createSession(user, response);
    json(response, 200, envelope({ user: userPayload(user), session: sessionPayload(session) }));
    return;
  }

  if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
    const input = await body(request);
    const user = users.get(String(input.email).toLowerCase());
    if (!user || user.password !== input.password) {
      const failure = error(401, "AUTH_LOGIN_FAILED", "邮箱或密码不正确");
      json(response, failure.status, failure.body);
      return;
    }
    const session = createSession(user, response);
    json(response, 200, envelope({ user: userPayload(user), session: sessionPayload(session) }));
    return;
  }

  if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
    const session = sessions.get(cookies.nb_session);
    if (!session) {
      const failure = error(401, "AUTH_SESSION_INVALID", "登录状态已失效");
      json(response, failure.status, failure.body);
      return;
    }
    json(
      response,
      200,
      envelope({
        user: userPayload(session.user),
        session: sessionPayload(session),
      }),
    );
    return;
  }

  if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
    sessions.delete(cookies.nb_session);
    json(response, 200, envelope({ loggedOut: true }), {
      "set-cookie": "nb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
    return;
  }

  const failure = error(404, "INTERNAL_ERROR", "Not found");
  json(response, failure.status, failure.body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "auth.mock.ready", port }));
});
