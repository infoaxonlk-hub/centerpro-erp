"use client";
import {PurchaseLotFields} from "./purchase-lot-fields";
import {purchaseRowsTotal,purchaseProductLotError,type PurchaseLotSelection} from "@/lib/purchase-lots";
import {purchasePriceDefault,type LatestPurchasePrice} from "@/lib/product-price-defaults";
import {usePurchasePriceDefaults} from "@/lib/use-purchase-price-defaults";
import Link from "next/link";
import {Bill} from "@/components/bill";
import {DraftBill} from "@/components/draft-bill";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  CircleCheck,
  CloudOff,
  Minus,
  Layers3,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";
import { OfflinePosStatus } from "@/components/offline-pos-status";
import { DetailedPurchaseEntry } from "./detailed-purchase-entry";
import { formatPurchaseQuantityByUnit } from "@/lib/purchase-quantity-summary";
import { clearPosDraft, deletePosTask, enqueuePosTask, loadPosDraft, listPosDrafts, listPosTasks, savePosDraft, syncPosTasks, type OfflinePosTask, type StoredPosDraft } from "@/lib/offline-pos";
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
type LaborSession={id:string;center_id:string;title:string;operation:string;session_date:string};
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
type Product = {can_be_sold?:boolean;can_be_purchased?:boolean;can_be_manufactured?:boolean;
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit_of_measure: string;
  tracks_sacks?: boolean;
  tracks_purchase_lots?: boolean;
  product_qualities: Quality[];
};
type Price = { center_id: string; quality_id: string; price: number | string };
type PurchaseDraft = {
  centerId: string;
  supplierId: string;
  paymentLines: PaymentLine[];
  notes: string;
  lines: Line[];
  checkout: boolean;
  laborSessionId?: string;
  laborLoadCount?: string;
  entryMode?: "pos" | "detailed";
  requestId?: string | null;
};
type Line = {
  key: string;
  product_id: string;
  quality_id: string;
  location_id: string;
  quantity: number;
  sack_count: number;
  actual_price: number;
  lot_selection?: PurchaseLotSelection;
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
  suppliers: initialSuppliers,
  organizationId,
  products,
  latestPrices = [],
  bankAccounts,
  organizationName,
  userName,
  scopeId,
  laborSessions,
}: {
  centers: Center[];
  suppliers: Supplier[];
  organizationId: string;
  products: Product[];
  prices: Price[];
  latestPrices?: LatestPurchasePrice[];
  bankAccounts: BankAccount[];
  organizationName: string;
  userName: string;
  scopeId: string;
  laborSessions: LaborSession[];
}) {
  const latestConfirmedPrices=usePurchasePriceDefaults(organizationId,scopeId,latestPrices);
  const [centerId, setCenterId] = useState(centers[0]?.id ?? "");
  const [preferredEntryMode, setEntryMode] = useState<"pos" | "detailed">("pos");
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [supplierId, setSupplierId] = useState("");
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [supplierError, setSupplierError] = useState("");
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
  const sacksRequired=lines.some(line=>products.find(product=>product.id===line.product_id)?.tracks_sacks);
  const entryMode=sacksRequired?"detailed":preferredEntryMode;
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
  const [cashBalance, setCashBalance] = useState<{ centerId: string; amount: number } | null>(null);
  const [cashBalanceLoading, setCashBalanceLoading] = useState(false);
  const [cashBalanceRefresh, setCashBalanceRefresh] = useState(0);
  const [laborSessionId,setLaborSessionId]=useState("");
  const [laborLoadCount,setLaborLoadCount]=useState("0");
  const requestId = useRef<string | null>(null);
  const syncLock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const centerRef = useRef<HTMLSelectElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);
  const cartRef = useRef<HTMLElement>(null);
  const paymentScreenRef = useRef<HTMLElement>(null);
  const baseDraftKey = `purchase:${scopeId}`;
  const [draftKey, setDraftKey] = useState(baseDraftKey);
  const [draftBooted, setDraftBooted] = useState(false);
  const [storedDrafts, setStoredDrafts] = useState<StoredPosDraft<PurchaseDraft>[]>([]);
  const [switchingDraft, setSwitchingDraft] = useState(false);
  const [showDraftMenu, setShowDraftMenu] = useState(false);
  // These browser-local references label held orders only. The real purchase
  // order number is allocated by Supabase when the purchase is confirmed.
  const draftReference = draftKey === baseDraftKey
    ? "D-0001"
    : `D-${draftKey.slice(baseDraftKey.length + 1).replaceAll("-", "").slice(0, 6).toUpperCase()}`;
  const heldDrafts = storedDrafts.filter(row => row.key !== draftKey);
  useEffect(() => {
    if (!showDraftMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowDraftMenu(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showDraftMenu]);
  // Keep legacy `purchase:<userId>` drafts. Additional purchases use unique suffixes.
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const id = params.get("draft");
    setDraftKey(id && /^[a-f0-9-]{36}$/i.test(id) ? `${baseDraftKey}:${id}` : baseDraftKey);
    setDraftBooted(true);
  }, [baseDraftKey]);
  useEffect(() => {
    const readMode = () => {
      try {
        const value = localStorage.getItem("centerpro-purchase-view");
        setEntryMode(value === "detailed" ? "detailed" : "pos");
      } catch { setEntryMode("pos"); }
    };
    readMode();
    window.addEventListener("centerpro-purchase-view-change", readMode);
    return () => window.removeEventListener("centerpro-purchase-view-change", readMode);
  }, []);
  function changeEntryMode(mode: "pos" | "detailed") {
    if(mode==="pos"&&sacksRequired){notify("Sack-tracked products require detailed purchase entry.","error");return;}
    setEntryMode(mode);
    try {
      localStorage.setItem("centerpro-purchase-view", mode);
      window.dispatchEvent(new CustomEvent("centerpro-purchase-view-change", { detail: mode }));
    } catch {
      notify("Purchase view preference could not be saved in this browser.", "error");
    }
  }
  useEffect(() => {
    if (entryMode === "detailed" && !supplierId) {
      const cashFarmer = suppliers.find(s => s.name.trim().toLowerCase() === "cash farmer");
      setSupplierId(cashFarmer?.id ?? "__cash_farmer__");
    } else if (entryMode === "pos" && supplierId === "__cash_farmer__") setSupplierId("");
  }, [entryMode, supplierId, suppliers]);
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const center = centers.find((c) => c.id === centerId);
  useEffect(() => {
    if (!centerId || !isOnline) return;
    let live = true;
    setCashBalanceLoading(true);
    void (async () => {
      try {
        const { data, error } = await createClient().rpc("center_cash_balance", { target_center: centerId });
        if (!live) return;
        if (error || data === null) setCashBalance((current) => current?.centerId === centerId ? current : null);
        else setCashBalance({ centerId, amount: Number(data) });
      } catch {
        if (live) setCashBalance((current) => current?.centerId === centerId ? current : null);
      } finally {
        if (live) setCashBalanceLoading(false);
      }
    })();
    return () => { live = false; };
  }, [centerId, isOnline, cashBalanceRefresh]);
  useEffect(() => {
    if (!draftBooted) return;
    let live = true;
    const url = new URL(window.location.href);
    const startFresh = url.searchParams.get("new") === "1";
    if (startFresh) {
      url.searchParams.delete("new");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void Promise.all([
      startFresh ? Promise.resolve(null) : loadPosDraft<PurchaseDraft>(draftKey),
      listPosDrafts<PurchaseDraft>(baseDraftKey),
      // A queued purchase is separate from an unfinished draft; never bind an
      // unrelated queued requestId to the current new draft.
      listPosTasks(scopeId, "purchase"),
    ])
      .then(([draft, drafts, tasks]) => {
        if (!live) return;
        setStoredDrafts(drafts.filter(row => row.value?.lines?.length || row.value?.notes || row.value?.laborSessionId));
        if (draft) {
          setCenterId(draft.centerId);
          setSupplierId(draft.supplierId);
          setPaymentLines(draft.paymentLines);
          setNotes(draft.notes);
          setLines(draft.lines);
          setCheckout(draft.checkout);
          setLaborSessionId(draft.laborSessionId ?? "");
          setLaborLoadCount(draft.laborLoadCount ?? "0");
          // The user's selected Purchase view takes precedence over older draft metadata.
          // This prevents a POS-mode draft from hiding Detailed Purchase Order.
          let savedPurchasePreference: string | null = null;
          try { savedPurchasePreference = localStorage.getItem("centerpro-purchase-view"); } catch {}
          if (draft.entryMode && savedPurchasePreference !== "pos" && savedPurchasePreference !== "detailed") {
            setEntryMode(draft.entryMode);
          }
          requestId.current = draft.requestId ?? null;
        }
        // Legacy queued purchase screen only for the original draft URL.
        // Fresh named drafts may be started while another purchase awaits sync.
        if (draftKey === baseDraftKey && tasks.length && !startFresh) {
          requestId.current = tasks[0].requestId;
          setOfflineQueued(true);
          setPendingTotal(Number(tasks[0].payload.total ?? 0));
          const failed = tasks.find(task => task.lastError);
          setOfflineQueueError(failed?.lastError ?? "");
          setOfflineNeedsCorrection(Boolean(failed?.needsCorrection));
        }
      })
      .catch(() => {})
      .finally(() => { if (live) setDraftReady(true); });
    return () => { live = false; };
  }, [draftBooted, draftKey, scopeId, baseDraftKey]);
  useLayoutEffect(() => {
    if (!checkout) return;
    const resetPaymentScroll = () => {
      window.scrollTo(0, 0);
      if (paymentScreenRef.current) paymentScreenRef.current.scrollTop = 0;
    };
    resetPaymentScroll();
    const frame = requestAnimationFrame(resetPaymentScroll);
    return () => cancelAnimationFrame(frame);
  }, [checkout]);

  useEffect(() => {
    if (!draftReady || done || offlineQueued || switchingDraft) return;
    void savePosDraft(draftKey, { centerId, supplierId, paymentLines, notes, lines, checkout,laborSessionId,laborLoadCount,entryMode,requestId:requestId.current }).catch(() => {});
  }, [draftReady, done, offlineQueued, switchingDraft, draftKey, centerId, supplierId, paymentLines, notes, lines, checkout,laborSessionId,laborLoadCount,entryMode]);
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
  const purchaseDraftSnapshot = (): PurchaseDraft => ({
    centerId, supplierId, paymentLines, notes, lines, checkout, laborSessionId, laborLoadCount, entryMode, requestId: requestId.current,
  });
  async function switchPurchaseDraft(targetKey?: string) {
    if (busy || switchingDraft || !draftReady) return;
    setSwitchingDraft(true);
    try {
      // Explicitly wait for the save before leaving; each pending order keeps its
      // own IndexedDB record, including payment, supplier, lines and labor data.
      const snapshot = purchaseDraftSnapshot();
      if (snapshot.lines.length || snapshot.notes || snapshot.laborSessionId || (snapshot.supplierId && snapshot.supplierId !== "__cash_farmer__")) {
        await savePosDraft(draftKey, snapshot);
      } else {
        await clearPosDraft(draftKey);
      }
      const target = targetKey ?? `${baseDraftKey}:${crypto.randomUUID()}`;
      const suffix = target === baseDraftKey ? "" : `?draft=${encodeURIComponent(target.slice(baseDraftKey.length + 1))}`;
      window.location.assign(`/dashboard/purchases/new${suffix}`);
    } catch (cause) {
      setSwitchingDraft(false);
      notify(cause instanceof Error ? cause.message : "Could not save purchase draft. Please try again.", "error");
    }
  }
  const activeProducts = products.filter((p) =>
    p.can_be_purchased!==false && p.product_qualities.some((q) => q.is_active),
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
    return purchasePriceDefault(qid,q?.default_price??0,latestConfirmedPrices);
  }
  function add(product: Product, quality: Quality) {
    if(product.can_be_purchased===false){notify("This product cannot be purchased.","error");return;}
    if(lines.some(l=>l.product_id===product.id)){notify("This product is already selected. Use Add weighing to record more weights in its shared lot.","error");setQualityProduct(null);return;}
    const key=makeKey();
    setLines(old => old.some(l=>l.product_id===product.id)?old:[...old, {
        key, product_id: product.id, quality_id: quality.id,
        location_id: center?.allow_multiple_locations ? "" : (center?.locations.find(l => l.is_default)?.id ?? ""),
        quantity: entryMode === "detailed" || product.tracks_sacks ? 0 : 1, sack_count: 0, actual_price: rate(quality.id),
      }]);
    setQualityProduct(null);
  }
  function selectProduct(product: Product) {
    const qs = product.product_qualities.filter((q) => q.is_active);
    if (qs.length > 1) setQualityProduct(product);
    else if (qs[0]) add(product, qs[0]);
  }
  function update(key: string, change: Partial<Line>) {
    setLines(old=>{const source=old.find(row=>row.key===key);return old.map(l=>l.key===key?{...l,...change}:change.lot_selection&&l.product_id===source?.product_id?{...l,lot_selection:change.lot_selection}:l)});
  }
  function addWeightRow(line:Line){const key=makeKey();setLines(old=>{const source=old.find(row=>row.key===line.key);return source?[...old,{...source,key,quantity:0,sack_count:0}]:old});return key;}
  const total = useMemo(
    () => purchaseRowsTotal(lines),
    [lines],
  );
  async function createSupplier(fd: FormData) {
    const name = String(fd.get("name") ?? "").trim();
    if (!name) { setSupplierError("Supplier name is required."); return; }
    setSupplierBusy(true);
    setSupplierError("");
    try {
      const { data, error } = await createClient()
        .from("suppliers")
        .insert({
          organization_id: organizationId,
          name,
          phone: String(fd.get("phone") ?? "").trim() || null,
          nic_or_registration: String(fd.get("nic") ?? "").trim() || null,
          address: String(fd.get("address") ?? "").trim() || null,
          bank_details: String(fd.get("bank") ?? "").trim() || null,
          notes: String(fd.get("notes") ?? "").trim() || null,
        })
        .select("id,name,phone")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Supplier could not be created.");
      setSuppliers((current) => [...current, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(data.id);
      setShowSupplierDialog(false);
      notify("Supplier created and selected for this purchase.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Supplier could not be created.";
      setSupplierError(message);
      notify(message, "error");
    } finally {
      setSupplierBusy(false);
    }
  }
  const qty = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);
  const quantityWithUnits = useMemo(() => formatPurchaseQuantityByUnit(lines, products), [lines, products]);
  const totalSacks = useMemo(() => lines.reduce((s, l) => s + (Number(l.sack_count) || 0), 0), [lines]);
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
    else if(purchaseProductLotError(lines)) message=purchaseProductLotError(lines);
    else if(lines.some(l=>!products.some(p=>p.id===l.product_id&&p.can_be_purchased!==false))) message="A saved product is no longer available for purchasing. Remove it before continuing.";
    else if(lines.some(line=>products.find(product=>product.id===line.product_id)?.tracks_purchase_lots&&((line.lot_selection?.mode==="number"&&!line.lot_selection.number?.trim())||(line.lot_selection?.mode==="existing"&&!line.lot_selection.lot_id))))
      message="Enter a lot number or select an existing lot for each lot-tracked row.";
    else if (lines.some((l) => l.quantity <= 0))
      message = entryMode === "detailed" ? "Enter a weight greater than zero for every row." : "Enter a valid quantity for every item.";
    else if (entryMode === "detailed" && lines.some(l => !Number.isInteger(l.sack_count) || l.sack_count<0 || (products.find(p=>p.id===l.product_id)?.tracks_sacks&&l.sack_count===0)))
      message = "Enter whole sack counts; sack-tracked products require at least one sack per row.";
    else if (
      center?.allow_multiple_locations &&
      lines.some((l) => !l.location_id)
    )
      message = "Select a location for every purchase item.";
    else if (laborSessionId && (!Number.isInteger(Number(laborLoadCount)) || Number(laborLoadCount) < 0))
      message = "Enter a valid whole number of loads for the labor session.";
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
        supplierId: supplierId && supplierId !== "__cash_farmer__" ? supplierId : null,
        purchaseMode: entryMode,
        laborSessionId: laborSessionId||null,
        laborLoadCount: Math.max(0,Number(laborLoadCount)||0),
        useCashFarmer: entryMode === "detailed" && (!supplierId || supplierId === "__cash_farmer__"),
        sackCounts: entryMode === "detailed" ? lines.map(line => ({ sack_count: line.sack_count })) : [],
        notes,
        lines: lines.map(({ product_id, quality_id, location_id, quantity, actual_price,lot_selection }) => ({ product_id, quality_id, location_id, quantity, actual_price,...(lot_selection?{lot_selection}:{}) })),
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
      const result = await createClient().rpc("confirm_queued_purchase_with_lots", {
        p_request: task.requestId,
        target_center: task.payload.centerId,
        target_supplier: task.payload.supplierId,
        purchase_notes: task.payload.notes,
        purchase_lines: task.payload.lines,
        payment_allocations: task.payload.payments,
        p_labor_session: task.payload.laborSessionId,
        p_load_count: task.payload.laborLoadCount,
        p_detailed: entryMode === "detailed",
        ...(entryMode === "detailed" ? { purchase_sack_counts: task.payload.sackCounts, use_cash_farmer: Boolean(task.payload.useCashFarmer) } : {}),
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
    requestId.current = null;
    setCashBalanceRefresh((value) => value + 1);
    window.dispatchEvent(new Event("centerpro-purchase-confirmed"));
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
    const saved = task.payload as { centerId:string; supplierId:string|null; notes:string|null; laborSessionId?:string|null;laborLoadCount?:number;purchaseMode?:"pos"|"detailed"; sackCounts?:Array<{sack_count:number}>; lines:Array<{product_id:string;quality_id:string;location_id:string;quantity:number;actual_price:number;lot_selection?:PurchaseLotSelection}>; payments:Array<{method:PaymentMethod;amount:number;bank_account_id:string|null;reference:string|null;cheque_number:string|null;cheque_date:string|null}> };
    await deletePosTask(task.requestId);
    requestId.current = null;
    setCenterId(saved.centerId);
    setSupplierId(saved.supplierId ?? "");
    setNotes(saved.notes ?? "");
    setLaborSessionId(saved.laborSessionId??"");
    setLaborLoadCount(String(saved.laborLoadCount??0));
    setEntryMode(saved.purchaseMode === "detailed" ? "detailed" : "pos");
    setLines(saved.lines.map((line,index) => ({ ...line, key: makeKey(), sack_count: saved.sackCounts?.[index]?.sack_count ?? 0 })));
    setPaymentLines(saved.payments.map(line => ({ ...line, key: makeKey(), bank_account_id: line.bank_account_id ?? "", reference: line.reference ?? "", cheque_number: line.cheque_number ?? "", cheque_date: line.cheque_date ?? "" })));
    setCheckout(true);
    setOfflineQueueError("");
    setOfflineNeedsCorrection(false);
    setOfflineQueued(false);
    setError("The server did not post this purchase. Review the details and confirm again.");
  }
  const billData = {organization:organizationName,title:"PURCHASE BILL",date:new Date().toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:(center?.code??"")+" · "+(center?.name??""),party:suppliers.find(s=>s.id===supplierId)?.name??(supplierId==="__cash_farmer__"?"Cash Farmer":"Cash purchase"),user:userName,notes,total,lines:lines.map(l=>{const p=products.find(p=>p.id===l.product_id);return {name:p?.name??"",quality:p?.product_qualities.find(q=>q.id===l.quality_id)?.name,quantity:l.quantity,sacks:l.sack_count,unit:p?.unit_of_measure??"",price:l.actual_price,total:Math.round(l.quantity*l.actual_price*100)/100};})};
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
                  setNotes("");
                  setLaborSessionId("");
                  setLaborLoadCount("0");
                  requestId.current = null;
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
    <div className={`purchase-pos-full${checkout ? " is-payment-window" : ""}`}>
      <header className="pos-topbar">
        <Link href="/dashboard/purchases" className="pos-back">
          <ArrowLeft /> <span>Purchases</span>
        </Link>
        <div className="pos-brand">
          <b>CenterPro</b>
          <small>{entryMode === "detailed" ? "Detailed purchase order" : "Purchase POS"}</small>
        </div>
        <label>
          <kbd>F4</kbd> Center
          <select
            ref={centerRef}
            value={centerId}
            onChange={(e) => {
              setCenterId(e.target.value);
              setLines([]);
              setLaborSessionId("");
              setLaborLoadCount("0");
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
      <section className="pos-available-cash" aria-live="polite">
        <div className="pos-available-cash-label"><span><Banknote size={19}/></span><div><strong>Available center cash</strong><small>{center ? `${center.code} · ${center.name}` : "Select a center"}{!isOnline ? " · Offline" : ""}</small></div></div>
        <strong className="pos-available-cash-amount">{cashBalanceLoading ? "Checking…" : cashBalance?.centerId === centerId ? money(cashBalance.amount) : "Unavailable"}</strong>
        {!isOnline && <small className="pos-cash-offline-note">Last online balance only; the server checks cash when syncing.</small>}
      </section>
      <nav className="purchase-order-topbar" aria-label="Purchase drafts and view">
        <div className="purchase-order-current" title="Temporary draft reference. The official purchase number is assigned after confirmation.">
          <span>Order</span>
          <strong>{draftReference}</strong>
          <small>Draft</small>
        </div>
        <div className="purchase-order-tools">
          <label className="purchase-order-mode">
            <span className="purchase-order-mode-label">Purchase view</span>
            <select aria-label="Purchase view" value={entryMode} disabled={busy || switchingDraft || checkout || sacksRequired} onChange={e => changeEntryMode(e.target.value as "pos" | "detailed")}>
              <option value="pos">POS</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <button type="button" className="purchase-order-icon" title="Open saved purchase drafts" aria-label={`Open purchase drafts (${heldDrafts.length} held)`} aria-expanded={showDraftMenu} aria-controls="purchase-drafts-popover" onClick={() => setShowDraftMenu(value => !value)} disabled={!draftReady || switchingDraft || busy}>
            <Layers3 size={19} aria-hidden="true" />
            {heldDrafts.length > 0 && <span className="purchase-order-count">{heldDrafts.length}</span>}
          </button>
          <button type="button" className="purchase-order-icon purchase-order-new" title="Hold current purchase and start a new one" aria-label="Hold & new purchase" disabled={!draftReady || busy || switchingDraft} onClick={() => void switchPurchaseDraft()}>
            <Plus size={21} aria-hidden="true" />
          </button>
        </div>
        {showDraftMenu && <div id="purchase-drafts-popover" className="purchase-drafts-popover" role="group" aria-label="Saved purchase drafts">
          <div className="purchase-drafts-popover-head"><strong>Unfinished orders</strong><button type="button" aria-label="Close draft list" onClick={() => setShowDraftMenu(false)}><X size={17}/></button></div>
          <div className="purchase-drafts-list">
            <div className="purchase-drafts-current"><strong>{draftReference}</strong><span>Current draft · {lines.length} {lines.length === 1 ? "line" : "lines"}</span></div>
            {heldDrafts.map(row => {
              const draftCenter = centers.find(c => c.id === row.value.centerId);
              const draftSupplier = suppliers.find(s => s.id === row.value.supplierId);
              const ref = `D-${row.key.slice(baseDraftKey.length + 1).replaceAll("-", "").slice(0, 6).toUpperCase()}`;
              return <button type="button" key={row.key} className="purchase-drafts-item" onClick={() => void switchPurchaseDraft(row.key)}>
                <strong>{row.key === baseDraftKey ? "D-0001" : ref}</strong>
                <span>{draftCenter?.code ?? "Center"} · {draftSupplier?.name ?? "Cash Farmer"} · {row.value.lines.length} lines</span>
              </button>;
            })}
            {!heldDrafts.length && <p className="purchase-drafts-empty">No other unfinished orders on this device.</p>}
          </div>
          <small className="purchase-drafts-help">Drafts are saved on this device until confirmed.</small>
        </div>}
      </nav>
      {!checkout ? (
        entryMode === "detailed" ? (
          <DetailedPurchaseEntry
            organizationId={organizationId}
            center={center}
            suppliers={suppliers}
            supplierId={supplierId}
            onSupplierChange={setSupplierId}
            onAddSupplier={() => { setSupplierError(""); setShowSupplierDialog(true); }}
            products={products}
            visibleLines={lines}
            total={total}
            totalSacks={totalSacks}
            onSelectProduct={selectProduct}
            onAddWeightRow={addWeightRow}
            onUpdateLine={update}
            onRemoveLine={key => setLines(old => old.filter(line => line.key !== key))}
            onOpenPayment={openPayment}
            onSetError={setError}
          />
        ) : (
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
                    {product.tracks_purchase_lots&&<PurchaseLotFields organizationId={organizationId} productId={line.product_id} qualityId={line.quality_id} value={line.lot_selection} onChange={lot_selection=>update(line.key,{lot_selection})}/>}
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
        )
      ) : (
        <main className="pos-payment-screen" ref={paymentScreenRef}>
          <button className="payment-back" onClick={() => setCheckout(false)}>
            <ArrowLeft /> {entryMode === "detailed" ? "Back to purchase" : "Back to products"}
          </button>
          <section className="payment-card">
            <h1>Payment window</h1>
            {error && <div className="alert error">{error}</div>}
            <div className="payment-fields">
              <div className="supplier-select-row">
                <label>
                Supplier <small>{paymentLines.some((line) => line.method !== "cash") ? "(required)" : "(optional for Cash-only purchase)"}</small>
                <select
                  ref={supplierRef}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Select supplier</option>
                  {supplierId === "__cash_farmer__" && <option value="__cash_farmer__">Cash Farmer (default)</option>}
                  {suppliers.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                      {s.phone ? ` · ${s.phone}` : ""}
                    </option>
                  ))}
                </select>
                </label>
                <button type="button" className="ghost supplier-create-button" onClick={() => { setSupplierError(""); setShowSupplierDialog(true); }} disabled={!isOnline} title={!isOnline ? "Connect to the internet to add a supplier" : "Create a supplier"}>
                  <Plus size={15}/> New supplier
                </button>
              </div>
              <div className="split-payments">
                {laborSessions.some(s=>s.center_id===centerId)&&<div className="labor-pos-fields"><label>Labor session<select value={laborSessionId} onChange={e=>setLaborSessionId(e.target.value)}><option value="">No labor session</option>{laborSessions.filter(s=>s.center_id===centerId).map(s=><option key={s.id} value={s.id}>{s.title} · {s.session_date}</option>)}</select></label><label>Loads<input type="number" min="0" step="1" value={laborLoadCount} onChange={e=>setLaborLoadCount(e.target.value)}/></label></div>}
                <div className="split-payment-heading">
                  <strong>Payment allocations</strong>
                  <button type="button" className="ghost" onClick={addPayment}>
                    <Plus size={15} /> Add line
                  </button>
                </div>
                {Math.abs(allocationDifference) > 0.001 && (
                  <p className="purchase-allocation-warning" role="status">
                    {money(Math.abs(allocationDifference))} {allocationDifference > 0 ? "remaining to allocate" : "over allocated"}. Match the purchase total before confirming.
                  </p>
                )}
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
                        {p.unit_of_measure}{line.sack_count > 0 ? ` · ${line.sack_count} sacks` : ""}
                      </small>
                    </span>
                    <strong>{money(line.quantity * line.actual_price)}</strong>
                  </div>
                );
              })}
            </div>
            <div className="summary-total">
              <span>
                <small>Total quantity</small>
                <b>
                  {quantityWithUnits}
                </b>
              </span>
              <span>
                <small>Total amount</small>
                <strong>{money(total)}</strong>
              </span>
            </div>
          </aside>
          <div className="payment-actions">
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
          </div>
        </main>
      )}
      {showSupplierDialog && (
        <div className="dialog-backdrop quality-picker supplier-quick-create">
          <form action={createSupplier} className="dialog">
            <div className="dialog-head">
              <div><h2><Store size={19}/> Add supplier</h2><p>Create a supplier and select it for this purchase.</p></div>
              <button type="button" className="icon-btn" onClick={() => setShowSupplierDialog(false)} disabled={supplierBusy}><X/></button>
            </div>
            {supplierError && <div className="alert error" role="alert">{supplierError}</div>}
            <div className="form-grid">
              <label className="wide">Supplier name<input name="name" autoFocus required maxLength={160} placeholder="Enter supplier or business name"/></label>
              <label>Phone<input name="phone" type="tel" maxLength={40} placeholder="Optional"/></label>
              <label>NIC / Registration<input name="nic" maxLength={100} placeholder="Optional"/></label>
              <label className="wide">Address<input name="address" maxLength={300} placeholder="Optional"/></label>
              <label className="wide">Bank details<input name="bank" maxLength={300} placeholder="Optional"/></label>
              <label className="wide">Notes<input name="notes" maxLength={500} placeholder="Optional"/></label>
            </div>
            {!isOnline && <div className="alert error">Supplier creation needs an internet connection. Reconnect and try again.</div>}
            <div className="dialog-actions"><button type="button" className="ghost" onClick={() => setShowSupplierDialog(false)} disabled={supplierBusy}>Cancel</button><button type="submit" className="primary" disabled={supplierBusy || !isOnline}><Store size={16}/>{supplierBusy ? "Saving…" : "Save and select supplier"}</button></div>
          </form>
        </div>
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
