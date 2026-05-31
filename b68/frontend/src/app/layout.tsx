import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '企业知识问答机器人',
  description: '基于 RAG 架构的企业内部知识问答系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
