import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@uxie/character/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "UXie",
  description: "A Socratic study companion for reading UX research papers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
