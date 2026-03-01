// tests/push-schedule.spec.js
// Worker の /schedule エンドポイントと KV 更新確認テスト
require('dotenv').config({ path: '.env.test' });
const { test, expect } = require('@playwright/test');

const WORKER_URL = process.env.WORKER_URL || 'https://cafe-push-worker.laid-tiles.workers.dev';
const DEBUG_TOKEN = process.env.PLAYWRIGHT_DEBUG_TOKEN;

// テスト用のダミープッシュサブスクリプション（実際には送信されない無効なendpoint）
// /schedule に投げてKVのactive_schedule_XXXが更新されるか確認するだけなので
// 実際のpush serviceには届かない（endpoint that returns 404/410）
const DUMMY_SUBSCRIPTION = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/playwright-test-endpoint-dummy-' + Date.now(),
    keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtZ5RLPQ9-kXm5K7R4YHdwMFp_vYBsW6G6BKmMk4sGk5RgWYBbxlZjGqCTFwPmk',
        auth: 'tBHItJI5svbpez7KI4CCXg'
    }
};

test.describe('Worker API / KV 更新確認', () => {
    test('GET / ヘルスチェックが 200 を返す', async ({ request }) => {
        const res = await request.get(`${WORKER_URL}/`);
        expect(res.status()).toBe(200);
        const text = await res.text();
        expect(text).toContain('running');
    });

    test('GET /debug/status にトークンなしでアクセスすると 403 になる', async ({ request }) => {
        // ダミーのsubIdで試す
        const subId = 'test-dummy-subid';
        const res = await request.get(`${WORKER_URL}/debug/status?subId=${subId}`);
        expect(res.status()).toBe(403);
    });

    test('POST /schedule → KV に active_schedule が保存される', async ({ request }) => {
        // subscriptionIdを計算するため、Workerと同じロジックでsubIdを推定する必要がある
        // ただし、Workerは SHA-256(endpoint) を subId として使うため、
        // ここではschedule後に debug/statusを呼んでnullでない値が返るか確認する

        // まずスケジュールを投入（delaySecondsを大きくして通知は飛ばない）
        const scheduleRes = await request.post(`${WORKER_URL}/schedule`, {
            data: {
                subscription: DUMMY_SUBSCRIPTION,
                payload: {
                    title: 'Playwright Test',
                    body: 'this is a test',
                    type: 'remind',
                    requireInteraction: false
                },
                delaySeconds: 86400, // 24時間後 = 実際には届かない
                autoUpdate: false,
                cooldownMinutes: 180,
                actionTimeSeconds: 30,
                fixedTimes: ['04:00', '16:00']
            },
            headers: { 'Content-Type': 'application/json' }
        });

        expect(scheduleRes.status()).toBe(200);
        const scheduleBody = await scheduleRes.json();
        expect(scheduleBody.success).toBe(true);

        // subIdを計算（Workerと同じロジック：SHA-256(endpoint)をBase64url）
        // Node.js の crypto で計算する
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(DUMMY_SUBSCRIPTION.endpoint).digest();
        const subId = hash.toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // /debug/status で KV が更新されているか確認
        const statusRes = await request.get(
            `${WORKER_URL}/debug/status?subId=${encodeURIComponent(subId)}&token=${encodeURIComponent(DEBUG_TOKEN)}`
        );
        expect(statusRes.status()).toBe(200);
        const status = await statusRes.json();
        expect(status.subId).toBe(subId);
        // active_schedule_XXX が null でないこと = KVに書き込まれた証拠
        expect(status.activeScheduleId).not.toBeNull();
        expect(status.isStopped).toBe(false);
    });

    test('POST /stop → KV に stop フラグが立つ', async ({ request }) => {
        // まずstopを送信
        const stopRes = await request.post(`${WORKER_URL}/stop`, {
            data: { subscription: DUMMY_SUBSCRIPTION },
            headers: { 'Content-Type': 'application/json' }
        });
        expect(stopRes.status()).toBe(200);

        // subIdを計算
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(DUMMY_SUBSCRIPTION.endpoint).digest();
        const subId = hash.toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // /debug/status で stop フラグを確認
        const statusRes = await request.get(
            `${WORKER_URL}/debug/status?subId=${encodeURIComponent(subId)}&token=${encodeURIComponent(DEBUG_TOKEN)}`
        );
        expect(statusRes.status()).toBe(200);
        const status = await statusRes.json();
        expect(status.isStopped).toBe(true);
    });
});
