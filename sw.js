

const CACHE_NAME = 'pos-mobile-cache-v13';

const APP_SHELL_URLS = [
  // Fallback root dan ikon manifest
  '/',
  '/icon-192.png',
  '/icon-512.png',

  // Cache untuk offline fallback
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
  'https://i.imgur.com/83fxrqJ.png',

  // --- DEPENDENSI EKSTERNAL YANG KRUSIAL ---
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  
  // Font Awesome webfonts (LENGKAP .woff2 dan .ttf)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.ttf',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.ttf',

  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  
  // FIX: Menggunakan Firebase 'compat' (bundled) untuk keandalan offline
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
  // Aktifkan cepat
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL_URLS).catch(err => {
        console.error('Precaching error:', err);
        // Jika ada satu file saja yg gagal di-cache, seluruh proses install akan gagal.
        // Error ini penting untuk debugging.
      })
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Hapus cache lama yang tidak cocok dengan CACHE_NAME saat ini
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    // Ambil kontrol halaman yang terbuka agar SW langsung aktif
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  // Hanya tangani request GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Strategi 1: Network-First untuk navigasi utama (HTML)
  // Ini memastikan pengguna selalu mendapatkan versi HTML terbaru jika online.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Coba ambil dari network dulu
        const networkResponse = await fetch(event.request);
        return networkResponse;
      } catch (error) {
        // Jika gagal (offline), fallback ke cache
        console.log('Fetch failed; returning offline page from cache.', event.request.url);
        const cachedResponse = await caches.match('/index.html');
        return cachedResponse;
      }
    })());
    return;
  }
  
  // Strategi 2: Cache-First untuk semua aset lainnya (CSS, JS, Font, Gambar)
  // Ini membuat aplikasi terasa cepat dan bisa diandalkan saat offline.
  event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);
      
      // Jika ada di cache, langsung gunakan
      if (cachedResponse) {
          return cachedResponse;
      }
      
      // Jika tidak ada di cache, coba ambil dari network
      try {
          const networkResponse = await fetch(event.request);
          // Jika berhasil, simpan di cache untuk penggunaan berikutnya
          // Hanya cache response yang sukses (status 200) untuk menghindari caching error
          if (networkResponse && networkResponse.status === 200) {
              await cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
      } catch (error) {
          // Gagal fetch dari network dan tidak ada di cache
          console.error('Fetch failed and not in cache:', event.request.url, error);
          // Return response error yang valid
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
      }
  })());
});
