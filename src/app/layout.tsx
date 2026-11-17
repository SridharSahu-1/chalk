import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chalk — A little clarity changes everything",
  description:
    "Turn your curiosity into understanding. Short AI lessons, a visual whiteboard, and a tutor you can ask anything.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
