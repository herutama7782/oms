const CACHE_NAME = 'pos-mobile-cache-v2'; // Bump version to force update
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/index.css',
  '/index.js',
  '/manifest.json',
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
  '/src/html/modals.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Precaching App Shell');
        // Use addAll with a catch to prevent install failure if one resource fails
        return cache.addAll(APP_SHELL_URLS).catch(err => {
          console.error('Failed to cache app shell resources:', err);
        });
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: clearing old cache');
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  // For CDN assets, use a stale-while-revalidate strategy
  if (event.request.url.includes('cdn.tailwindcss.com') || 
      event.request.url.includes('cdnjs.cloudflare.com') ||
      event.request.url.includes('unpkg.com') ||
      event.request.url.includes('cdn.jsdelivr.net')
     ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(response => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
          return response || fetchPromise;
        });
      })
    );
    return;
  }

  // For app shell assets, use cache-first
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then(
          networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return networkResponse;
          }
        );
      })
  );
});