import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app-name";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "freee会計を使った個人事業の年間収支・税額予測",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
