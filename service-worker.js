const CACHE_NAME='novera-v8';
const APP_SHELL=[
  './','./index.html','./manifest.json','./css/styles.css',
  './js/app.js','./js/map.js','./js/routing.js','./js/storage.js',
  './data/routes.json','./data/places.json','./assets/icons/icon.svg',
  './assets/images/historic-center.svg','./assets/images/admiralty.svg','./assets/images/literary.svg'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{
      const response=await fetch(request);
      if(response.ok) await cache.put(request,response.clone());
      return response;
    }catch(error){
      const cached=await cache.match(request);
      if(cached) return cached;
      if(request.mode==='navigate'){
        const appShell=await cache.match('./index.html');
        if(appShell) return appShell;
      }
      return new Response('Нет подключения к интернету. Этот ресурс ещё не сохранён на устройстве.',{
        status:503,
        statusText:'Offline',
        headers:{'Content-Type':'text/plain; charset=utf-8'}
      });
    }
  })());
});
