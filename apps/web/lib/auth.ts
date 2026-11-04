import { authSessionResponseSchema, type AuthSessionData } from "@novel-brain/contracts";
import { cookies } from "next/headers";

export type CurrentAuthState =
  | { status: "authenticated"; data: AuthSessionData }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

export async function getCurrentAuthState(): Promise<CurrentAuthState> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader.includes("nb_session=")) {
    return { status: "unauthenticated" };
  }

  const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
  try {
    const response = await fetch(`${apiInternalUrl}/api/v1/auth/me`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (response.status === 403) {
      return { status: "forbidden" };
    }
    if (!response.ok) {
      return { status: "unauthenticated" };
    }
    return {
      status: "authenticated",
      data: authSessionResponseSchema.parse(await response.json()).data,
    };
  } catch {
    return { status: "unauthenticated" };
  }
}
