const CACHE_NAME='novera-v6';
const APP_SHELL=['./','./index.html','./manifest.json','./css/styles.css','./js/app.js','./js/map.js','./js/routing.js','./js/storage.js','./data/routes.json','./data/places.json','./assets/icons/icon.svg','./assets/images/historic-center.svg','./assets/images/admiralty.svg','./assets/images/literary.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  // Кэшируем только собственные файлы приложения. Внешние тайлы OSM и CDN не кэшируем.
  if(url.origin===self.location.origin){
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}
      return response;
    }).catch(()=>caches.match('./index.html'))));
  }
});
