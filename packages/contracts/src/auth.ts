import { z } from 'zod';

export const sendCodeSchema = z.object({
  email: z.string().trim().email().max(320),
});

export const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  newPassword: z.string().min(8).max(128),
});

export const recoverAccountSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});

export type SendCodeInput = z.infer<typeof sendCodeSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RecoverAccountInput = z.infer<typeof recoverAccountSchema>;
