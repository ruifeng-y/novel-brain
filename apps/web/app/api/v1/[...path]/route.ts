import { apiErrorSchema } from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const { path } = await context.params;
  const target = new URL(`/api/v1/${path.join("/")}`, apiInternalUrl);
  target.search = request.nextUrl.search;

  try {
    const response = await fetch(target, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
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
