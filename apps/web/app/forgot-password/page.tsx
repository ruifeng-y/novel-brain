import type { Metadata } from 'next';
import { AuthFrame } from '../auth-frame';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = {
  title: '找回密码 · NovelBrain',
};

export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      eyebrow="找回访问"
      title="重置密码"
      intro="输入注册邮箱，我们会发送一封只能使用一次的密码重置邮件。"
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
