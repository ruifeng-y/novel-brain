import type { Request } from 'express';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  status: 'active' | 'disabled' | 'pending_deletion' | 'deleted';
  deletionScheduledFor: string | null;
  createdAt: string;
};

export type AuthIdentity = {
  sessionId: string;
  user: PublicUser;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthIdentity;
};
