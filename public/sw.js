/*
 * Friendzy service worker — deliberately minimal.
 *
 * Its only job is to make the website installable in browsers that still ask
 * for a service worker before offering "Install app" / "Add to Home screen".
 * It caches nothing: every request goes to the network exactly as before, so a
 * new deploy is picked up on the next page load and auth redirects are never
 * served from a stale cache.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentionally empty: without respondWith() the browser handles the request normally.
});
