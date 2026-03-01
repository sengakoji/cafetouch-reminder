// Service Worker for PWA & Notification

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// PWAのインストール要件を満たすための空のfetchイベント
self.addEventListener('fetch', (event) => {
    // 何もしないが、存在することが重要です
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
