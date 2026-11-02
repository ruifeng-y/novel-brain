import { z } from 'zod';

export const emailChangeRequestSchema = z.object({
  newEmail: z.string().trim().email().max(320),
  currentPassword: z.string().min(1).max(128),
});

export const emailChangeVerifySchema = z.object({
  newEmail: z.string().trim().email().max(320),
  code: z.string().regex(/^\d{6}$/),
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(1_000).optional(),
    avatarUrl: z.union([z.string().trim().url().max(2_000), z.literal('')]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required',
  });

export const createPenNameSchema = z.object({
  name: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(1_000).optional(),
  avatarUrl: z.union([z.string().trim().url().max(2_000), z.literal('')]).optional(),
  isDefault: z.boolean().optional(),
});

export const updatePenNameSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    bio: z.string().trim().max(1_000).optional(),
    avatarUrl: z.union([z.string().trim().url().max(2_000), z.literal('')]).optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one pen name field is required',
  });

export const penNameIdSchema = z.string().uuid();

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
  confirmation: z.literal('注销账号'),
});

export type EmailChangeRequestInput = z.infer<typeof emailChangeRequestSchema>;
export type EmailChangeVerifyInput = z.infer<typeof emailChangeVerifySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreatePenNameInput = z.infer<typeof createPenNameSchema>;
export type UpdatePenNameInput = z.infer<typeof updatePenNameSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
