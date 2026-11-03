import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "YouTube Content Library",
  description: "Organize YouTube videos into categories and subcategories."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
