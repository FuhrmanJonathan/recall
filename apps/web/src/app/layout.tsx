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
    <html lang="en">
      <body>
        <AuthProvider>
          <Navbar />
          <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
