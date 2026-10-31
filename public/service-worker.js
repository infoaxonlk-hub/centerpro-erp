// Static assets only. Authenticated ERP HTML must never be reused across accounts
// or after suspension/module revocation. Local POS drafts remain in user-scoped IndexedDB.
const CACHE = "centerpro-pos-shell-v3";
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
 if(url.pathname.startsWith("/_next/static/")||/^\/fonts\/NotoSans(Sinhala|Tamil)\.ttf$/.test(url.pathname)){
   event.respondWith((async()=>{
     const cache=await caches.open(CACHE),cached=await cache.match(request);
     if(cached)return cached;
     const response=await fetch(request);
     if(response.ok)await cache.put(request,response.clone());
     return response;
   })());
   return;
 }
 // This public document contains no server-rendered business/customer data.
 // Client-side session/snapshot checks decide whether offline entry is available.
 if(url.pathname==='/offline/farm-services'&&!request.headers.has('rsc')){
   event.respondWith((async()=>{const cache=await caches.open(CACHE),key=new URL('/offline/farm-services',self.location.origin).href;try{const response=await fetch(request);if(response.ok&&response.headers.get('content-type')?.includes('text/html'))await cache.put(key,response.clone());return response;}catch{return await cache.match(key)||new Response('<h1>Offline billing is not prepared</h1><p>Open New Farm Bill online once on this device.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});}})());return;
 }
 if(request.mode==="navigate"&&url.pathname.startsWith("/dashboard")){
   event.respondWith(fetch(request).catch(()=>url.pathname.startsWith('/dashboard/farm-services')?Response.redirect(new URL('/offline/farm-services',self.location.origin).href,302):new Response("<h1>Reconnect to open your business workspace</h1><p>Your saved POS drafts remain on this device. Connect to verify your business access before reopening the workspace.</p>",{
     status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}
   })));
 }
});
