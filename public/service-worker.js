const CACHE = "centerpro-pos-shell-v1";
const POS_PATHS = ["/dashboard/purchases/new", "/dashboard/sales/new"];
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith("centerpro-pos-shell-") && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (request.mode === "navigate" && POS_PATHS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(url.pathname, response.clone());
        return response;
      } catch {
        return await cache.match(url.pathname) ?? new Response("<h1>POS is not cached on this device</h1><p>Open this POS page once while connected, then it can reopen offline.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 });
      }
    })());
  }
});
