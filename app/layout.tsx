import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

// AdSense publisher IDs are public identifiers. Keeping the verification
// tag and library URL explicit ensures they are present in the initial HTML.
const adsenseClientId = "ca-pub-2741821782196575";

export const metadata: Metadata = {
  title: "Content Organiser",
  description: "Save and organise YouTube videos, articles, social media posts and website links."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta
          name="google-adsense-account"
          content={adsenseClientId}
        />
        <Script
          id="google-adsense-library"
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClientId}`}
          crossOrigin="anonymous"
          strategy="beforeInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
