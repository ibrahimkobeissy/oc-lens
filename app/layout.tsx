import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "oc-lens",
  description: "A local-only, read-only analytics dashboard for opencode.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
