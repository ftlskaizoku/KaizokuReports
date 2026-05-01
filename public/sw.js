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
});
