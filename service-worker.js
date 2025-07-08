const CACHE_NAME = "eraser-tool-v1";
const ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/linkdin.png",
  "icons/og-image.png",
  "icons/me.png",
  // Add more files as needed (brush.png, background.png, etc.)
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(res => res || fetch(event.request))
  );
});
