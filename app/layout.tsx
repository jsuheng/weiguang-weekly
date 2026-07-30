import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL || "http://localhost:3000"),
  title: "周报 · 运营协作中心",
  applicationName: "周报",
  description: "账号数据、团队周报与每日任务一体化运营看板。",
  openGraph: {
    title: "周报 · 运营协作中心",
    description: "让账号数据、周报点评与团队执行都清晰可见。",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "周报 · 运营协作中心",
    description: "让账号数据、周报点评与团队执行都清晰可见。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
