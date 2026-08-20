const CACHE_NAME = 'austrian-lifestyle-v6';
const LOCAL_FILES = [
  'index.html',
  'student-dashboard.html',
  'austria-life-companion.html',
  'boarding-school-manager.html',
  'expense-tracker.html',
  'friends-contacts.html',
  'print-job-manager.html',
  'manifest.json',
  'sw.js',
  'auth-sync.js'
];

/* Install: cache all local files */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_FILES))
  );
  self.skipWaiting();
});

/* Activate: clean old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch: cache-first for local, stale-while-revalidate for fonts */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Google Fonts — cache then network */
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetched = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetched;
        })
      )
    );
    return;
  }

  /* Firebase SDK — network first, cache fallback */
  if (url.hostname.includes('gstatic.com')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  /* Print Job Manager / PDF Viewer — network first, never stale */
  if (url.pathname.includes('print-job-manager') || url.pathname.includes('pdfjs/web/viewer')) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  /* Local files — cache first, fallback to network */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        /* Offline fallback for navigation */
        if (event.request.mode === 'navigate') {
          return caches.match('index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});