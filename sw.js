// Service Worker for PWA & Notification

const CACHE_NAME = 'cafetouch-v2';
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
    // インストール時にコアアセットをキャッシュ
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // 古いキャッシュを削除
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// キャッシュファースト戦略（オフラインでも動作）
self.addEventListener('fetch', (event) => {
    // 外部APIリクエスト（workers.dev等）はキャッシュしない
    if (!event.request.url.startsWith(self.location.origin)) return;

    // POSTリクエストなどもキャッシュ対象外とする
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            // キャッシュにない場合はネットワークへ
            return fetch(event.request).then((networkResponse) => {
                // レスポンスが正常かどうかチェック
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                // 正常なレスポンスならキャッシュに保存して返す
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            }).catch(() => {
                // オフラインかつキャッシュにもない場合（ナビゲーションならindex.htmlを返す試み）
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
