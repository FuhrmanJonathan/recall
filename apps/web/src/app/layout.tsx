import type { Metadata } from "next";
import Link from "next/link";
import MenuButton from "@/components/menubutton";
import "./globals.css";
import Image from "next/image";
import LoginButton from "@/components/loginbutton";

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
        <header className = "flex bg-[steelblue] px-5 py-2">
          {/* left group */}
          <div className="flex flex-1 items-center gap-4 justify-start">
            {/* <Image src="/logo.png" alt="Recall logo" width={40} height={40} /> */}
            <Link href="/" className="logo">Recall</Link>
          </div>
          
          {/* center */}
          <div className = "flex flex-1 items-center gap-4 justify-center">
          </div>

          {/* right */}
          <div className = "flex flex-1 items-center gap-4 justify-end">
            <LoginButton/>
            <MenuButton/>
          </div>
          
        </header>
        {children}
      </body>
    </html>
  );
}