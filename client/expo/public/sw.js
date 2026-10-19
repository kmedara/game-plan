/**
 * Shows a Web Push payload while the site is in the background, and opens the
 * page it is about when tapped.
 */

/**
 * The app path for a push's event data.
 *
 * @param data - The fan-out event sent with the push.
 * @returns A same-origin path.
 */
const pathFor = (data) => {
  if (data === null || typeof data !== 'object') return '/';
  const id = (value) => encodeURIComponent(String(value));
  switch (data.type) {
    case 'chat_message':
      return `/chats/${id(data.chatId)}`;
    case 'event_reminder':
    case 'event_moved':
    case 'schedule_changed':
      return '/schedule';
    case 'join_requested':
      return `/teams/${id(data.teamId)}`;
    case 'dues_reminder':
      return '/dues';
    case 'payment_received':
      return `/teams/${id(data.teamId)}/payments`;
    default:
      return '/';
  }
};

// A new version takes over open tabs at once instead of waiting for them all to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const payload = event.data === null ? {} : event.data.json();
  const title = typeof payload.title === 'string' ? payload.title : 'GamePlan';
  const body = typeof payload.body === 'string' ? payload.body : '';
  // A chat thread replaces its older alert instead of stacking one per message.
  const tag = payload.data?.type === 'chat_message' ? `chat-${payload.data.chatId}` : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { path: pathFor(payload.data) },
      ...(tag !== undefined ? { tag, renotify: true } : {}),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.path === 'string' ? event.notification.data.path : '/';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const open = clients.find((client) => 'focus' in client);
      if (open === undefined) return self.clients.openWindow(target);
      if (open.url !== target) {
        try {
          await open.navigate(target);
        } catch {
          // A window this worker does not control cannot be navigated; just bring it forward.
        }
      }
      return open.focus();
    }),
  );
});
