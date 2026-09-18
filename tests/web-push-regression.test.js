const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { before, test } = require('node:test');

const schedulingModulePath = path.resolve(__dirname, '../worker/src/scheduling.mjs');
let scheduling;

before(async () => {
    scheduling = await import(pathToFileURL(schedulingModulePath).href);
});

test('fixed reset times are evaluated as Asia/Tokyo wall-clock times', () => {
    const now = new Date('2026-09-18T06:30:00.000Z'); // 15:30 JST
    const next = scheduling.getNextTargetDate(now, ['04:00', '16:00'], 180);

    assert.equal(next.toISOString(), '2026-09-18T07:00:00.000Z'); // 16:00 JST
});

test('cooldown wins when it ends before the next fixed time', () => {
    const now = new Date('2026-09-18T05:00:00.000Z'); // 14:00 JST
    const next = scheduling.getNextTargetDate(now, ['04:00', '16:00'], 60);

    assert.equal(next.toISOString(), '2026-09-18T06:00:00.000Z'); // 15:00 JST
});

test('fixed time wins when it is earlier than cooldown', () => {
    const now = new Date('2026-09-18T06:30:00.000Z'); // 15:30 JST
    const next = scheduling.getNextTargetDate(now, ['04:00', '16:00'], 180);

    assert.equal(next.toISOString(), '2026-09-18T07:00:00.000Z'); // 16:00 JST
});

test('operation completion is calculated before comparing the next target', () => {
    const beforeFixed = scheduling.calculateNextAutoUpdate({
        now: new Date('2026-09-18T06:59:20.000Z'), // 15:59:20 JST
        actionTimeSeconds: 30,
        advanceSeconds: 0,
        cooldownMinutes: 180,
        fixedTimes: ['04:00', '16:00'],
    });
    assert.equal(beforeFixed.completionTime.toISOString(), '2026-09-18T06:59:50.000Z');
    assert.equal(beforeFixed.nextTargetTime.toISOString(), '2026-09-18T07:00:00.000Z');

    const afterFixed = scheduling.calculateNextAutoUpdate({
        now: new Date('2026-09-18T07:00:20.000Z'), // 16:00:20 JST
        actionTimeSeconds: 30,
        advanceSeconds: 0,
        cooldownMinutes: 900,
        fixedTimes: ['04:00', '16:00'],
    });
    assert.equal(afterFixed.completionTime.toISOString(), '2026-09-18T07:00:50.000Z');
    assert.equal(afterFixed.nextTargetTime.toISOString(), '2026-09-18T19:00:00.000Z'); // next day 04:00 JST
});

test('notification advance is subtracted from the Queue delay after target selection', () => {
    const result = scheduling.calculateNextAutoUpdate({
        now: new Date('2026-09-18T06:59:50.000Z'), // 15:59:50 JST; Queue fires 10s early
        actionTimeSeconds: 30,
        advanceSeconds: 10,
        cooldownMinutes: 60,
        fixedTimes: ['04:00', '16:00'],
    });

    assert.equal(result.scheduledNotificationTime.toISOString(), '2026-09-18T07:00:00.000Z');
    assert.equal(result.completionTime.toISOString(), '2026-09-18T07:00:30.000Z');
    assert.equal(result.nextTargetTime.toISOString(), '2026-09-18T08:00:30.000Z');
    assert.equal(result.delaySeconds, 3630);
});

test('fixed time selection crosses midnight to the next JST day', () => {
    const now = new Date('2026-09-18T14:30:00.000Z'); // 23:30 JST
    const next = scheduling.getNextTargetDate(now, ['04:00', '16:00'], 600);

    assert.equal(next.toISOString(), '2026-09-18T19:00:00.000Z'); // next day 04:00 JST
});

test('Queue delay validation rejects values Cloudflare Queue cannot safely receive', () => {
    assert.equal(scheduling.isValidQueueDelaySeconds(0), true);
    assert.equal(scheduling.isValidQueueDelaySeconds(86400), true);
    assert.equal(scheduling.isValidQueueDelaySeconds(-1), false);
    assert.equal(scheduling.isValidQueueDelaySeconds(Number.NaN), false);
    assert.equal(scheduling.isValidQueueDelaySeconds(Number.POSITIVE_INFINITY), false);
    assert.equal(scheduling.isValidQueueDelaySeconds(86401), false);
});

function extractBrowserFunctions() {
    const source = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
    const helperStart = source.indexOf('        function createJapanFixedTime');
    const previousStart = source.indexOf('        function getPreviousFixedTime', helperStart);
    const autoUpdateStart = source.indexOf('        function getNextWorkerAutoUpdateDelay');
    const syncStart = source.indexOf('        async function syncScheduleToWorker');
    const syncEnd = source.indexOf('        // -------------------------', syncStart);
    const requestStart = source.indexOf('        async function requestWorker');
    const requestEnd = source.indexOf('        let syncScheduleTimeout', requestStart);

    assert.notEqual(helperStart, -1, 'browser JST helper was not found');
    assert.notEqual(previousStart, -1, 'browser fixed-time function boundary was not found');
    assert.notEqual(autoUpdateStart, -1, 'browser auto-update delay helper was not found');
    assert.notEqual(requestStart, -1, 'browser Worker request helper was not found');
    assert.notEqual(requestEnd, -1, 'browser Worker request helper boundary was not found');
    assert.notEqual(syncStart, -1, 'browser schedule sync function was not found');
    assert.notEqual(syncEnd, -1, 'browser schedule sync function boundary was not found');

    return {
        source,
        fixedTimeFunctions: source.slice(helperStart, previousStart),
        autoUpdateFunction: source.slice(autoUpdateStart, syncStart),
        requestFunction: source.slice(requestStart, requestEnd),
        syncFunction: source.slice(syncStart, syncEnd),
    };
}

test('browser PWA fixed-time calculation matches Worker JST calculation', () => {
    const extracted = extractBrowserFunctions();
    const context = {
        fixedTimes: ['04:00', '16:00'],
        JAPAN_TIMEZONE_OFFSET_MS: 9 * 60 * 60 * 1000,
        isMobile: true,
        window: { isNativePlatform: false },
        Date,
    };
    vm.runInNewContext(`${extracted.fixedTimeFunctions}\nthis.getNextFixedTime = getNextFixedTime;`, context);

    const from = new Date('2026-09-18T06:30:00.000Z'); // 15:30 JST
    const browserNext = context.getNextFixedTime(from);
    const workerNext = scheduling.getNextTargetDate(from, ['04:00', '16:00'], 180);

    assert.equal(browserNext.toISOString(), workerNext.toISOString());
});

test('browser auto-update delay matches Worker calculation after operation completion', () => {
    const extracted = extractBrowserFunctions();
    const context = {
        fixedTimes: ['04:00', '16:00'],
        JAPAN_TIMEZONE_OFFSET_MS: 9 * 60 * 60 * 1000,
        isMobile: true,
        window: { isNativePlatform: false },
        autoUpdateNext: true,
        actionTimeSeconds: 30,
        cooldownMinutes: 60,
        notificationAdvanceSeconds: 10,
        Date,
    };
    vm.runInNewContext(
        `${extracted.fixedTimeFunctions}\n${extracted.autoUpdateFunction}\nthis.getNextWorkerAutoUpdateDelay = getNextWorkerAutoUpdateDelay;`,
        context,
    );

    const now = new Date('2026-09-18T06:59:50.000Z');
    const target = new Date('2026-09-18T07:00:00.000Z');
    const browserDelay = context.getNextWorkerAutoUpdateDelay(target, now.getTime());
    const workerResult = scheduling.calculateNextAutoUpdate({
        now,
        actionTimeSeconds: 30,
        advanceSeconds: 10,
        cooldownMinutes: 60,
        fixedTimes: ['04:00', '16:00'],
    });

    assert.equal(browserDelay, workerResult.delaySeconds);
});

test('browser does not log schedule success when Worker returns HTTP 500', async () => {
    const extracted = extractBrowserFunctions();
    const logs = [];
    const errors = [];
    let fetchCount = 0;
    const context = {
        WORKER_URL: 'https://worker.test',
        MAX_WORKER_DELAY_SECONDS: 86400,
        isMobile: true,
        window: { isNativePlatform: false },
        JAPAN_TIMEZONE_OFFSET_MS: 9 * 60 * 60 * 1000,
        notificationAdvanceSeconds: 0,
        remindTitle: 'title',
        remindBody: 'body',
        autoUpdateNext: true,
        cooldownMinutes: 180,
        actionTimeSeconds: 30,
        fixedTimes: ['04:00', '16:00'],
        sleepTimeEnabled: false,
        sleepTimeStart: '',
        sleepTimeEnd: '',
        sleepTimeNotifyOnEnd: true,
        sleepTimeAutoUpdate: false,
        localStorage: {
            getItem() {
                return JSON.stringify({ endpoint: 'https://push.test/subscription' });
            },
        },
        getNotificationSettings() {
            return { requireInteraction: false };
        },
        getNextWorkerAutoUpdateDelay() {
            return null;
        },
        fetch: async () => {
            fetchCount += 1;
            return {
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'queue failure',
            };
        },
        console: {
            log(...args) {
                logs.push(args.join(' '));
            },
            error(...args) {
                errors.push(args.join(' '));
            },
        },
        Date,
        JSON,
        Math,
    };

    vm.runInNewContext(
        `${extracted.requestFunction}\n${extracted.syncFunction}\nthis.syncScheduleToWorker = syncScheduleToWorker;`,
        context,
    );

    await context.syncScheduleToWorker(new Date(Date.now() + 3600 * 1000));

    assert.equal(fetchCount, 1);
    assert.equal(logs.some((line) => line.includes('Worker Sync: Scheduled')), false);
    assert.equal(errors.some((line) => line.includes('queue failure')), true);
});

test('browser rejects an overlong automatic-chain delay before calling Worker', async () => {
    const extracted = extractBrowserFunctions();
    const errors = [];
    const alerts = [];
    let fetchCount = 0;
    const context = {
        WORKER_URL: 'https://worker.test',
        MAX_WORKER_DELAY_SECONDS: 86400,
        isMobile: true,
        window: { isNativePlatform: false },
        JAPAN_TIMEZONE_OFFSET_MS: 9 * 60 * 60 * 1000,
        notificationAdvanceSeconds: 0,
        remindTitle: 'title',
        remindBody: 'body',
        autoUpdateNext: true,
        cooldownMinutes: 180,
        actionTimeSeconds: 30,
        fixedTimes: ['04:00', '16:00'],
        sleepTimeEnabled: false,
        sleepTimeStart: '',
        sleepTimeEnd: '',
        sleepTimeNotifyOnEnd: true,
        sleepTimeAutoUpdate: false,
        localStorage: {
            getItem() {
                return JSON.stringify({ endpoint: 'https://push.test/subscription' });
            },
        },
        getNotificationSettings() {
            return { requireInteraction: false };
        },
        getNextWorkerAutoUpdateDelay() {
            return 86401;
        },
        fetch: async () => {
            fetchCount += 1;
            return { ok: true, status: 200, text: async () => '' };
        },
        console: {
            log() {},
            error(...args) {
                errors.push(args.join(' '));
            },
        },
        alert(message) {
            alerts.push(message);
        },
        Date,
        JSON,
        Math,
    };

    vm.runInNewContext(
        `${extracted.requestFunction}\n${extracted.syncFunction}\nthis.syncScheduleToWorker = syncScheduleToWorker;`,
        context,
    );

    await context.syncScheduleToWorker(new Date(Date.now() + 3600 * 1000));

    assert.equal(fetchCount, 0);
    assert.equal(errors.some((line) => line.includes('auto-update delaySeconds')), true);
    assert.equal(alerts.length, 1);
});
