import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerCleanup } from "@/components/service-worker-cleanup";

// Every page is per-user and reads the database: never prerender at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Workspace",
  description: "Model-agnostische AI-werkplek met audit trail",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <ServiceWorkerCleanup />
        {children}
      </body>
    </html>
  );
}
