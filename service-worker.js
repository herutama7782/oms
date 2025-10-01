// Ganti versi ini setiap kali Anda mengubah file SW ini
const CACHE_NAME = 'pos-mobile-cache-v4'; 

// Aset-aset penting yang perlu di-cache untuk fungsionalitas offline
const urlsToCache = [
  './', // Ini akan me-cache halaman utama (index.html)
  'index.html', // Cache secara eksplisit untuk fallback
  'index.css',
  'index.js',
  'manifest.json',
  'image/icon-192.png',
  'image/icon-512.png',
  'image/icon-maskable-192.png',
  'image/icon-maskable-512.png',
  // URL eksternal yang digunakan
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Event install: precaching aset-aset penting
self.addEventListener('install', event => {
  // Skip waiting untuk mempercepat aktivasi service worker baru
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching assets');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Failed to cache all urls:', error);
      })
  );
});

// Event fetch: menyajikan aset dari cache atau dari network (strategi Cache-First)
self.addEventListener('fetch', event => {
  // Hanya tangani request GET
  if (event.request.method !== 'GET') {
    return;
  }

  // Strategi Cache-First untuk semua request
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Jika ada di cache, langsung kembalikan dari cache
        if (cachedResponse) {
          return cachedResponse;
        }

        // Jika tidak ada di cache, coba ambil dari network
        return fetch(event.request).then(
          networkResponse => {
            // Cek jika response valid (bukan error dan bukan dari ekstensi chrome)
            if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
              return networkResponse;
            }

            // Penting: Clone response. Karena response adalah stream dan hanya bisa dibaca sekali.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                // Simpan response ke cache untuk request selanjutnya
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(error => {
            // Menangani kasus ketika network request gagal (misal, offline)
            console.warn('Fetch failed; network error.', error);
        });
      })
  );
});

// Event activate: membersihkan cache lama
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Mengambil kontrol atas halaman yang terbuka
  );
});