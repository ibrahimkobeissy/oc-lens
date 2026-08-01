import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, ThemeScript } from "@/components/theme-provider";
import { AppShell } from "@/components/layout/app-shell";

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
    // ThemeScript (below) sets the `dark` class on this element before React
    // hydrates, so its class attribute legitimately differs between the
    // server-rendered markup and the live DOM — see theme-provider.tsx's doc comment.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/* Must be the first child in <body>, before ThemeProvider/children, so it
            runs before the browser paints anything after it (no flash of the wrong theme). */}
        <ThemeScript />
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
