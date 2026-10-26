// Static assets only. Authenticated ERP HTML must never be reused across accounts
// or after suspension/module revocation. Local POS drafts remain in user-scoped IndexedDB.
const CACHE = "centerpro-pos-shell-v2";
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil((async () => {
 const keys = await caches.keys();
 await Promise.all(keys.filter(key => key.startsWith("centerpro-pos-shell-") && key !== CACHE).map(key => caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
 const request=event.request;
 if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(url.pathname.startsWith("/_next/static/")){
   event.respondWith((async()=>{
     const cache=await caches.open(CACHE),cached=await cache.match(request);
     if(cached)return cached;
     const response=await fetch(request);
     if(response.ok)await cache.put(request,response.clone());
     return response;
   })());
   return;
 }
 if(request.mode==="navigate"&&url.pathname.startsWith("/dashboard")){
   event.respondWith(fetch(request).catch(()=>new Response("<h1>Reconnect to open your business workspace</h1><p>Your saved POS drafts remain on this device. Connect to verify your business access before reopening the workspace.</p>",{
     status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}
   })));
 }
});
