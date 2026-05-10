// ════════════════════════════════════════════════════════════════
//  APEL JUMBO REBORN — Service Worker
//  Versi: 1.0  |  Created by D.D Candra
//  Mendukung mode offline penuh untuk app shell
// ════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'apeljumbo-v1';
const RUNTIME_CACHE = 'apeljumbo-runtime-v1';

// File-file yang wajib di-cache saat install (app shell)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  // Font Google (akan di-cache saat pertama kali diakses online)
];

// Domain eksternal yang boleh di-cache secara dinamis
const CACHEABLE_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',       // supabase-js CDN
];

// URL yang TIDAK boleh di-cache (selalu fetch langsung ke server)
const BYPASS_PATTERNS = [
  /supabase\.co\/rest\//,   // Supabase REST API → harus live
  /supabase\.co\/auth\//,   // Supabase Auth
  /supabase\.co\/realtime/,  // Supabase Realtime
  /supabase\.co\/storage/,   // Supabase Storage
];

// ── Install: cache app shell ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install cache gagal:', err))
  );
});

// ── Activate: hapus cache lama ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map(k => {
            console.log('[SW] Hapus cache lama:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: strategi cache ────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Supabase API → selalu network-first, jangan cache
  if (BYPASS_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'Tidak ada koneksi internet' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 2. App shell (same origin HTML) → Cache-first, fallback network
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => caches.match('/') || caches.match('/index.html'));
      })
    );
    return;
  }

  // 3. Aset eksternal (font, CDN) → Stale-while-revalidate
  if (CACHEABLE_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(response => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached); // fallback ke cached jika offline
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // 4. Lainnya → network dengan fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Background Sync: kirim antrian offline ke Supabase ──────────
self.addEventListener('sync', event => {
  if (event.tag === 'apeljumbo-sync') {
    event.waitUntil(processOfflineQueue());
  }
});

async function processOfflineQueue() {
  // Kirim pesan ke semua client agar mereka proses antrian
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client =>
    client.postMessage({ type: 'PROCESS_SYNC_QUEUE' })
  );
}

// ── Pesan dari halaman utama ─────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_VERSION') {
    // Update cache name jika versi berubah
    console.log('[SW] Versi cache:', event.data.version);
  }
});
