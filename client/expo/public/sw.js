/**
 * Shows a Web Push payload while the site is in the background.
 */

self.addEventListener('push', (event) => {
  const payload = event.data === null ? {} : event.data.json();
  const title = typeof payload.title === 'string' ? payload.title : 'GamePlan';
  const body = typeof payload.body === 'string' ? payload.body : '';
  event.waitUntil(self.registration.showNotification(title, { body }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => 'focus' in client);
      if (open !== undefined) return open.focus();
      return self.clients.openWindow('/');
    }),
  );
});
