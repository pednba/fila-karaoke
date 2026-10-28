// Service worker só para os avisos por notificação (SPEC 9.3): não guarda nada em cache.
self.addEventListener('push', (ev) => {
  let dados = {};
  try {
    dados = ev.data?.json() ?? {};
  } catch {}
  ev.waitUntil(self.registration.showNotification(dados.titulo || 'Karaokê', { body: dados.corpo || '', tag: dados.tag, renotify: Boolean(dados.tag) }));
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
    const aberta = janelas.find((j) => new URL(j.url).origin === self.location.origin);
    return aberta ? aberta.focus() : self.clients.openWindow('/');
  }));
});
