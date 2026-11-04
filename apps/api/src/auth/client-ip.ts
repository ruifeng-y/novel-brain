import { resolveProxyIpSecret, verifyClientIp } from "@novel-brain/core";
import type { Request } from "express";

export function getClientIp(request: Request): string {
  const secret = resolveProxyIpSecret(
    process.env.PROXY_IP_SECRET,
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP,
  );
  const verified = verifyClientIp(request.headers["x-client-ip"] as string | undefined, secret);
  return verified ?? request.socket.remoteAddress ?? "unknown";
}
