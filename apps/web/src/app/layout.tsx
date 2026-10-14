import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth";
import Navbar from "@/components/navbar";
import "./globals.css";
<<<<<<< HEAD
import Image from "next/image";
import LoginButton from "@/components/loginbutton";
=======
>>>>>>> main

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
<<<<<<< HEAD
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
=======
        <AuthProvider>
          <Navbar />
          <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
        </AuthProvider>
>>>>>>> main
      </body>
    </html>
  );
}
