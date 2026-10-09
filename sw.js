const CACHE_NAME = 'nutrition-atlas-v30-workout-delete-layout';
const APP_SHELL = [
  './index.html?v=17',
  './styles.css?v=25',
  './manifest.webmanifest?v=17',
  './icon.svg?v=17',
  './js/app.js?v=27',
  './js/calculations.js?v=17',
  './js/charts.js?v=17',
  './js/foods.js?v=17',
  './js/store.js?db=4',
  './js/sync-core.js?v=17',
  './js/sync-manager.js?v=17',
  './js/utils.js?v=17',
  './js/theme.js?v=17'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(response => {
        if (response.ok && !['/login', '/login.html', '/repair.html'].includes(new URL(response.url).pathname)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html?v=17')))
  );
});