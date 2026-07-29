// Print Queue Service Worker
// Caches the app shell (this page) on first successful load so it can
// open offline afterward. Data itself is cached separately in
// localStorage by the page (see CACHE_KEY in print-job-manager.html).

const SHELL_CACHE = "print-queue-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll([self.registration.scope]) // caches the page itself
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only manage navigation/document requests for the shell.
  // Everything else (API calls to the Worker) goes straight to the
  // network so data always stays fresh when online.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match(self.registration.scope)))
    );
  }
});
