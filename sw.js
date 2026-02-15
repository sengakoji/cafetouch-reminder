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
