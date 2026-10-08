import type { Metadata } from "next";
import Link from "next/link";
import MenuButton from "@/components/menubutton";
import "./globals.css";
import Image from "next/image";

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
        <header>
          {/* <Image src="/logo.png" alt="Recall logo" width={40} height={40} /> */}
          <Link href="/">Recall</Link>
          
          <MenuButton />
        </header>
        {children}
      </body>
    </html>
  );
}