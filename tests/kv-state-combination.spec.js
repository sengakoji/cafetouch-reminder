// tests/kv-state-combination.spec.js
require('dotenv').config({ path: '.env.test' });
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');

const WORKER_URL = process.env.WORKER_URL || 'https://cafe-push-worker.laid-tiles.workers.dev';
const DEBUG_TOKEN = process.env.PLAYWRIGHT_DEBUG_TOKEN;

const DUMMY_SUBSCRIPTION_KV = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/playwright-test-endpoint-kv-opt-' + Date.now(),
    keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtZ5RLPQ9-kXm5K7R4YHdwMFp_vYBsW6G6BKmMk4sGk5RgWYBbxlZjGqCTFwPmk',
        auth: 'tBHItJI5svbpez7KI4CCXg'
    }
};

const getSubId = (subscription) => {
    const hash = crypto.createHash('sha256').update(subscription.endpoint).digest();
    return hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

test.describe('KV State Consolidation Verification', () => {
    test.setTimeout(15000);

    test('It correctly toggles state_${subId} between scheduled and stopped states without errors', async ({ request }) => {
        const subId = getSubId(DUMMY_SUBSCRIPTION_KV);

        // 1. Initial Schedule (creates state)
        const scheduleRes = await request.post(`${WORKER_URL}/schedule`, {
            data: {
                subscription: DUMMY_SUBSCRIPTION_KV,
                payload: { title: 'Test', body: 'Opt', type: 'remind', requireInteraction: false },
                delaySeconds: 86400,
                autoUpdate: false,
                cooldownMinutes: 180,
                actionTimeSeconds: 30,
                fixedTimes: []
            },
            headers: { 'Content-Type': 'application/json' }
        });
        expect(scheduleRes.status()).toBe(200);

        // Verify scheduled state
        let statusRes = await request.get(`${WORKER_URL}/debug/status?subId=${encodeURIComponent(subId)}&token=${encodeURIComponent(DEBUG_TOKEN)}`);
        expect(statusRes.status()).toBe(200);
        let status = await statusRes.json();

        expect(status.subId).toBe(subId);
        expect(status.isStopped).toBe(false);
        expect(status.activeScheduleId).not.toBeNull();
        const firstScheduleId = status.activeScheduleId;

        // 2. Stop notification (updates state to stopped)
        const stopRes = await request.post(`${WORKER_URL}/stop`, {
            data: { subscription: DUMMY_SUBSCRIPTION_KV },
            headers: { 'Content-Type': 'application/json' }
        });
        expect(stopRes.status()).toBe(200);

        // Verify stopped state (keys shouldn't be deleted, just activeScheduleId is null and isStopped is true)
        statusRes = await request.get(`${WORKER_URL}/debug/status?subId=${encodeURIComponent(subId)}&token=${encodeURIComponent(DEBUG_TOKEN)}`);
        expect(statusRes.status()).toBe(200);
        status = await statusRes.json();

        expect(status.isStopped).toBe(true);
        expect(status.activeScheduleId).toBeNull();

        // 3. Reschedule notification (restores active state with a new ID)
        const rescheduleRes = await request.post(`${WORKER_URL}/schedule`, {
            data: {
                subscription: DUMMY_SUBSCRIPTION_KV,
                payload: { title: 'Test 2', body: 'Opt 2', type: 'remind', requireInteraction: false },
                delaySeconds: 86400,
                autoUpdate: false,
                cooldownMinutes: 180,
                actionTimeSeconds: 30,
                fixedTimes: []
            },
            headers: { 'Content-Type': 'application/json' }
        });
        expect(rescheduleRes.status()).toBe(200);

        // Verify rescheduled state
        statusRes = await request.get(`${WORKER_URL}/debug/status?subId=${encodeURIComponent(subId)}&token=${encodeURIComponent(DEBUG_TOKEN)}`);
        expect(statusRes.status()).toBe(200);
        status = await statusRes.json();

        expect(status.isStopped).toBe(false);
        expect(status.activeScheduleId).not.toBeNull();
        expect(status.activeScheduleId).not.toBe(firstScheduleId); // Should generate a new unique timestamp ID
    });
});
