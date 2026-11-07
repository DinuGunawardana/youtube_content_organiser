import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Content Organiser",
  description: "Save and organise YouTube videos, articles, social media posts and website links."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
