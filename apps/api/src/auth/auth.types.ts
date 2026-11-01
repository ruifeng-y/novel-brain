import type { Request } from 'express';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type AuthIdentity = {
  sessionId: string;
  user: PublicUser;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthIdentity;
};
