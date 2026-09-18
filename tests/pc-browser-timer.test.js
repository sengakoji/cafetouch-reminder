const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const fixedStart = source.indexOf('        const JAPAN_TIMEZONE_OFFSET_MS');
const timerStart = source.indexOf('        function updateTimerLogic', fixedStart);
const timerEnd = source.indexOf('        // 動的なタイトル更新', timerStart);
const recalculateStart = source.indexOf('        function recalculateNextNotificationTime');
const recalculateEnd = source.indexOf('        function generateFutureSchedules', recalculateStart);
const sleepStart = source.indexOf('        function applySleepTime');
const sleepEnd = source.indexOf('        function markCompleted', sleepStart);
assert.ok(fixedStart >= 0 && timerStart > fixedStart && timerEnd > timerStart);
assert.ok(recalculateStart >= 0 && recalculateEnd > recalculateStart);
assert.ok(sleepStart >= 0 && sleepEnd > sleepStart);

function localTime(day, hour, minute = 0, second = 0) {
    return new Date(2026, 8, day, hour, minute, second);
}

function createTimer({ now, oldTime = localTime(18, 12), fixedTimes = ['04:00', '16:00'], advance = 10,
    mobile = false, standalone = false, native = false, sleepDelayed = false,
    sleepEnabled = false, delayed = true, alreadyNotified = true } = {}) {
    const clock = { now: now.getTime() };
    const notifications = [];
    const display = {};
    let saves = 0;
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    }
    const element = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {} });
    const elements = new Map();
    const context = {
        Date: ClockDate,
        window: { isNativePlatform: native },
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        } },
        updateText(id, value) { display[id] = value; },
        formatTime(value) { return value.toTimeString().slice(0, 8); },
        updateDynamicTitle() {},
        showNotification(...args) { notifications.push(args); },
        saveSettings() { saves += 1; },
        console: { log() {} },
    };
    const initial = `
        let fixedTimes = ${JSON.stringify(fixedTimes)};
        let cooldownMinutes = 180;
        let actionTimeSeconds = 30;
        let notificationAdvanceSeconds = ${advance};
        let nextNotificationTime = new Date(${oldTime.getTime()});
        let lastNotifiedTime = ${alreadyNotified ? `new Date(${oldTime.getTime()})` : 'null'};
        let lastCompletedTime = new Date(${localTime(18, 9).getTime()});
        let isDelayedNotification = ${delayed};
        let isDelayedBySleepTime = ${sleepDelayed};
        let isMobile = ${mobile};
        let isStandalone = ${standalone};
        let autoUpdateNext = true;
        let sleepTimeAutoUpdate = false;
        let sleepTimeEnabled = ${sleepEnabled};
        let sleepTimeStart = '15:00';
        let sleepTimeEnd = '17:00';
        let sleepTimeNotifyOnEnd = true;
        let lastScheduledSource = 'completed';
        let remindTitle = 'title';
        let remindBody = 'body';
        function snapshot() { return {
            next: nextNotificationTime?.getTime(),
            completed: lastCompletedTime?.getTime(),
            notified: lastNotifiedTime?.getTime(),
            delayed: isDelayedNotification,
            source: lastScheduledSource,
        }; }
    `;
    vm.runInNewContext(`${initial}\n${source.slice(fixedStart, timerStart)}\n${source.slice(sleepStart, sleepEnd)}\n${source.slice(recalculateStart, recalculateEnd)}\n${source.slice(timerStart, timerEnd)}\nthis.tick = updateTimerLogic; this.recalculate = recalculateNextNotificationTime; this.snapshot = snapshot;`, context);
    return {
        tick: () => context.tick(),
        recalculate: (retroactive) => context.recalculate(retroactive),
        state: () => context.snapshot(),
        moveTo: (time) => { clock.now = time.getTime(); },
        notifications,
        display,
        saves: () => saves,
    };
}

test('delayed PC timer waits for a future fixed time, fires once, then completes and schedules normally', () => {
    const timer = createTimer({ now: localTime(18, 15, 30) });
    const old = timer.state();
    timer.tick();
    assert.deepEqual(timer.state(), old);
    assert.equal(timer.display.statusDisplay, 'タッチ待機中...');
    timer.moveTo(localTime(18, 15, 59, 49));
    timer.tick();
    assert.equal(timer.notifications.length, 0);

    timer.moveTo(localTime(18, 15, 59, 50));
    timer.tick();
    assert.equal(timer.notifications.length, 1);
    assert.equal(timer.state().next, localTime(18, 16).getTime());
    assert.equal(timer.state().source, 'fixed');
    assert.equal(timer.state().delayed, false);
    assert.equal(timer.state().completed, old.completed);
    timer.tick();
    assert.equal(timer.notifications.length, 1);

    timer.moveTo(localTime(18, 16, 0, 29));
    timer.tick();
    assert.equal(timer.state().completed, old.completed);
    timer.moveTo(localTime(18, 16, 0, 30));
    timer.tick();
    assert.equal(timer.state().completed, localTime(18, 16, 0, 30).getTime());
    assert.equal(timer.state().next, localTime(18, 19, 0, 30).getTime());
    assert.equal(timer.state().delayed, false);
    assert.equal(timer.notifications.length, 1);
});

test('stale fixed times never recover or replay after weeks away', () => {
    const oldTime = localTime(1, 12);
    const timer = createTimer({ now: localTime(18, 17), oldTime });
    const old = timer.state();
    timer.tick();
    timer.tick();
    assert.deepEqual(timer.state(), old);
    assert.equal(timer.notifications.length, 0);
    assert.equal(timer.display.statusDisplay, 'タッチ待機中...');

    timer.moveTo(localTime(19, 15, 30));
    timer.tick();
    assert.deepEqual(timer.state(), old);
    timer.moveTo(localTime(19, 16));
    timer.tick();
    assert.equal(timer.notifications.length, 1);
    assert.equal(timer.state().next, localTime(19, 16).getTime());
});

test('the PC fixed-time recovery window includes 60 seconds but excludes later times', () => {
    const inWindow = createTimer({ now: localTime(18, 16, 1) });
    inWindow.tick();
    assert.equal(inWindow.notifications.length, 1);
    const expired = createTimer({ now: localTime(18, 16, 1, 1) });
    const old = expired.state();
    expired.tick();
    assert.deepEqual(expired.state(), old);
    assert.equal(expired.notifications.length, 0);
});

test('without fixed times or on other platforms the delayed state stays unchanged', () => {
    for (const options of [
        { fixedTimes: [] },
        { mobile: true },
        { standalone: true },
        { native: true },
        { sleepDelayed: true },
        { sleepEnabled: true },
    ]) {
        const timer = createTimer({ now: localTime(18, 16), ...options });
        const old = timer.state();
        timer.tick();
        assert.deepEqual(timer.state(), old, JSON.stringify(options));
        assert.equal(timer.notifications.length, 0, JSON.stringify(options));
    }
});

test('ordinary PC notification and retroactive delayed registration keep their existing flow', () => {
    const ordinary = createTimer({
        now: localTime(18, 15, 59, 50), oldTime: localTime(18, 16),
        delayed: false, alreadyNotified: false,
    });
    ordinary.tick();
    assert.equal(ordinary.notifications.length, 1);
    assert.equal(ordinary.state().delayed, false);
    ordinary.moveTo(localTime(18, 16, 0, 30));
    ordinary.tick();
    assert.equal(ordinary.state().next, localTime(18, 19, 0, 30).getTime());

    const retroactive = createTimer({ now: localTime(18, 15, 30), fixedTimes: ['16:00'] });
    retroactive.recalculate(true);
    const registered = retroactive.state();
    assert.equal(registered.next, localTime(18, 12).getTime());
    assert.equal(registered.delayed, true);
    retroactive.tick();
    assert.deepEqual(retroactive.state(), registered);
    assert.equal(retroactive.notifications.length, 0);
});
