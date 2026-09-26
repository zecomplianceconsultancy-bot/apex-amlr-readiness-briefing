import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Workspace",
  description: "Model-agnostische AI-werkplek met audit trail",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
