import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "宝宝计划 · 家庭日常工作台", description: "家人一起安排和照顾宝宝的每一天。" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
