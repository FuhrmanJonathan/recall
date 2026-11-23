import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth";
import Navbar from "@/components/navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recall",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved preference before paint to avoid a light flash. */}
        <script dangerouslySetInnerHTML={{ __html: `(() => {
          let theme;
          try { theme = localStorage.getItem("recall-theme"); } catch {}
          document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
        })();` }} />
      </head>
      <body>
        <AuthProvider>
          <Navbar />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
