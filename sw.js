// ════════════════════════════════════════════════════════════════
//  APEL JUMBO REBORN — Service Worker v2
//  Strategi: Network-first (selalu ambil terbaru saat online)
//            Cache-fallback (pakai cache saat offline)
// ════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'apeljumbo-v4'; // v4 → paksa hapus cache lama   // naik versi → paksa hapus cache lama
const RUNTIME_CACHE = 'apeljumbo-runtime-v4';

const SHELL_ASSETS = ['/', '/index.html', '/manifest.json'];

const BYPASS_PATTERNS = [
  /supabase\.co\/rest\//,
  /supabase\.co\/auth\//,
  /supabase\.co\/realtime/,
  /supabase\.co\/storage/,
];

const CACHEABLE_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
];

// ── Install: cache app shell ──────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW v3] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => {
        console.log('[SW v3] Shell cached, skipping waiting');
        return self.skipWaiting(); // langsung aktif tanpa tunggu tab lama
      })
      .catch(err => {
        console.warn('[SW v3] Cache install gagal (normal jika offline):', err.message);
        return self.skipWaiting();
      })
  );
});

// ── Activate: hapus SEMUA cache lama ─────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW v3] Activating, clearing old caches...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map(k => {
            console.log('[SW v3] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => {
        console.log('[SW v3] Active & claiming clients');
        return self.clients.claim(); // ambil kendali semua tab langsung
      })
  );
});

// ── Fetch: Network-first untuk HTML, cache-first untuk aset ───────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Supabase API → selalu ke network, tidak pernah cache
  if (BYPASS_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'Tidak ada koneksi' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 2. App shell (index.html, /) → NETWORK-FIRST
  //    Online: ambil dari network, update cache
  //    Offline: pakai dari cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Berhasil dari network → update cache dengan versi terbaru
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Gagal (offline) → ambil dari cache
          console.log('[SW v3] Offline fallback untuk:', url.pathname);
          return caches.match(request)
            .then(cached => cached || caches.match('/index.html') || caches.match('/'));
        })
    );
    return;
  }

  // 3. Font & CDN → Cache-first (jarang berubah)
  if (CACHEABLE_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // 4. Lainnya → network dengan fallback cache
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Background Sync ───────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'apeljumbo-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'PROCESS_SYNC_QUEUE' }))
      )
    );
  }
});

// ── Pesan dari halaman ────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
