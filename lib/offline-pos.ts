"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export type OfflinePosKind = "sale" | "purchase";
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed."));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Offline storage transaction failed.")); };
  });
}

export const savePosDraft = (key: string, value: unknown) => withStore("drafts", "readwrite", s => s.put({ key, value, updatedAt: new Date().toISOString() }));
export async function loadPosDraft<T>(key: string): Promise<T | null> {
  const row = await withStore<{ key: string; value: T } | undefined>("drafts", "readonly", s => s.get(key));
  return row?.value ?? null;
}
export const clearPosDraft = (key: string) => withStore("drafts", "readwrite", s => s.delete(key));
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
      const result = task.kind === "sale"
        ? await client.rpc("confirm_center_sale", {
            p_request: task.requestId,
            p_center: p.centerId,
            p_customer: p.customerId || null,
            p_notes: p.notes || null,
            p_lines: p.lines,
            p_payments: p.payments,
          })
        : await client.rpc("confirm_queued_purchase", {
            p_request: task.requestId,
            target_center: p.centerId,
            target_supplier: p.supplierId || null,
            purchase_notes: p.notes || null,
            purchase_lines: p.lines,
            payment_allocations: p.payments,
          });
      if (result.error) { needsCorrection = !/failed to fetch|network|timeout|load failed|gateway|502|503|504/i.test(result.error.message); throw new Error(result.error.message); }
      const row = task.kind === "sale" ? null : Array.isArray(result.data) ? result.data[0] : result.data;
      const id = task.kind === "sale" ? String(result.data) : String((row as { purchase_id?: string } | null)?.purchase_id ?? "");
      if (!id || id === "undefined") throw new Error("Server did not return the posted bill ID.");
      await deletePosTask(task.requestId);
      completed.push({ task, id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sync this bill.";
      await updatePosTaskError(task, message, needsCorrection);
      // Stop so the operator can resolve the first failed transaction before later ones.
      break;
    }
  }
  return completed;
}
