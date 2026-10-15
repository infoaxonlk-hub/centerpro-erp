import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { SalesReceiptPreview } from "../sales-receipt-preview";

const one = <T,>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value;

export default async function SaleReceipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { supabase: s } = await requirePermission("sales");
  const { data: r, error } = await s.from("sales_orders")
    .select("*,centers(name,code),organizations(name,receipt_address,receipt_phone,receipt_email),profiles(full_name),sales_order_lines(*),sales_payments(*)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Sale receipt could not be loaded");
  if (!r) notFound();

  const center = one(r.centers), org = one(r.organizations), user = one(r.profiles);
  const { data: returns, error: returnError } = await s.from("bill_returns")
    .select("status,bill_return_lines(source_line_id,quantity)")
    .eq("bill_type", "sale").eq("bill_id", id).in("status", ["pending", "approved"]);
  if (returnError) throw new Error(returnError.message);

  const returned = new Map<string, number>();
  for (const ret of returns ?? []) for (const line of ret.bill_return_lines ?? [])
    returned.set(line.source_line_id, (returned.get(line.source_line_id) ?? 0) + Number(line.quantity));

  const returnLines = r.sales_order_lines.map((line: { id: string; product_name: string; quality_name: string; unit: string; quantity: number; unit_price: number }) => ({
    id: line.id, name: line.product_name, quality: line.quality_name, unit: line.unit,
    quantity: Number(line.quantity),
    available: Math.max(0, Number(line.quantity) - (returned.get(line.id) ?? 0)),
    unitPrice: Number(line.unit_price),
  }));

  return <SalesReceiptPreview id={id} canRequestReturn={r.status === "confirmed"} returnLines={returnLines} bill={{
    organization: org?.name ?? "CenterPro",
    companyDetails: [org?.receipt_address, org?.receipt_phone, org?.receipt_email].filter((value): value is string => !!value),
    title: r.status === "cancelled" ? "CANCELLED SALES RECEIPT" : "SALES RECEIPT",
    number: r.sale_number,
    date: new Date(r.confirmed_at).toLocaleString("en-LK", { timeZone: "Asia/Colombo" }),
    center: `${center?.code ?? ""} · ${center?.name ?? ""}`,
    party: r.customer_name,
    user: user?.full_name,
    total: Number(r.total_amount),
    paid: Number(r.paid_amount),
    credit: Number(r.credit_balance),
    status: r.status === "cancelled" ? "cancelled" : r.payment_status,
    notes: r.notes ?? undefined,
    lines: r.sales_order_lines.map((line: { product_name: string; quality_name: string; quantity: number; unit: string; unit_price: number; line_total: number }) => ({
      name: line.product_name, quality: line.quality_name, quantity: Number(line.quantity),
      unit: line.unit, price: Number(line.unit_price), total: Number(line.line_total),
    })),
    payments: r.sales_payments.map((payment: { method: string; amount: number; bank_name: string | null; account_number: string | null; branch_name: string | null; cheque_number: string | null; cheque_date: string | null }) => ({
      method: payment.method, amount: Number(payment.amount),
      details: [payment.bank_name, payment.account_number, payment.branch_name, payment.cheque_number ? `Cheque ${payment.cheque_number}` : null, payment.cheque_date].filter(Boolean).join(" · "),
    })),
  }} />;
}
