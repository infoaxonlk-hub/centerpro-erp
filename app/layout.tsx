import type { Metadata } from "next";
import "./globals.css";
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

export const metadata: Metadata = {
  title: "CollectPro | InfoAxon",
  description: "CollectPro - Spice collection center ERP by InfoAxon Software Solutions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
