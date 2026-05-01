<<<<<<< HEAD
const CACHE = 'kaizoku-v1';
const STATIC = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/charts.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(()=>{})).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/.netlify/')) {
    e.respondWith(fetch(e.request).catch(()=>new Response(JSON.stringify({error:'Offline'}),{headers:{'Content-Type':'application/json'}})));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>{
    if(cached)return cached;
    return fetch(e.request).then(res=>{
      if(res.ok&&e.request.method==='GET'){const cl=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));}
      return res;
    }).catch(()=>e.request.mode==='navigate'?caches.match('/index.html'):undefined);
  }));
});

self.addEventListener('push', e => {
  let d={title:'Kaizoku Reports',body:'Daily report ready',url:'/'};
  try{if(e.data)d={...d,...e.data.json()};}catch{if(e.data)d.body=e.data.text();}
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'/icons/icon-192.png',badge:'/icons/icon-72.png',tag:'kaizoku',renotify:true,data:{url:d.url||'/'}}));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{
    for(const w of ws)if(w.url.includes(location.origin)&&'focus' in w)return w.focus();
    if(clients.openWindow)return clients.openWindow(e.notification.data?.url||'/');
  }));
=======
const CACHE_NAME   = 'kaizoku-v1';
const STATIC_CACHE = 'kaizoku-static-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/charts.js',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
];

// ═══ INSTALL ═══
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('Some assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ═══ ACTIVATE ═══
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ═══ FETCH ═══
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls — network first, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — no network' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ═══ PUSH NOTIFICATION ═══
self.addEventListener('push', event => {
  let data = { title: 'Kaizoku Reports', body: 'New market report available', url: '/' };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icons/icon-192.png',
      badge:   '/icons/badge-72.png',
      tag:     'kaizoku-daily-report',
      renotify: true,
      data:    { url: data.data?.url || '/' },
      actions: [
        { action: 'view',    title: 'View Report' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// ═══ NOTIFICATION CLICK ═══
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Focus existing window if open
      for (const win of wins) {
        if (win.url.includes(self.location.origin) && 'focus' in win) {
          win.focus();
          win.postMessage({ type: 'NAVIGATE', url });
          return;
        }
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
});
