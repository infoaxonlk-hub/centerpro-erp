"use client";
import Link from "next/link";
import {Bill} from "@/components/bill";
import {DraftBill} from "@/components/draft-bill";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  CloudOff,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";
import { OfflinePosStatus } from "@/components/offline-pos-status";
import { clearPosDraft, deletePosTask, enqueuePosTask, loadPosDraft, listPosTasks, savePosDraft, syncPosTasks, type OfflinePosTask } from "@/lib/offline-pos";
type Location = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
};
type Center = {
  id: string;
  code: string;
  name: string;
  allow_multiple_locations: boolean;
  locations: Location[];
};
type Supplier = { id: string; name: string; phone: string | null };
type BankInfo = { id: string; code: string; name: string; is_active: boolean };
type BankAccount = {
  id: string;
  account_number: string;
  account_name: string | null;
  branch_name: string;
  branch_code: string;
  payment_banks: BankInfo | BankInfo[] | null;
};
type PaymentMethod = "cash" | "credit" | "bank_transfer" | "card" | "cheque";
type PaymentLine = {
  key: string;
  method: PaymentMethod;
  amount: number;
  bank_account_id: string;
  reference: string;
  cheque_number: string;
  cheque_date: string;
};
type Quality = {
  id: string;
  name: string;
  default_price: number | string;
  is_active: boolean;
  is_base: boolean;
};
type Product = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit_of_measure: string;
  product_qualities: Quality[];
};
type Price = { center_id: string; quality_id: string; price: number | string };
type Line = {
  key: string;
  product_id: string;
  quality_id: string;
  location_id: string;
  quantity: number;
  actual_price: number;
};
const money = (n: number) =>
  new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(n);
const makeKey = () => Math.random().toString(36).slice(2);
export function PurchaseForm({
  centers,
  suppliers,
  products,
  prices,
  bankAccounts,
  organizationName,
  userName,
  scopeId,
}: {
  centers: Center[];
  suppliers: Supplier[];
  products: Product[];
  prices: Price[];
  bankAccounts: BankAccount[];
  organizationName: string;
  userName: string;
  scopeId: string;
}) {
  const [centerId, setCenterId] = useState(centers[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    {
      key: makeKey(),
      method: "cash",
      amount: 0,
      bank_account_id: "",
      reference: "",
      cheque_number: "",
      cheque_date: "",
    },
  ]);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [qualityProduct, setQualityProduct] = useState<Product | null>(null);
  const [done, setDone] = useState<{
    number: string;
    total: number;
    paid: number;
    credit: number;
    status: string;
    payments: PaymentLine[];
  } | null>(null);
  const [receiptLanguage, setReceiptLanguage] = useState<"en" | "si">("en");
  const [selectedProduct, setSelectedProduct] = useState(0);
  const [selectedLine, setSelectedLine] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [offlineQueueError, setOfflineQueueError] = useState("");
  const [offlineNeedsCorrection, setOfflineNeedsCorrection] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const requestId = useRef<string | null>(null);
  const syncLock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const centerRef = useRef<HTMLSelectElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);
  const cartRef = useRef<HTMLElement>(null);
  const startFreshAfterQueue = useRef(false);
  const draftKey = `purchase:${scopeId}`;
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const center = centers.find((c) => c.id === centerId);
  useEffect(() => {
    let live = true;
    const url = new URL(window.location.href);
    if (url.searchParams.get("new") === "1") {
      startFreshAfterQueue.current = true;
      url.searchParams.delete("new");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const startFresh = startFreshAfterQueue.current;
    void Promise.all([
        startFresh ? Promise.resolve(null) : loadPosDraft<{centerId:string;supplierId:string;paymentLines:PaymentLine[];notes:string;lines:Line[];checkout:boolean}>(draftKey),
      listPosTasks(scopeId, "purchase"),
    ])
      .then(([draft, tasks]) => { if (live && draft) { setCenterId(draft.centerId); setSupplierId(draft.supplierId); setPaymentLines(draft.paymentLines); setNotes(draft.notes); setLines(draft.lines); setCheckout(draft.checkout); } if (live && tasks.length && !startFresh) { requestId.current = tasks[0].requestId; setOfflineQueued(true); setPendingTotal(Number(tasks[0].payload.total ?? 0)); const failed=tasks.find(task => task.lastError); setOfflineQueueError(failed?.lastError ?? ""); setOfflineNeedsCorrection(Boolean(failed?.needsCorrection)); } })
      .catch(() => {})
      .finally(() => { if (live) setDraftReady(true); });
    return () => { live = false; };
  }, [draftKey, scopeId]);
  useEffect(() => {
    if (!draftReady || done || offlineQueued) return;
    void savePosDraft(draftKey, { centerId, supplierId, paymentLines, notes, lines, checkout }).catch(() => {});
  }, [draftReady, done, offlineQueued, draftKey, centerId, supplierId, paymentLines, notes, lines, checkout]);
  useEffect(() => {
    let active = true;
    const syncPending = async () => {
      if (!draftReady || !navigator.onLine || syncLock.current) return;
      syncLock.current = true;
      try {
        const completed = await syncPosTasks(createClient(), scopeId, "purchase");
        if (!active) return;
        for (const { task, id } of completed) {
          if (task.requestId === requestId.current) {
            await clearPosDraft(draftKey).catch(() => {});
            window.location.assign(`/dashboard/purchases/${id}`);
            return;
          }
        }
        const tasks = await listPosTasks(scopeId, "purchase");
        if (active) { const failed=tasks.find(task => task.lastError); setOfflineQueueError(failed?.lastError ?? ""); setOfflineNeedsCorrection(Boolean(failed?.needsCorrection)); }
      } finally { syncLock.current = false; }
    };
    window.addEventListener("online", syncPending);
    window.addEventListener("centerpro-pos-queue", syncPending);
    void syncPending();
    return () => { active = false; window.removeEventListener("online", syncPending); window.removeEventListener("centerpro-pos-queue", syncPending); };
  }, [scopeId, draftKey, offlineQueued, draftReady]);
  const activeProducts = products.filter((p) =>
    p.product_qualities.some((q) => q.is_active),
  );
  const categories = [
    ...new Set(activeProducts.map((p) => p.category).filter(Boolean)),
  ] as string[];
  const visible = activeProducts.filter(
    (p) =>
      (category === "all" || p.category === category) &&
      `${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase().trim()),
  );
  function rate(qid: string) {
    const q = products
      .flatMap((p) => p.product_qualities)
      .find((q) => q.id === qid);
    return Number(
      prices.find((p) => p.center_id === centerId && p.quality_id === qid)
        ?.price ??
        q?.default_price ??
        0,
    );
  }
  function add(product: Product, quality: Quality) {
    const existing = lines.find(
      (l) => l.product_id === product.id && l.quality_id === quality.id,
    );
    if (existing)
      setLines((old) =>
        old.map((l) =>
          l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l,
        ),
      );
    else
      setLines((old) => [
        ...old,
        {
          key: makeKey(),
          product_id: product.id,
          quality_id: quality.id,
          location_id: center?.allow_multiple_locations
            ? ""
            : (center?.locations.find((l) => l.is_default)?.id ?? ""),
          quantity: 1,
          actual_price: rate(quality.id),
        },
      ]);
    setQualityProduct(null);
  }
  function selectProduct(product: Product) {
    const qs = product.product_qualities.filter((q) => q.is_active);
    if (qs.length > 1) setQualityProduct(product);
    else if (qs[0]) add(product, qs[0]);
  }
  function update(key: string, change: Partial<Line>) {
    setLines((old) =>
      old.map((l) => (l.key === key ? { ...l, ...change } : l)),
    );
  }
  const total = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.actual_price, 0),
    [lines],
  );
  const qty = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);
  const overrides = lines.filter(
    (l) => Math.abs(l.actual_price - rate(l.quality_id)) > 0.001,
  ).length;
  function updatePayment(key: string, change: Partial<PaymentLine>) {
    setPaymentLines((old) =>
      old.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  }
  function addPayment() {
    setPaymentLines((old) => {
      const currentAllocated = old.reduce(
        (sum, line) => sum + (Number(line.amount) || 0),
        0,
      );
      const remaining = Number(
        Math.max(0, total - currentAllocated).toFixed(2),
      );
      return [
        ...old,
        {
          key: makeKey(),
          method: "cash",
          amount: remaining,
          bank_account_id: "",
          reference: "",
          cheque_number: "",
          cheque_date: "",
        },
      ];
    });
  }
  function openPayment() {
    let message = "";
    if (!lines.length) message = "Add at least one purchase item.";
    else if (lines.some((l) => l.quantity <= 0))
      message = "Enter a valid quantity for every item.";
    else if (
      center?.allow_multiple_locations &&
      lines.some((l) => !l.location_id)
    )
      message = "Select a location for every purchase item.";
    if (message) {
      setError(message);
      notify(message, "error");
      return;
    }
    setPaymentLines((old) =>
      old.length === 1 && old[0].amount === 0
        ? [{ ...old[0], amount: Number(total.toFixed(2)) }]
        : old,
    );
    setError("");
    setCheckout(true);
  }
  const allocated = paymentLines.reduce(
    (sum, line) => sum + (Number(line.amount) || 0),
    0,
  );
  const creditAmount = paymentLines
    .filter((line) => line.method === "credit")
    .reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const paidAmount = allocated - creditAmount;
  const allocationDifference = Number((total - allocated).toFixed(2));
  async function confirm() {
    let message = "";
    const needsSupplier = paymentLines.some((line) => line.method !== "cash");
    if (needsSupplier && !supplierId)
      message = "Select a supplier when using a payment method other than Cash.";
    else if (!paymentLines.length) message = "Add at least one payment line.";
    else if (
      paymentLines.some(
        (line) =>
          !Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0,
      )
    )
      message = "Every payment amount must be greater than zero.";
    else if (Math.abs(allocationDifference) > 0.001)
      message = `Payment allocations must equal ${money(total)}.`;
    else if (
      paymentLines.some(
        (line) =>
          ["bank_transfer", "card", "cheque"].includes(line.method) &&
          !line.bank_account_id,
      )
    )
      message =
        "Select an active bank account for Bank Transfer, Card and Cheque lines.";
    else if (
      paymentLines.some(
        (line) =>
          line.method === "cheque" &&
          (!line.cheque_number.trim() || !line.cheque_date),
      )
    )
      message =
        "Cheque number and cheque date are required for every cheque line.";
    if (message) {
      setError(message);
      notify(message, "error");
      if (needsSupplier && !supplierId) supplierRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    const payload = paymentLines.map(
      ({
        method,
        amount,
        bank_account_id,
        reference,
        cheque_number,
        cheque_date,
      }) => ({
        method,
        amount: Number(Number(amount).toFixed(2)),
        bank_account_id: bank_account_id || null,
        reference: reference.trim() || null,
        cheque_number: cheque_number.trim() || null,
        cheque_date: cheque_date || null,
      }),
    );
    const task: OfflinePosTask = {
      requestId: requestId.current ??= crypto.randomUUID(),
      scopeId,
      kind: "purchase",
      createdAt: new Date().toISOString(),
      payload: {
        centerId,
        supplierId: supplierId || null,
        notes,
        lines: lines.map(({ product_id, quality_id, location_id, quantity, actual_price }) => ({ product_id, quality_id, location_id, quantity, actual_price })),
        payments: payload,
        total: Number(total.toFixed(2)),
      },
    };
    setBusy(false);
    const queueForLater = async (message?: string) => {
      try {
        await enqueuePosTask(task);
        await clearPosDraft(draftKey);
        setOfflineQueueError(message ?? "");
        setOfflineNeedsCorrection(false);
        setPendingTotal(Number(total.toFixed(2)));
        setOfflineQueued(true);
        window.dispatchEvent(new Event("centerpro-pos-queue"));
      } catch (storageError) {
        const text = storageError instanceof Error ? storageError.message : "This device could not save the offline purchase.";
        setError(text);
        notify(text, "error");
      }
    };
    if (!navigator.onLine) {
      await queueForLater();
      return;
    }
    setBusy(true);
    let data: unknown;
    let error: { message: string } | null;
    try {
      const result = await createClient().rpc("confirm_queued_purchase", {
        p_request: task.requestId,
        target_center: task.payload.centerId,
        target_supplier: task.payload.supplierId,
        purchase_notes: task.payload.notes,
        purchase_lines: task.payload.lines,
        payment_allocations: task.payload.payments,
      });
      data = result.data;
      error = result.error;
    } catch (rpcError) {
      setBusy(false);
      const text = rpcError instanceof Error ? rpcError.message : "Purchase could not reach the server.";
      if (!navigator.onLine || /failed to fetch|network|timeout|load failed/i.test(text)) { await queueForLater(text); return; }
      setError(text);
      notify(text, "error");
      return;
    }
    setBusy(false);
    if (error) {
      const isConnectionError = !navigator.onLine || /failed to fetch|network|timeout|load failed/i.test(error.message);
      if (isConnectionError) { await queueForLater(error.message); return; }
      setError(error.message);
      notify(error.message, "error");
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    await deletePosTask(task.requestId).catch(() => {});
    await clearPosDraft(draftKey).catch(() => {});
    setDone({
      number: row.purchase_number,
      total: Number(row.purchase_total),
      paid: Number(row.paid_amount),
      credit: Number(row.credit_balance),
      status: String(row.payment_status),
      payments: paymentLines.map((line) => ({ ...line })),
    });
    notify("Purchase confirmed successfully");
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "F3") {
        event.preventDefault();
        const list = ["all", ...categories];
        setCategory(
          (current) => list[(list.indexOf(current) + 1) % list.length],
        );
        return;
      }
      if (event.key === "F4") {
        event.preventDefault();
        centerRef.current?.focus();
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        setSelectedLine(0);
        document.querySelector<HTMLElement>('[data-cart-line="0"]')?.focus();
        return;
      }
      if (event.key === "F7") {
        event.preventDefault();
        document
          .querySelector<HTMLSelectElement>(`[data-location="${selectedLine}"]`)
          ?.focus();
        return;
      }
      if (event.key === "F8") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(`[data-price="${selectedLine}"]`)
          ?.focus();
        return;
      }
      if (event.key === "F9") {
        event.preventDefault();
        if (!checkout) openPayment();
        else supplierRef.current?.focus();
        return;
      }
      if (event.key === "F10") {
        event.preventDefault();
        if (checkout) void confirm();
        else openPayment();
        return;
      }
      if (event.key === "Escape") {
        if (qualityProduct) setQualityProduct(null);
        else if (checkout) setCheckout(false);
        return;
      }
      if (editing) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedProduct((i) =>
          Math.min(i + 1, Math.max(visible.length - 1, 0)),
        );
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedProduct((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (qualityProduct) {
          const first = qualityProduct.product_qualities.find(
            (q) => q.is_active,
          );
          if (first) add(qualityProduct, first);
        } else if (checkout) void confirm();
        else if (visible[selectedProduct])
          selectProduct(visible[selectedProduct]);
        return;
      }
      const line = lines[selectedLine];
      if (!line) return;
      if (event.key === "+") {
        event.preventDefault();
        update(line.key, { quantity: line.quantity + 1 });
      } else if (event.key === "-") {
        event.preventDefault();
        update(line.key, { quantity: Math.max(0.001, line.quantity - 1) });
      } else if (event.key === "Delete") {
        event.preventDefault();
        setLines((old) => old.filter((x) => x.key !== line.key));
        setSelectedLine((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function editPendingPurchase() {
    const tasks = await listPosTasks(scopeId, "purchase");
    const task = tasks.find(item => item.requestId === requestId.current) ?? tasks[0];
    if (!task?.needsCorrection) return;
    const saved = task.payload as { centerId:string; supplierId:string|null; notes:string|null; lines:Array<{product_id:string;quality_id:string;location_id:string;quantity:number;actual_price:number}>; payments:Array<{method:PaymentMethod;amount:number;bank_account_id:string|null;reference:string|null;cheque_number:string|null;cheque_date:string|null}> };
    await deletePosTask(task.requestId);
    requestId.current = null;
    setCenterId(saved.centerId);
    setSupplierId(saved.supplierId ?? "");
    setNotes(saved.notes ?? "");
    setLines(saved.lines.map(line => ({ ...line, key: makeKey() })));
    setPaymentLines(saved.payments.map(line => ({ ...line, key: makeKey(), bank_account_id: line.bank_account_id ?? "", reference: line.reference ?? "", cheque_number: line.cheque_number ?? "", cheque_date: line.cheque_date ?? "" })));
    setCheckout(true);
    setOfflineQueueError("");
    setOfflineNeedsCorrection(false);
    setOfflineQueued(false);
    setError("The server did not post this purchase. Review the details and confirm again.");
  }
  const billData = {organization:organizationName,title:"PURCHASE BILL",date:new Date().toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:(center?.code??"")+" · "+(center?.name??""),party:suppliers.find(s=>s.id===supplierId)?.name??"Cash purchase",user:userName,notes,total,lines:lines.map(l=>{const p=products.find(p=>p.id===l.product_id);return {name:p?.name??"",quality:p?.product_qualities.find(q=>q.id===l.quality_id)?.name,quantity:l.quantity,unit:p?.unit_of_measure??"",price:l.actual_price,total:Math.round(l.quantity*l.actual_price*100)/100};})};
  if (offlineQueued) return <div className="purchase-pos-full"><header className="pos-topbar"><Link href="/dashboard/purchases" className="pos-back"><ArrowLeft/><span>Purchases</span></Link><div className="pos-brand"><b>CenterPro</b><small>Purchase POS</small></div><OfflinePosStatus scopeId={scopeId} kind="purchase"/></header><main className="pos-offline-pending"><article><CloudOff size={48}/><h1>Purchase saved · waiting to sync</h1><p>This purchase is stored on this device. It has <strong>not</strong> changed stock or cash yet. When the connection returns, CenterPro will validate and post it.</p><strong>{money(pendingTotal)}</strong>{offlineQueueError&&<p className="alert error" role="alert">Sync needs attention: {offlineQueueError}</p>}<p>Keep this device and account available until the status shows synced. Server stock and cash balances are checked when posting.</p><div className="pos-offline-actions">{offlineNeedsCorrection&&<button className="ghost" onClick={()=>void editPendingPurchase()}>Review and edit saved purchase</button>}<button className="primary" onClick={()=>window.dispatchEvent(new Event("centerpro-pos-queue"))}><RefreshCw size={17}/> Try sync now</button><button className="ghost" onClick={()=>window.location.assign("/dashboard/purchases/new?new=1")}>New purchase</button><Link className="ghost" href="/dashboard/purchases">Purchase history</Link></div></article></main></div>;
  if (done) {
    return (
      <div className="purchase-pos-full">
        <main className="purchase-complete-layout">
          <section className="pos-complete">
            <CircleCheck size={70} />
            <h1>Purchase confirmed</h1>
            <p>
              {done.number} was posted to stock and the applicable payment,
              payable, cash and audit ledgers.
            </p>
            <strong>{money(done.total)}</strong>
            <div>
              <div className="bill-language receipt-language" aria-label="Receipt language"><button type="button" className={receiptLanguage === "en" ? "active" : ""} onClick={() => setReceiptLanguage("en")}>English</button><button type="button" className={receiptLanguage === "si" ? "active" : ""} onClick={() => setReceiptLanguage("si")}>සිංහල</button></div>
              <button
                className="ghost print-receipt-button"
                onClick={() => window.print()}
              >
                <Printer size={18} />
                Print receipt
              </button>
              <Link className="ghost" href="/dashboard/purchases">
                Purchase history
              </Link>
              <button
                className="primary"
                onClick={() => {
                  setDone(null);
                  setCheckout(false);
                  setLines([]);
                  setSupplierId("");
                  setPaymentLines([
                    {
                      key: makeKey(),
                      method: "cash",
                      amount: 0,
                      bank_account_id: "",
                      reference: "",
                      cheque_number: "",
                      cheque_date: "",
                    },
                  ]);
                }}
              >
                New purchase
              </button>
            </div>
          </section>
          <Bill data={{...billData,title:"PURCHASE RECEIPT",number:done.number,total:done.total,paid:done.paid,credit:done.credit,status:done.status,payments:done.payments,language:receiptLanguage}}/>
        </main>
      </div>
    );
  }
  return (
    <div className="purchase-pos-full">
      <header className="pos-topbar">
        <Link href="/dashboard/purchases" className="pos-back">
          <ArrowLeft /> <span>Purchases</span>
        </Link>
        <div className="pos-brand">
          <b>CenterPro</b>
          <small>Purchase POS</small>
        </div>
        <label>
          <kbd>F4</kbd> Center
          <select
            ref={centerRef}
            value={centerId}
            onChange={(e) => {
              setCenterId(e.target.value);
              setLines([]);
            }}
          >
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <OfflinePosStatus scopeId={scopeId} kind="purchase" />
      </header>
      {!isOnline&&<div className="pos-offline-warning" role="status">Offline: purchases can be saved on this device and will post only after server validation when connected.</div>}
      {!checkout ? (
        <main className="pos-sale-screen">
          <section className="pos-products">
            <div className="pos-search">
              <kbd>F2</kbd>
              <Search />
              <input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedProduct(0);
                }}
                placeholder="Search product code or name…"
              />
              {search && (
                <button onClick={() => setSearch("")}>
                  <X />
                </button>
              )}
            </div>
            {lines.length > 0 && (
              <button
                type="button"
                className="pos-mobile-cart-jump"
                aria-label={`Go to purchase cart, ${qty} items, ${money(total)}`}
                onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <ShoppingCart aria-hidden="true" />
                <span>Cart · {qty} {qty === 1 ? "item" : "items"}</span>
                <strong>{money(total)}</strong>
              </button>
            )}
            <div className="pos-categories">
              <button
                className={category === "all" ? "active" : ""}
                onClick={() => setCategory("all")}
              >
                <kbd>F3</kbd> All products
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className={category === c ? "active" : ""}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="pos-product-grid">
              {visible.map((product, index) => {
                const qs = product.product_qualities.filter((q) => q.is_active);
                return (
                  <button
                    key={product.id}
                    onFocus={() => setSelectedProduct(index)}
                    onClick={() => {
                      setSelectedProduct(index);
                      selectProduct(product);
                    }}
                    className={`pos-product ${selectedProduct === index ? "keyboard-selected" : ""}`}
                  >
                    <span>{product.code}</span>
                    <strong>{product.name}</strong>
                    <small>
                      {product.category || "Uncategorized"} ·{" "}
                      {product.unit_of_measure}
                    </small>
                    <b>
                      {qs.length > 1
                        ? `${qs.length} qualities`
                        : money(qs[0] ? rate(qs[0].id) : 0)}
                    </b>
                    <em>
                      <Plus size={15} /> Add item
                    </em>
                  </button>
                );
              })}
              {!visible.length && (
                <div className="product-empty">No products found.</div>
              )}
            </div>
          </section>
          <aside className="pos-cart" ref={cartRef}>
            <div className="pos-cart-head">
              <div>
                <kbd>F6</kbd>
                <ShoppingCart />
                <strong>Current purchase</strong>
              </div>
              <span>{lines.length} lines</span>
            </div>
            <div className="pos-cart-lines">
              {lines.map((line, index) => {
                const product = products.find((p) => p.id === line.product_id)!;
                const quality = product.product_qualities.find(
                  (q) => q.id === line.quality_id,
                )!;
                return (
                  <article
                    tabIndex={0}
                    data-cart-line={index}
                    onFocus={() => setSelectedLine(index)}
                    onClick={() => setSelectedLine(index)}
                    className={`pos-cart-line ${selectedLine === index ? "keyboard-selected" : ""}`}
                    key={line.key}
                  >
                    <div className="pos-line-title">
                      <span>{index + 1}</span>
                      <div>
                        <strong>{product.name}</strong>
                        <small>
                          {quality.is_base ? "No quality" : quality.name} ·{" "}
                          {product.unit_of_measure}
                        </small>
                      </div>
                      <button
                        onClick={() =>
                          setLines((old) =>
                            old.filter((x) => x.key !== line.key),
                          )
                        }
                      >
                        <Trash2 />
                      </button>
                    </div>
                    {center?.allow_multiple_locations && (
                      <label>
                        <kbd>F7</kbd> Stock location
                        <select
                          data-location={index}
                          className={!line.location_id ? "required-field" : ""}
                          value={line.location_id}
                          onChange={(e) =>
                            update(line.key, { location_id: e.target.value })
                          }
                        >
                          <option value="">Select location *</option>
                          {center.locations
                            .filter((l) => l.is_active)
                            .map((l) => (
                              <option value={l.id} key={l.id}>
                                {l.code} · {l.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <div className="pos-line-values">
                      <label>
                        <kbd>F8</kbd> Purchase price
                        <input
                          data-price={index}
                          type="number"
                          min="0"
                          step=".01"
                          value={line.actual_price}
                          onChange={(e) =>
                            update(line.key, {
                              actual_price: Number(e.target.value),
                            })
                          }
                        />
                        <small>System {money(rate(line.quality_id))}</small>
                      </label>
                      <div className="pos-qty">
                        <button
                          onClick={() =>
                            update(line.key, {
                              quantity: Math.max(0.001, line.quantity - 1),
                            })
                          }
                        >
                          <Minus />
                        </button>
                        <input
                          type="number"
                          min=".001"
                          step=".001"
                          value={line.quantity}
                          onChange={(e) =>
                            update(line.key, {
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                        <button
                          onClick={() =>
                            update(line.key, { quantity: line.quantity + 1 })
                          }
                        >
                          <Plus />
                        </button>
                      </div>
                    </div>
                    <div className="pos-line-total">
                      <span>
                        {line.quantity} × {money(line.actual_price)}
                      </span>
                      <strong>
                        {money(line.quantity * line.actual_price)}
                      </strong>
                    </div>
                  </article>
                );
              })}
              {!lines.length && (
                <div className="pos-empty-cart">
                  <ShoppingCart />
                  <strong>No items yet</strong>
                  <span>Select products from the left.</span>
                </div>
              )}
            </div>
            {error && <div className="alert error pos-error">{error}</div>}
            {overrides > 0 && (
              <div className="alert warning pos-warning">
                {overrides} price override{overrides > 1 ? "s" : ""}
              </div>
            )}
            <footer className="pos-cart-footer">
              <div>
                <span>
                  <small>Quantity</small>
                  <b>
                    {qty.toLocaleString("en-LK", { maximumFractionDigits: 3 })}
                  </b>
                </span>
                <span>
                  <small>Total</small>
                  <strong>{money(total)}</strong>
                </span>
              </div>
              <button
                className="primary pos-payment-button"
                disabled={!lines.length}
                onClick={openPayment}
              >
                <kbd>F9</kbd> Payment
              </button>
            </footer>
          </aside>
        </main>
      ) : (
        <main className="pos-payment-screen">
          <section className="payment-card">
            <button className="payment-back" onClick={() => setCheckout(false)}>
              <ArrowLeft /> Back to products
            </button>
            <span className="eyebrow dark">FINAL STEP</span>
            <h1>Split purchase payment</h1>
            <p>
              Add one or more allocations. Their total must exactly equal the
              purchase total.
            </p>
            {error && <div className="alert error">{error}</div>}
            <div className="payment-fields">
              <label>
                Supplier <small>{paymentLines.some((line) => line.method !== "cash") ? "(required)" : "(optional for Cash-only purchase)"}</small>
                <select
                  ref={supplierRef}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                      {s.phone ? ` · ${s.phone}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="split-payments">
                <div className="split-payment-heading">
                  <strong>Payment allocations</strong>
                  <button type="button" className="ghost" onClick={addPayment}>
                    <Plus size={15} /> Add line
                  </button>
                </div>
                {paymentLines.map((line, index) => {
                  const account = bankAccounts.find(
                    (a) => a.id === line.bank_account_id,
                  );
                  const bank = account
                    ? Array.isArray(account.payment_banks)
                      ? account.payment_banks[0]
                      : account.payment_banks
                    : null;
                  return (
                    <article className="split-payment-line" key={line.key}>
                      <div className="split-payment-title">
                        <b>Payment {index + 1}</b>
                        {paymentLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPaymentLines((old) =>
                                old.filter((x) => x.key !== line.key),
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <div className="split-payment-grid">
                        <label>
                          Method
                          <select
                            value={line.method}
                            onChange={(e) =>
                              updatePayment(line.key, {
                                method: e.target.value as PaymentMethod,
                                bank_account_id: "",
                                reference: "",
                                cheque_number: "",
                                cheque_date: "",
                              })
                            }
                          >
                            <option value="cash">Cash</option>
                            <option value="credit">Credit</option>
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="card">Card</option>
                            <option value="cheque">Cheque</option>
                          </select>
                        </label>
                        <label>
                          Amount (LKR)
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={line.amount || ""}
                            onChange={(e) =>
                              updatePayment(line.key, {
                                amount: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        {["bank_transfer", "card", "cheque"].includes(
                          line.method,
                        ) && (
                          <label className="wide">
                            Bank account
                            <select
                              value={line.bank_account_id}
                              onChange={(e) =>
                                updatePayment(line.key, {
                                  bank_account_id: e.target.value,
                                })
                              }
                            >
                              <option value="">Select active account</option>
                              {bankAccounts.map((a) => {
                                const b = Array.isArray(a.payment_banks)
                                  ? a.payment_banks[0]
                                  : a.payment_banks;
                                return (
                                  <option value={a.id} key={a.id}>
                                    {b?.name} · {a.account_number} ·{" "}
                                    {a.branch_name}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                        )}
                        {account && (
                          <div className="bank-account-details wide">
                            <span>
                              <small>Bank</small>
                              <b>
                                {bank?.name} ({bank?.code})
                              </b>
                            </span>
                            <span>
                              <small>Branch</small>
                              <b>
                                {account.branch_name} ({account.branch_code})
                              </b>
                            </span>
                            <span>
                              <small>Account</small>
                              <b>{account.account_number}</b>
                            </span>
                          </div>
                        )}
                        {line.method !== "credit" && (
                          <label className="wide">
                            Reference
                            <input
                              value={line.reference}
                              onChange={(e) =>
                                updatePayment(line.key, {
                                  reference: e.target.value,
                                })
                              }
                              placeholder="Optional reference"
                            />
                          </label>
                        )}
                        {line.method === "cheque" && (
                          <>
                            <label>
                              Cheque number
                              <input
                                value={line.cheque_number}
                                onChange={(e) =>
                                  updatePayment(line.key, {
                                    cheque_number: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Cheque date
                              <input
                                type="date"
                                value={line.cheque_date}
                                onChange={(e) =>
                                  updatePayment(line.key, {
                                    cheque_date: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <label>
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional purchase notes"
                />
              </label>
            </div>
          </section>
          <aside className="payment-summary">
            <h2>Purchase summary</h2>
            <div className="summary-center">
              <small>Receiving center</small>
              <strong>
                {center?.code} · {center?.name}
              </strong>
            </div>
            <div className="summary-lines">
              {lines.map((line) => {
                const p = products.find((x) => x.id === line.product_id)!;
                const q = p.product_qualities.find(
                  (x) => x.id === line.quality_id,
                )!;
                return (
                  <div key={line.key}>
                    <span>
                      <b>{p.name}</b>
                      <small>
                        {q.is_base ? "No quality" : q.name} · {line.quantity}{" "}
                        {p.unit_of_measure}
                      </small>
                    </span>
                    <strong>{money(line.quantity * line.actual_price)}</strong>
                  </div>
                );
              })}
            </div>
            <div
              className={`allocation-summary ${Math.abs(allocationDifference) < 0.001 ? "balanced" : "unbalanced"}`}
            >
              <span>
                <small>Purchase total</small>
                <b>{money(total)}</b>
              </span>
              <span>
                <small>Allocated</small>
                <b>{money(allocated)}</b>
              </span>
              <span>
                <small>Paid (excl. credit)</small>
                <b>{money(paidAmount)}</b>
              </span>
              <span>
                <small>Credit balance</small>
                <b>{money(creditAmount)}</b>
              </span>
              <strong>
                {Math.abs(allocationDifference) < 0.001
                  ? "Allocations balanced"
                  : `${money(Math.abs(allocationDifference))} ${allocationDifference > 0 ? "remaining" : "over allocated"}`}
              </strong>
            </div>
            <div className="summary-total">
              <span>
                <small>Total quantity</small>
                <b>
                  {qty.toLocaleString("en-LK", { maximumFractionDigits: 3 })}
                </b>
              </span>
              <span>
                <small>Total amount</small>
                <strong>{money(total)}</strong>
              </span>
            </div>
            <DraftBill data={billData} disabled={busy||!lines.length||!Number.isFinite(total)||total<=0}/>
            <button
              className="primary confirm-payment"
              disabled={busy || Math.abs(allocationDifference) > 0.001}
              onClick={confirm}
            >
              {busy ? (
                "Confirming…"
              ) : (
                <>
                  <Check /> Confirm purchase
                </>
              )}
            </button>
          </aside>
        </main>
      )}
      {qualityProduct && (
        <div className="dialog-backdrop quality-picker">
          <div className="dialog">
            <div className="dialog-head">
              <div>
                <h2>Select quality</h2>
                <p>
                  {qualityProduct.code} · {qualityProduct.name}
                </p>
              </div>
              <button
                className="icon-btn"
                onClick={() => setQualityProduct(null)}
              >
                <X />
              </button>
            </div>
            <div className="quality-options">
              {qualityProduct.product_qualities
                .filter((q) => q.is_active)
                .map((q) => (
                  <button key={q.id} onClick={() => add(qualityProduct, q)}>
                    <span>
                      <strong>{q.name}</strong>
                      <small>
                        {q.is_base
                          ? "No quality grade"
                          : qualityProduct.unit_of_measure}
                      </small>
                    </span>
                    <b>{money(rate(q.id))}</b>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
