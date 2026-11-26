/*
 * Friendzy service worker.
 *
 * 1. Installability: some browsers still require a service worker before they
 *    offer "Install app" / "Add to Home screen". We cache nothing — every
 *    request goes to the network, so a new deploy is live on the next page load
 *    and auth redirects are never served from a stale cache.
 * 2. Web Push: notifications sent by the push-dispatch Edge Function arrive here
 *    even when no Friendzy tab is open. The payload is JSON:
 *      { title, body, url, tag, icon?, badge?, renotify?, data? }
 *    Tapping a notification focuses an open Friendzy tab (or opens one) at `url`.
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

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Friendzy';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || undefined,
    renotify: Boolean(payload.renotify),
    requireInteraction: payload.type === 'incoming_call',
    vibrate: payload.type === 'incoming_call' ? [300, 150, 300, 150, 300] : [120, 60, 120],
    data: { url: payload.url || '/notifications', type: payload.type || null, ...(payload.data || {}) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/notifications';
  const target = new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client && client.url !== target) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// Chrome rotates subscriptions occasionally: tell the open tab (if any) to re-register.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) client.postMessage({ type: 'friendzy:pushsubscriptionchange' });
    }),
  );
});
