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

    test('オフライン時も index.html がキャッシュから返ってくる', async ({ page, context }) => {
        // まず一度オンラインでアクセスしてSWにキャッシュさせる
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // SW がキャッシュを完了するまで待機
        await page.waitForTimeout(3000);

        // ネットワークをオフラインにする
        await context.setOffline(true);

        // オフラインでリロード（エラーは無視し、commit で判定）
        try {
            await page.reload({ waitUntil: 'commit', timeout: 10000 });
        } catch {
            // navigate失敗でも続行（SWがインターセプトしていれば問題なし）
        }

        // タイトルが引き続き存在していればキャッシュから提供できている
        const title = await page.title().catch(() => '');
        expect(title).toMatch(/カフェタッチリマインダー/);

        await context.setOffline(false);
    });
});
