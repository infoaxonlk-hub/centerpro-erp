import type { Metadata } from "next";
import "./globals.css";
import "./tables.css";
import "./entities.css";
import "./masters.css";
import "./users.css";
import "./purchases.css";

export const metadata: Metadata = {
  title: "CollectPro | InfoAxon",
  description: "CollectPro - Spice collection center ERP by InfoAxon Software Solutions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
