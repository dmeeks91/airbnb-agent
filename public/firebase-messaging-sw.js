/* Haven Co-Host Android PWA Background Push & Deep-Linking Service Worker */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'Haven Co-Host', body: event.data.text() } };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'New Airbnb guest message';
  const body = notification.body || data.body || 'Tap to open draft reply in Haven.';
  const targetUrl = data.url || '/';
  const tag = data.threadId ? `haven-thread-${data.threadId}` : 'haven-alert';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag,
      renotify: true,
      data: {
        url: targetUrl,
        propertyId: data.propertyId || '',
        threadId: data.threadId || '',
        view: data.view || 'dialogue',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const noteData = event.notification.data || {};
  const rawUrl = noteData.url || '/';
  const destinationUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({
              type: 'HAVEN_DEEP_LINK',
              propertyId: noteData.propertyId || null,
              threadId: noteData.threadId || null,
              view: noteData.view || 'dialogue',
              url: rawUrl,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(destinationUrl);
        }
        return undefined;
      }),
  );
});
