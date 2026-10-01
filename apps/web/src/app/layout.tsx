import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recall",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      {/* <img>id="logo" src="img.png" width=1px height= 1px</img> */}
      <h1>Recall</h1>
      <body>{children}</body>
    </html>
  );
}

// export default function DashboardLayout({
//   children,
// }: {
//   children: React.ReactNode
// }) {
//   return (
//     <html lang="en">
//       <body>
//         <h1 style="color:white">Recall</h1>
//         {/* Layout UI */}
//         {/* Place children where you want to render a page or nested layout */}
//         <main>{children}</main>
//       </body>
//     </html>
//   )
// }