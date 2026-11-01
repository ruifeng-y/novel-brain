import type { Metadata } from 'next';
import { AuthFrame } from '../auth-frame';
import { RegisterForm } from './register-form';

export const metadata: Metadata = {
  title: '创建账号 · NovelBrain',
};

export default function RegisterPage() {
  return (
    <AuthFrame
      eyebrow="新的故事"
      title="创建作者账号"
      intro="用邮箱验证码确认身份，注册后即可直接开始写作。"
    >
      <RegisterForm />
    </AuthFrame>
  );
}
