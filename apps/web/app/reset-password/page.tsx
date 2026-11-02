import type { Metadata } from 'next';
import { AuthFrame } from '../auth-frame';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: '设置新密码 · NovelBrain',
};

export default function ResetPasswordPage() {
  return (
    <AuthFrame
      eyebrow="重新开始"
      title="设置新密码"
      intro="重置链接只能使用一次。保存后，所有设备都需要重新登录。"
    >
      <ResetPasswordForm />
    </AuthFrame>
  );
}
