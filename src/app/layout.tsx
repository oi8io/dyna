import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Dyna Studio — 一句话，做成一个能玩的东西",
    template: "%s · Dyna Studio",
  },
  description:
    "描述你的想法，Dyna Studio 生成真实的前端工程并完成构建，立刻打开来玩、接着改，然后分享链接。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
