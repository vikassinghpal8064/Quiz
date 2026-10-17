/* Flash Cards service worker.
 *
 * Scope: make the app shell available offline so a study session opened at home
 * keeps working when the network drops. It is deliberately conservative:
 *
 *   - GET only, same-origin only.
 *   - /api/* is never cached (auth + freshness); the app's own review queue and
 *     session cache handle offline writes and reads.
 *   - Navigations are network-first and fall back to the cached index.html, so
 *     the SPA still boots offline.
 *   - Static assets (the hashed JS/CSS, fonts, icons) are stale-while-
 *     revalidate: served from cache immediately, refreshed in the background.
 *
 * Bump CACHE when the shell changes; the old cache is dropped on activate.
 */
const CACHE = "flash-pwa-v1";
const OFFLINE_URL = "/index.html";
const PRECACHE = ["/", OFFLINE_URL, "/favicon.svg", "/manifest.webmanifest"];

// Cache the shell and, crucially, the exact hashed JS/CSS it references. The
// asset filenames change every build, so instead of hard-coding them we read
// index.html and cache whatever it points at. That is what lets a reload work
// offline after a single online visit.
async function precacheShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRECACHE).catch(() => undefined);

  try {
    const response = await fetch(OFFLINE_URL, { cache: "no-cache" });
    if (!response.ok) return;
    cache.put(OFFLINE_URL, response.clone());

    const html = await response.text();
    const urls = new Set();
    const re = /(?:src|href)="([^"]+)"/g;
    let match;
    while ((match = re.exec(html))) {
      const url = match[1];
      if (url.startsWith("/assets/") || url === "/favicon.svg" || url === "/manifest.webmanifest") {
        urls.add(url);
      }
    }
    await Promise.all([...urls].map((url) => cache.add(url).catch(() => undefined)));
  } catch {
    /* offline install: the navigation cache from PRECACHE still works */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(response) {
  return response && response.ok && response.type === "basic";
}

// Network-first, falling back to the cached shell.
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE);
      cache.put(OFFLINE_URL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(OFFLINE_URL);
    return cached ?? Response.error();
  }
}

// Stale-while-revalidate for static assets.
async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? network.then((response) => response ?? Response.error());
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});
