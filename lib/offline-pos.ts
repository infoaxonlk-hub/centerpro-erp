"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export type OfflinePosKind = "sale" | "purchase" | "farm_service";
export type OfflinePosTask = {
  requestId: string;
  scopeId: string;
  kind: OfflinePosKind;
  createdAt: string;
  payload: Record<string, unknown>;
  lastError?: string;
  needsCorrection?: boolean;
};

const DB_NAME = "centerpro-offline-pos";
const DB_VERSION = 1;
const TASKS = "tasks";
const DRAFTS = "drafts";
const STOCK = "stock";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Offline storage is unavailable in this browser."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASKS)) db.createObjectStore(TASKS, { keyPath: "requestId" });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STOCK)) db.createObjectStore(STOCK, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    let value:T;
    request.onsuccess = () => { value=request.result; };
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed."));
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Offline storage transaction failed.")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Offline storage transaction was aborted.")); };
  });
}

export const savePosDraft = (key: string, value: unknown) => withStore("drafts", "readwrite", s => s.put({ key, value, updatedAt: new Date().toISOString() }));
export async function loadPosDraft<T>(key: string): Promise<T | null> {
  const row = await withStore<{ key: string; value: T } | undefined>("drafts", "readonly", s => s.get(key));
  return row?.value ?? null;
}
export const clearPosDraft = (key: string) => withStore("drafts", "readwrite", s => s.delete(key));

// IndexedDB drafts are scoped per signed-in user. The original key remains supported
// so in-progress purchases saved before multi-draft support are not lost.
export type StoredPosDraft<T> = { key: string; value: T; updatedAt: string };
export async function listPosDrafts<T>(baseKey: string): Promise<StoredPosDraft<T>[]> {
  const rows = await withStore<StoredPosDraft<T>[]>(DRAFTS, "readonly", store => store.getAll());
  return (rows ?? [])
    .filter(row => row.key === baseKey || row.key.startsWith(`${baseKey}:`))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const saveCachedStock = (key: string, value: unknown) => withStore("stock", "readwrite", s => s.put({ key, value, updatedAt: new Date().toISOString() }));
export async function loadCachedStock<T>(key: string): Promise<T | null> {
  const row = await withStore<{ key: string; value: T } | undefined>("stock", "readonly", s => s.get(key));
  return row?.value ?? null;
}
export const enqueuePosTask = (task: OfflinePosTask) => withStore("tasks", "readwrite", s => s.put(task));
export const deletePosTask = (id: string) => withStore("tasks", "readwrite", s => s.delete(id));
export const updatePosTaskError = (task: OfflinePosTask, error: string, needsCorrection = false) => enqueuePosTask({ ...task, lastError: error, needsCorrection });

export async function listPosTasks(scopeId: string, kind?: OfflinePosKind): Promise<OfflinePosTask[]> {
  const rows = await withStore<OfflinePosTask[]>("tasks", "readonly", s => s.getAll());
  return (rows ?? []).filter(row => row.scopeId === scopeId && (!kind || row.kind === kind)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function syncPosTasks(client: SupabaseClient, scopeId: string, kind?: OfflinePosKind): Promise<Array<{ task: OfflinePosTask; id: string }>> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return [];
  const completed: Array<{ task: OfflinePosTask; id: string }> = [];
  for (const task of await listPosTasks(scopeId, kind)) {
    let needsCorrection = false;
    try {
      const p = task.payload;
      if(task.kind==='farm_service'&&p.editing)continue;
      if(task.kind==='farm_service'){
        const {data:{user},error:authError}=await client.auth.getUser();
        if(authError||!user||user.id!==p.userId||task.scopeId!==`centerpro:farm:${p.organizationId}:${user.id}`)throw new Error('Sign in to the original business account before syncing these service bills.');
        const access=await client.rpc('current_business_access');
        if(access.error||!access.data||access.data.organizationId!==p.organizationId||!access.data.operational||!access.data.enabledModules?.includes('farm_services')||!(access.data.userRole==='super_admin'||access.data.userPermissions?.includes('farm_services')))throw new Error('Farm Services access could not be verified. Restore business/module access before syncing.');
      }
      const result = task.kind === "farm_service"
        ? await client.rpc('confirm_farm_sale',{p_request:task.requestId,p_center:p.centerId,p_data:p.data})
        : task.kind === "sale"
        ? await client.rpc("confirm_center_sale_with_labor", {
            p_request: task.requestId,
            p_center: p.centerId,
            p_customer: p.customerId || null,
            p_notes: p.notes || null,
            p_lines: p.lines,
            p_payments: p.payments,
            p_labor_session: p.laborSessionId || null,
            p_load_count: Number(p.laborLoadCount || 0),
          })
        : await client.rpc("confirm_queued_purchase_with_lots", {
            p_request: task.requestId,
            target_center: p.centerId,
            target_supplier: p.supplierId || null,
            purchase_notes: p.notes || null,
            purchase_lines: p.lines,
            payment_allocations: p.payments,
            p_labor_session: p.laborSessionId || null,
            p_load_count: Number(p.laborLoadCount || 0),
            p_detailed: p.purchaseMode === "detailed",
            purchase_sack_counts: p.sackCounts ?? [],
            use_cash_farmer: Boolean(p.useCashFarmer),
          });
      if (result.error) { needsCorrection = !/failed to fetch|network|timeout|load failed|gateway|502|503|504/i.test(result.error.message); throw new Error(result.error.message); }
      const row = task.kind !== "purchase" ? null : Array.isArray(result.data) ? result.data[0] : result.data;
      const id = task.kind !== "purchase" ? String(result.data??'') : String((row as { purchase_id?: string } | null)?.purchase_id ?? "");
      if (!id || id === "undefined"||id==='null') throw new Error("Server did not return the posted bill ID.");
      if(task.kind==='farm_service')await savePosDraft(`farm-result:${task.scopeId}:${task.requestId}`,{id,requestId:task.requestId,display:p.display,language:p.language,createdAt:new Date().toISOString()});
      await deletePosTask(task.requestId);
      completed.push({ task, id });
      if(task.kind==="purchase"&&typeof window!=="undefined")window.dispatchEvent(new Event("centerpro-purchase-confirmed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sync this bill.";
      await updatePosTaskError(task, message, needsCorrection);
      // Stop so the operator can resolve the first failed transaction before later ones.
      break;
    }
  }
  return completed;
}
