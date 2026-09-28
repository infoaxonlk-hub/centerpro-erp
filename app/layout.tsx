import type { Metadata } from "next";
import "./globals.css";
import "./standard-bill.css";
import "./tables.css";
import "./entities.css";
import "./masters.css";
import "./users.css";
import "./feedback.css";
import "./purchase-pos.css";
import "./purchase-keyboard.css";
import "./receipt.css";
import "./receipt-print-fix.css";
import "./purchase-pos-accessibility.css";
import "./payment-setup.css";
import "./auth-recovery.css";
import "./bank-accounts.css";
import "./purchases.css";
import "./stock.css";
import "./payment-reports.css";
import "./bank-reports.css";
import "./report-navigation.css";
import "./cheque-management.css";
import "./cash-handover.css";
import "./cash-topups.css";
import "./offline-pos.css";
import "./bill-return.css";
import { OfflineSupport } from "@/components/offline-pos-status";

export const metadata: Metadata = {
  title: "CenterPro | InfoAxon",
  description: "CenterPro - Spice collection center ERP by InfoAxon Software Solutions",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<OfflineSupport /></body></html>;
}
