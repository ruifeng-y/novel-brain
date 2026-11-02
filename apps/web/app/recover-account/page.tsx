import type { Metadata } from 'next';
import { AuthFrame } from '../auth-frame';
import { RecoverAccountForm } from './recover-account-form';

export const metadata: Metadata = {
  title: '恢复账号 · NovelBrain',
};

export default function RecoverAccountPage() {
  return (
    <AuthFrame
      eyebrow="30 天恢复期"
      title="恢复账号"
      intro="输入注销前使用的邮箱和密码。恢复成功后，作品和设定会回到账号中。"
    >
      <RecoverAccountForm />
    </AuthFrame>
  );
}
