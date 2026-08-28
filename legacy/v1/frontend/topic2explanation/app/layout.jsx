import "./globals.css";
import { Dancing_Script } from "@next/font/google";

const font = Dancing_Script({
  weight: "600",
  subsets: ["latin"],
});

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${font.className}`}>{children}</body>
    </html>
  );
}
