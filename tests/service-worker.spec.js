// tests/service-worker.spec.js
// Service Worker の登録とオフラインキャッシュのテスト
const { test, expect } = require('@playwright/test');

test.describe('Service Worker / PWA', () => {
    test('Service Worker が登録されている', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // SW の登録状態を確認
        const swRegistered = await page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return false;
            const registrations = await navigator.serviceWorker.getRegistrations();
            return registrations.length > 0;
        });
        expect(swRegistered).toBe(true);
    });

    test('Service Worker が active 状態になっている', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // SW が activate するまで少し待つ
        await page.waitForTimeout(2000);

        const swActive = await page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return false;
            const reg = await navigator.serviceWorker.ready;
            return reg.active !== null;
        });
        expect(swActive).toBe(true);
    });

    test('Service Worker がコアアセットをキャッシュしている', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // SW が install / activate を完了してキャッシュに書き込むまで待つ
        await page.waitForTimeout(4000);

        const cached = await page.evaluate(async () => {
            const cacheNames = await caches.keys();
            if (cacheNames.length === 0) return { hasCaches: false, keys: [] };
            const cache = await caches.open(cacheNames[0]);
            const requests = await cache.keys();
            return {
                hasCaches: true,
                keys: requests.map((r) => r.url),
            };
        });

        // キャッシュが存在していること
        expect(cached.hasCaches).toBe(true);
        // index.html がキャッシュに含まれていること
        const hasIndex = cached.keys.some((url) => url.endsWith('index.html') || url.endsWith('/'));
        expect(hasIndex).toBe(true);
    });
});
