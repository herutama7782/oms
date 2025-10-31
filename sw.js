const CACHE_NAME = 'pos-mobile-cache-v6';

const APP_SHELL_URLS = [
  // Cache untuk offline fallback (jangan cache '/')
  '/index.html',
  '/index.css',
  '/index.js',
  '/manifest.json',
  '/metadata.json',
  '/src/audio.js',
  '/src/cart.js',
  '/src/contact.js',
  '/src/db.js',
  '/src/peripherals.js',
  '/src/product.js',
  '/src/report.js',
  '/src/settings.js',
  '/src/sync.js',
  '/src/ui.js',
  '/src/html/pages.html',
  '/src/html/modals.html',
  'https://i.imgur.com/awbpnPX.png'
];

self.addEventListener('install', event => {
  // Aktifkan cepat
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL_URLS).catch(err => {
        console.error('Precaching error:', err);
      })
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // 1) HTML / navigasi: network-first agar update langsung terambil
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith((async () => {
      try {
        // Pastikan ambil versi terbaru
        return await fetch(event.request, { cache: 'no-store' });
      } catch (e) {
        // Offline fallback
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  const url = new URL(event.request.url);

  // 2) CDN assets: stale-while-revalidate
  const cdnHosts = [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'www.gstatic.com'
  ];
  if (cdnHosts.some(h => url.host.includes(h))) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request).then(r => {
        if (r && r.ok) cache.put(event.request, r.clone());
        return r;
      }).catch(() => cached);
      return cached || fetchPromise;
    }));
    return;
  }

  // 3) Same-origin static: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request).then(r => {
        if (r && r.ok) cache.put(event.request, r.clone());
        return r;
      }).catch(() => cached);
      return cached || fetchPromise;
    }));
    return;
  }

  // 4) Default: network-first
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});