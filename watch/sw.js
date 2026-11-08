const C="lukzy-v6",F=["./","icon.svg","manifest.json"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F))));
self.addEventListener("fetch",e=>{if(e.request.url.endsWith(".mp4"))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});
