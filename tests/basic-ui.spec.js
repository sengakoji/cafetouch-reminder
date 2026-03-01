// tests/basic-ui.spec.js
// スマホサイズ (Pixel 7) でのUIと主要ボタン動作テスト
const { test, expect } = require('@playwright/test');

test.describe('基本UI - スマホサイズ', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // ページが完全にロードされるまで待機
        await page.waitForLoadState('networkidle');
    });

    test('ページタイトルが正しく表示される', async ({ page }) => {
        await expect(page).toHaveTitle(/カフェタッチリマインダー/);
    });

    test('h1 タイトルが表示される', async ({ page }) => {
        const h1 = page.locator('h1');
        await expect(h1).toBeVisible();
        await expect(h1).toContainText('カフェタッチリマインダー');
    });

    test('タイマーが表示される', async ({ page }) => {
        const timer = page.locator('#timer');
        await expect(timer).toBeVisible();
        // タイマーは HH:MM:SS 形式であること
        await expect(timer).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    });

    test('「カフェタッチ完了」ボタンが表示されクリックできる', async ({ page }) => {
        const btn = page.locator('#completedBtn');
        await expect(btn).toBeVisible();
        await btn.click();
        // クリック後に何らかの状態変化があること（タイマーリセットや表示更新）
        await page.waitForTimeout(500);
        const timer = page.locator('#timer');
        await expect(timer).toBeVisible();
    });

    test('「タッチした時刻を入力」ボタンで遡及入力パネルが開く', async ({ page }) => {
        const retroBtn = page.locator('#retroactiveModeBtn');
        await expect(retroBtn).toBeVisible();
        await retroBtn.click();
        const panel = page.locator('#retroactivePanel');
        await expect(panel).toBeVisible();
    });

    test('遡及入力パネルのキャンセルボタンでパネルが閉じる', async ({ page }) => {
        await page.locator('#retroactiveModeBtn').click();
        const panel = page.locator('#retroactivePanel');
        await expect(panel).toBeVisible();
        // キャンセルボタン（flex:2のsecondaryボタン）をクリック
        await panel.getByText('キャンセル').click();
        await expect(panel).toBeHidden();
    });

    test('設定パネルが開閉する', async ({ page }) => {
        const toggleLabel = page.locator('label[for="settingsToggle"]');
        await expect(toggleLabel).toBeVisible();
        await toggleLabel.click();
        const settingsContent = page.locator('.settings-content');
        await expect(settingsContent).toBeVisible();
        // もう一度クリックで閉じる
        await toggleLabel.click();
        await expect(settingsContent).toBeHidden();
    });

    test('ミュートボタン（ベルアイコン）はスマホでは非表示になっている', async ({ page }) => {
        // スマホサイズではミュートボタンは意図的に非表示
        const muteBtn = page.locator('#muteBtn');
        await expect(muteBtn).toBeHidden();
    });
});
