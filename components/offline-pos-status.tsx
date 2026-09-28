"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { listPosTasks, type OfflinePosKind } from "@/lib/offline-pos";

export function OfflinePosStatus({ scopeId, kind }: { scopeId: string; kind: OfflinePosKind }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    let active = true;
    const updateQueue = () => void listPosTasks(scopeId, kind).then(rows => {
      if (!active) return;
      setPending(rows.length);
      setFailed(rows.some(row => Boolean(row.lastError)));
    }).catch(() => {});
    void updateQueue();
    const timer = window.setInterval(updateQueue, 4000);
    window.addEventListener("centerpro-pos-queue", updateQueue);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("centerpro-pos-queue", updateQueue);
    };
  }, [scopeId, kind]);
  return <span className={`offline-pos-indicator ${online ? "is-online" : "is-offline"}`} role="status" aria-live="polite">
    {online ? <Cloud size={15} /> : <CloudOff size={15} />}
    {online ? "Online" : "Offline mode"}
    {pending > 0 && <b><RefreshCw size={12} /> {pending} pending{failed ? " · action needed" : ""}</b>}
  </span>;
}

export function OfflineSupport() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
