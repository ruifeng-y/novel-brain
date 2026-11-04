import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "墨舟 · NovelBrain",
  description: "长篇 AI 小说创作工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
