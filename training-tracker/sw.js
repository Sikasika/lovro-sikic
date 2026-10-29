// Offline support and updates.
//
// Every release is one versioned cache holding a complete, matching set of files:
// - install downloads all files fresh from the server (bypassing the HTTP cache,
//   which GitHub Pages keeps for 10 minutes), so a new version never stores old files;
// - pages are served only from the active version's cache, so old and new files
//   are never mixed;
// - changing CACHE (on every release) makes browsers install the new version;
//   the page then shows a "New version ready" notice.
const CACHE = 'training-tracker-v26';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './calc.js',
  './backup.js',
  './workout.js',
  './bodyweight.js',
  './plans.js',
  './programs.js',
  './run-plan.js',
  './plans-ui.js',
  './home.js',
  './app.js',
  './stats.js',
  './insights.js',
  './stats.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch (e) {
        // Offline and not cached: open the app itself for page loads.
        if (req.mode === 'navigate') return (await cache.match('./')) || Response.error();
        return Response.error();
      }
    })
  );
});
