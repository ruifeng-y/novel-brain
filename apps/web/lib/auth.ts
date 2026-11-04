import { authSessionResponseSchema, type AuthSessionData } from "@novel-brain/contracts";
import { cookies } from "next/headers";

export async function getCurrentAuth(): Promise<AuthSessionData | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader.includes("nb_session=")) {
    return null;
  }

  const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
  try {
    const response = await fetch(`${apiInternalUrl}/api/v1/auth/me`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!response.ok) {
      return null;
    }
    return authSessionResponseSchema.parse(await response.json()).data;
  } catch {
    return null;
  }
}
