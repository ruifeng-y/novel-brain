import type { Request } from "express";

import type { SessionRecord, UserRecord } from "./auth.repository";

export interface RequestAuth {
  user: UserRecord;
  session: SessionRecord;
  tokenHash: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: RequestAuth;
}
