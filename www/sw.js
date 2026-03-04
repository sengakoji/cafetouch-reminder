// Service Worker for PWA & Notification

const CACHE_NAME = 'cafetouch-v4';
const PRECACHE_URLS = [
    './',
    './index.html',
    './site.webmanifest',
    './favicon-96x96.png',
    './apple-touch-icon.png',
    './web-app-manifest-192x192.png',
    './web-app-manifest-512x512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ネットワークファースト戦略（最新版を優先、オフライン時はキャッシュ）
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith(self.location.origin)) return;
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // 正常なレスポンスならキャッシュを更新
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
            }
            return networkResponse;
        }).catch(() => {
            // オフラインまたはエラー時はキャッシュを返す
            return caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // ナビゲーションリクエストかつキャッシュなしなら index.html を試す
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                return clientList[0].focus();
            }
            return clients.openWindow('./index.html');
        })
    );
});

// Push通知を受け取るイベント
self.addEventListener('push', (event) => {
    // ペイロードは一度だけパース
    let data = { title: "カフェタッチリマインダー", body: "時間です！", type: 'remind' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: './favicon-96x96.png',
        badge: './favicon-96x96.png',
        tag: 'cafe-touch-reminder',
        renotify: true,
        requireInteraction: data.requireInteraction === true,
        data: {
            url: self.registration.scope
        }
    };

    // 振動(vibrate)やその他のフラグは指定せず、完全な挙動をOSに委ねる
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});
