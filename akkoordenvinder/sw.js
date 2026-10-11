/* Service worker: maakt de app offline bruikbaar. Verhoog VERSION bij elke wijziging. */
const VERSION = 'akkoordenvinder-v6';
const FILES = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './js/id3.js', './js/dsp.js', './js/instruments.js', './js/lyrics.js', './js/app.js', './js/live.js', './js/lyricsui.js', './js/library.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // YouTube, fonts enz. gaan gewoon naar het net
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
