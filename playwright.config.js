// playwright.config.js
require('dotenv').config({ path: '.env.test' });

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    retries: 1,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: process.env.APP_URL || 'https://cafetouch-reminder.pages.dev',
        // スマホサイズ (iPhone 14 相当)
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        // 通知権限を事前に付与
        permissions: ['notifications'],
        headless: true,
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium-mobile',
            use: { ...devices['Pixel 7'] },
        },
    ],
});
