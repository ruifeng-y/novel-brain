import { apiErrorSchema } from "@novel-brain/contracts";
import { createRequestId, resolveProxyIpSecret, signClientIp } from "@novel-brain/core";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const { path } = await context.params;
  const target = new URL(`/api/v1/${path.join("/")}`, apiInternalUrl);
  target.search = request.nextUrl.search;
  const requestHeaders = new Headers();
  const forwardedFor =
    process.env.TRUST_PROXY_HEADERS === "true" ? request.headers.get("x-forwarded-for") : null;
  const clientIp = forwardedFor?.split(",")[0]?.trim() || "127.0.0.1";
  const proxySecret = resolveProxyIpSecret(
    process.env.PROXY_IP_SECRET,
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP,
  );
  requestHeaders.set("x-client-ip", signClientIp(clientIp, proxySecret));
  for (const header of [
    "accept",
    "content-type",
    "cookie",
    "origin",
    "user-agent",
    "x-csrf-token",
  ]) {
    const value = request.headers.get(header);
    if (value) {
      requestHeaders.set(header, value);
    }
  }

  try {
    const init: RequestInit = {
      cache: "no-store",
      method: request.method,
      headers: requestHeaders,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    const response = await fetch(target, init);

    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }
    for (const cookie of response.headers.getSetCookie()) {
      responseHeaders.append("set-cookie", cookie);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      apiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用",
          details: {},
          requestId: createRequestId(),
        },
      }),
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
