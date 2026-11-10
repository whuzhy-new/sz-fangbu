import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "深圳房补地图",
  description: "三个办公工区的预计算通勤范围、小区查询与分段路线明细。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-app-release="guide-scan-v1">
      <body className="antialiased">{children}</body>
    </html>
  );
}
