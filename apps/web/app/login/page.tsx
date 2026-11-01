import type { Metadata } from 'next';
import { AuthFrame } from '../auth-frame';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: '登录 · NovelBrain',
};

export default function LoginPage() {
  return (
    <AuthFrame eyebrow="继续写作" title="欢迎回来" intro="登录后继续你的作品、设定与章节。">
      <LoginForm />
    </AuthFrame>
  );
}
