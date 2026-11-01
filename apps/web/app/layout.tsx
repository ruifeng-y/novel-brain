import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NovelBrain',
  description: '面向个人作者的长篇 AI 创作平台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
