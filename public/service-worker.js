const CACHE_NAME = 'secure-msg-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/assets/fonts/fonts.css',
    '/assets/css/ui.css',
    '/assets/js/qrcode.min.js',
    '/assets/js/html5-qrcode.min.js',
    '/assets/js/ui.js',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/favicon.png',
    '/app.js',
    '/cryptoLayers.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. API - Network Only
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // 2. Core Logic (HTML, Root JS) - Network First
    // Ensures we always get the latest security updates
    if (event.request.mode === 'navigate' ||
        url.pathname === '/' ||
        url.pathname.endsWith('index.html') ||
        (url.pathname.endsWith('.js') && !url.pathname.includes('/assets/'))) {

        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Update cache with fresh version if successful
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // 3. Static Assets (CSS, Images, Fonts) - Cache First
    // Performance optimization
    if (url.pathname.startsWith('/assets/')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Fallback
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});
