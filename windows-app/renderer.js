// === カフェタッチリマインダー Electron Renderer ===

let fixedTimes = [];
let cooldownMinutes = 180;
let actionTimeSeconds = 30;
let notificationAdvanceSeconds = 10;
let sleepTimeEnabled = false;
let sleepTimeStart = '';
let sleepTimeEnd = '';
let sleepTimeNotifyOnEnd = true;
let sleepTimeAutoUpdate = false;
let isDelayedBySleepTime = false;

let notifyOnComplete = false;
let notificationSound = true;
let requireInteraction = false;
let preventFocusOnNotificationClick = false;
let showTitleTimer = true;
let autoUpdateNext = true;
let startMinimized = false;
let closeToTray = false;
let muteNotifications = false;
let themeMode = 'system';
let nextNotificationTime = null;
let lastNotifiedTime = null;
let lastCompletedTime = null;
let pendingAutoUpdateTime = null;
let isDelayedNotification = false;

let remindTitle = "カフェタッチの時間です！";
let remindBody = "カフェタッチを忘れずに♪";
let completeTitle = "カフェタッチ完了！";

let lastScheduledSource = 'fixed';
let primaryColor = '#06BBFA';
let textColor = 'white';

let retroactiveBaseTime = null;
let worker = null;
let mainInterval = null;

const workerCode = `
    let timer = null;
    function startTimer(interval) {
        if (timer) clearInterval(timer);
        timer = setInterval(() => self.postMessage('tick'), interval);
    }
    self.onmessage = (e) => {
        if (e.data.type === 'setRate') startTimer(e.data.interval);
        if (e.data.type === 'stop') clearInterval(timer);
    };
    startTimer(200);
`;

function updateTimerSystem() {
    if (worker) {
        worker.postMessage({ type: 'stop' });
        worker.terminate();
        worker = null;
    }
    if (mainInterval) {
        clearInterval(mainInterval);
        mainInterval = null;
    }

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const objectUrl = URL.createObjectURL(blob);
    worker = new Worker(objectUrl);
    URL.revokeObjectURL(objectUrl);
    worker.onmessage = () => updateTimerLogic();
    setWorkerRate(document.hidden ? 1000 : 200);
}

function setWorkerRate(interval) {
    if (worker) worker.postMessage({ type: 'setRate', interval: interval });
}

function loadSettings() {
    const saved = localStorage.getItem('cafeTouchSettings');
    if (saved) {
        const settings = JSON.parse(saved);

        fixedTimes = settings.fixedTimes || [];
        primaryColor = settings.primaryColor || '#06BBFA';
        textColor = settings.textColor || 'white';
        cooldownMinutes = settings.cooldownMinutes || 180;
        actionTimeSeconds = settings.actionTimeSeconds || 30;
        notificationAdvanceSeconds = settings.notificationAdvanceSeconds !== undefined ? settings.notificationAdvanceSeconds : 10;
        notifyOnComplete = settings.notifyOnComplete || false;
        notificationSound = settings.notificationSound !== undefined ? settings.notificationSound : true;
        requireInteraction = settings.requireInteraction !== undefined ? settings.requireInteraction : false;
        preventFocusOnNotificationClick = settings.preventFocusOnNotificationClick !== undefined ? settings.preventFocusOnNotificationClick : false;
        showTitleTimer = settings.showTitleTimer !== undefined ? settings.showTitleTimer : true;
        autoUpdateNext = settings.autoUpdateNext !== undefined ? settings.autoUpdateNext : true;
        startMinimized = settings.startMinimized !== undefined ? settings.startMinimized : false;
        closeToTray = settings.closeToTray !== undefined ? settings.closeToTray : false;
        muteNotifications = settings.muteNotifications !== undefined ? settings.muteNotifications : false;
        themeMode = settings.themeMode || 'system';
        sleepTimeEnabled = settings.sleepTimeEnabled || false;
        sleepTimeStart = settings.sleepTimeStart || '';
        sleepTimeEnd = settings.sleepTimeEnd || '';
        sleepTimeNotifyOnEnd = settings.sleepTimeNotifyOnEnd !== undefined ? settings.sleepTimeNotifyOnEnd : true;
        sleepTimeAutoUpdate = settings.sleepTimeAutoUpdate || false;
        nextNotificationTime = settings.nextNotificationTime ? new Date(settings.nextNotificationTime) : null;
        lastNotifiedTime = settings.lastNotifiedTime ? new Date(settings.lastNotifiedTime) : null;
        lastCompletedTime = settings.lastCompletedTime ? new Date(settings.lastCompletedTime) : null;
        pendingAutoUpdateTime = settings.pendingAutoUpdateTime ? new Date(settings.pendingAutoUpdateTime) : null;
        isDelayedNotification = settings.isDelayedNotification || false;

        remindTitle = settings.remindTitle || "カフェタッチの時間です！";
        remindBody = settings.remindBody || "カフェタッチを忘れずに♪";
        completeTitle = settings.completeTitle || "カフェタッチ完了！";

        lastScheduledSource = settings.lastScheduledSource || 'fixed';
        isDelayedBySleepTime = settings.isDelayedBySleepTime || false;
    }

    if (!saved) {
        fixedTimes = ['04:00', '16:00'];
    }

    document.getElementById('cooldownInput').value = cooldownMinutes;
    document.getElementById('actionTimeInput').value = actionTimeSeconds;
    const advanceInput = document.getElementById('notificationAdvanceInput');
    if (advanceInput) advanceInput.value = notificationAdvanceSeconds;
    document.getElementById('notifyOnCompleteInput').checked = notifyOnComplete;
    document.getElementById('notificationSoundInput').checked = notificationSound;
    document.getElementById('requireInteractionInput').checked = requireInteraction;
    document.getElementById('preventFocusOnNotificationClickInput').checked = preventFocusOnNotificationClick;
    document.getElementById('showTitleTimerInput').checked = showTitleTimer;
    document.getElementById('autoUpdateNextInput').checked = autoUpdateNext;
    document.getElementById('startMinimizedInput').checked = startMinimized;
    document.getElementById('closeToTrayInput').checked = closeToTray;

    const sleepEnabledEl = document.getElementById('sleepTimeEnabledInput');
    if (sleepEnabledEl) {
        sleepEnabledEl.checked = sleepTimeEnabled;
        document.getElementById('sleepTimeStartInput').value = sleepTimeStart;
        document.getElementById('sleepTimeEndInput').value = sleepTimeEnd;
        document.getElementById('sleepTimeNotifyOnEndInput').checked = sleepTimeNotifyOnEnd;
        document.getElementById('sleepTimeAutoUpdateInput').checked = sleepTimeAutoUpdate;
        syncSleepTimeEnabled(sleepTimeEnabled);
        toggleSleepTimeAutoUpdate();
    }

    document.getElementById('colorPicker').value = primaryColor;

    document.getElementById('remindTitleInput').value = remindTitle;
    document.getElementById('remindBodyInput').value = remindBody;
    document.getElementById('completeTitleInput').value = completeTitle;

    const themeRadio = document.querySelector(`input[name="themeMode"][value="${themeMode}"]`);
    if (themeRadio) themeRadio.checked = true;

    toggleFocusSetting();
    updateFixedTimesList();
    updateTimerSystem();
    applyPrimaryColor();
    updateMuteUI();

    if (nextNotificationTime && nextNotificationTime < new Date()) {
        updateTimerLogic(true);
    } else if (!nextNotificationTime) {
        recalculateNextNotificationTime();
    }

    // すべてのトグルスイッチに変更リスナーを登録（未設定のもののみ）
    const toggleInputs = document.querySelectorAll('.toggle-switch input[type="checkbox"]');
    toggleInputs.forEach(input => {
        if (!input.hasAttribute('onchange')) {
            input.addEventListener('change', () => {
                if (input.id === 'requireInteractionInput') toggleFocusSetting();
                saveSettingsAuto();
                if (input.id === 'showTitleTimerInput') updateDynamicTitle();
                if (input.id === 'closeToTrayInput' && window.electronAPI) {
                    window.electronAPI.updateCloseBehavior(document.getElementById('closeToTrayInput').checked);
                }
            });
        }
    });

    if (window.electronAPI) {
        window.electronAPI.updateCloseBehavior(closeToTray);
        window.electronAPI.onWindowReady(() => {
            if (startMinimized) {
                window.electronAPI.hideWindow();
            }
        });
    }
}

function saveSettings() {
    cooldownMinutes = parseInt(document.getElementById('cooldownInput').value) || 180;
    actionTimeSeconds = parseInt(document.getElementById('actionTimeInput').value) || 0;
    notificationAdvanceSeconds = parseInt(document.getElementById('notificationAdvanceInput')?.value) || 0;
    notifyOnComplete = document.getElementById('notifyOnCompleteInput').checked;
    notificationSound = document.getElementById('notificationSoundInput').checked;
    requireInteraction = document.getElementById('requireInteractionInput').checked;
    preventFocusOnNotificationClick = document.getElementById('preventFocusOnNotificationClickInput').checked;
    showTitleTimer = document.getElementById('showTitleTimerInput').checked;
    autoUpdateNext = document.getElementById('autoUpdateNextInput').checked;
    startMinimized = document.getElementById('startMinimizedInput').checked;
    closeToTray = document.getElementById('closeToTrayInput').checked;

    remindTitle = document.getElementById('remindTitleInput').value || "カフェタッチの時間です！";
    remindBody = document.getElementById('remindBodyInput').value || "カフェタッチを忘れずに♪";
    completeTitle = document.getElementById('completeTitleInput').value || "カフェタッチ完了！";

    const themeCheck = document.querySelector('input[name="themeMode"]:checked');
    themeMode = themeCheck ? themeCheck.value : 'system';
    primaryColor = document.getElementById('colorPicker').value;

    const sleepEnabledEl = document.getElementById('sleepTimeEnabledInput');
    if (sleepEnabledEl) {
        sleepTimeEnabled = sleepEnabledEl.checked;
        sleepTimeStart = document.getElementById('sleepTimeStartInput').value;
        sleepTimeEnd = document.getElementById('sleepTimeEndInput').value;
        sleepTimeNotifyOnEnd = document.getElementById('sleepTimeNotifyOnEndInput').checked;
        sleepTimeAutoUpdate = document.getElementById('sleepTimeAutoUpdateInput').checked;
    }

    const settings = {
        fixedTimes, cooldownMinutes, actionTimeSeconds, notificationAdvanceSeconds, notifyOnComplete, notificationSound,
        requireInteraction, preventFocusOnNotificationClick,
        showTitleTimer, autoUpdateNext, startMinimized, closeToTray, muteNotifications, themeMode,
        sleepTimeEnabled, sleepTimeStart, sleepTimeEnd, sleepTimeNotifyOnEnd, sleepTimeAutoUpdate,
        nextNotificationTime: nextNotificationTime ? nextNotificationTime.toISOString() : null,
        lastNotifiedTime: lastNotifiedTime ? lastNotifiedTime.toISOString() : null,
        lastCompletedTime: lastCompletedTime ? lastCompletedTime.toISOString() : null,
        pendingAutoUpdateTime: pendingAutoUpdateTime ? pendingAutoUpdateTime.toISOString() : null,
        isDelayedNotification,
        remindTitle, remindBody, completeTitle,
        lastScheduledSource, primaryColor, textColor,
        isDelayedBySleepTime
    };
    localStorage.setItem('cafeTouchSettings', JSON.stringify(settings));
}

function saveSettingsAuto() {
    saveSettings();
}

function saveSettingsAndRecalculate() {
    saveSettings();
    recalculateNextNotificationTime();
}

function toggleFocusSetting() {
    const isRequire = document.getElementById('requireInteractionInput').checked;
    const wrapper = document.getElementById('preventFocusWrapper');
    const input = document.getElementById('preventFocusOnNotificationClickInput');

    if (isRequire) {
        wrapper.classList.remove('setting-disabled');
        input.disabled = false;
    } else {
        wrapper.classList.add('setting-disabled');
        input.disabled = true;
    }
}

function toggleSleepTimeAutoUpdate() {
    const isNotifyOnEnd = document.getElementById('sleepTimeNotifyOnEndInput').checked;
    const wrapper = document.getElementById('sleepTimeAutoUpdateWrapper');
    const input = document.getElementById('sleepTimeAutoUpdateInput');

    if (isNotifyOnEnd) {
        wrapper.classList.remove('setting-disabled');
        input.disabled = false;
    } else {
        wrapper.classList.add('setting-disabled');
        input.disabled = true;
    }
}

function syncSleepTimeEnabled(isEnabled) {
    sleepTimeEnabled = isEnabled;
    const outer = document.getElementById('sleepTimeEnabledInput');
    const inner = document.getElementById('sleepTimeEnabledInputInner');
    if (outer) outer.checked = isEnabled;
    if (inner) inner.checked = isEnabled;
    toggleSleepTimeAutoUpdate();
}

function setThemeMode(mode) {
    themeMode = mode;
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    if (mode === 'dark') document.documentElement.classList.add('theme-dark');
    else if (mode === 'light') document.documentElement.classList.add('theme-light');
    saveSettings();
}

function showAddFixedTimeMode() {
    document.getElementById('showAddFixedTimeBtn').style.display = 'none';
    document.getElementById('addFixedTimeInputGroup').style.display = 'flex';
    document.getElementById('fixedTimeInput').focus();
}

function hideAddFixedTimeMode() {
    document.getElementById('showAddFixedTimeBtn').style.display = 'flex';
    document.getElementById('addFixedTimeInputGroup').style.display = 'none';
    document.getElementById('fixedTimeInput').value = '';
}

function addFixedTime() {
    const input = document.getElementById('fixedTimeInput');
    if (input.value && !fixedTimes.includes(input.value)) {
        fixedTimes.push(input.value);
        fixedTimes.sort();
        updateFixedTimesList();
        input.value = '';
        recalculateNextNotificationTime();
        hideAddFixedTimeMode();
    } else if (!input.value) {
        hideAddFixedTimeMode();
    }
}

function removeFixedTime(time, event) {
    const tag = event.target.closest('.time-tag');
    if (!tag) return;
    fixedTimes = fixedTimes.filter(t => t !== time);
    tag.classList.add('deleted');
    tag.style.backgroundColor = 'var(--color-control-bg)';
    tag.style.color = 'var(--color-text-secondary)';
    tag.style.boxShadow = 'none';
    tag.innerHTML = `
        <span style="opacity: 0.7; font-size: 13px;">${time} を削除しました</span>
        <button onclick="undoDelete('${time}')" style="margin-left: 8px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; padding: 2px 8px; cursor: pointer; color: var(--color-text); font-size: 12px;">↺ 元に戻す</button>
    `;
    setTimeout(() => {
        if (tag.parentNode && tag.classList.contains('deleted')) {
            tag.remove();
        }
    }, 8000);
    recalculateNextNotificationTime();
}

function undoDelete(time) {
    if (!fixedTimes.includes(time)) {
        fixedTimes.push(time);
        fixedTimes.sort();
        updateFixedTimesList();
        recalculateNextNotificationTime();
    }
}

function updateFixedTimesList() {
    const list = document.getElementById('fixedTimesList');
    list.innerHTML = '';
    fixedTimes.forEach(time => {
        const tag = document.createElement('div');
        tag.className = 'time-tag';
        tag.style.backgroundColor = primaryColor;
        tag.style.color = textColor;
        const clockIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        tag.innerHTML = `${clockIcon}${time} <button onclick="removeFixedTime('${time}', event)">×</button>`;
        list.appendChild(tag);
    });
}

function recalculateNextNotificationTime(isRetroactive = false) {
    const now = new Date();
    const nextFixed = getNextFixedTime(now);

    if (lastCompletedTime) {
        const cooldownEnd = new Date(lastCompletedTime.getTime() + cooldownMinutes * 60 * 1000);
        const firstResetAfterTouch = getNextFixedTime(lastCompletedTime);

        if (firstResetAfterTouch && firstResetAfterTouch < cooldownEnd) {
            nextNotificationTime = firstResetAfterTouch;
            lastScheduledSource = 'fixed';
        } else {
            nextNotificationTime = cooldownEnd;
            lastScheduledSource = 'completed';
        }
    } else {
        if (fixedTimes.length === 0) {
            nextNotificationTime = null;
        } else {
            nextNotificationTime = nextFixed;
            lastScheduledSource = 'fixed';
        }
    }

    lastNotifiedTime = null;
    pendingAutoUpdateTime = null;
    isDelayedNotification = false;
    document.getElementById('completedBtn').classList.remove('btn-emphasis');
    document.getElementById('autoUpdateBar').style.width = '0%';

    // 遡及登録時、すでに時間を過ぎていたら即座に「通知済み」にしてサイレント待機モードにする
    if (isRetroactive && nextNotificationTime && nextNotificationTime <= now) {
        lastNotifiedTime = nextNotificationTime;
        isDelayedNotification = true;
    }

    // おやすみタイムの適用
    if (sleepTimeEnabled && sleepTimeStart && sleepTimeEnd && (sleepTimeStart !== sleepTimeEnd)) {
        const sleepResult = applySleepTime(nextNotificationTime);
        if (sleepResult.isInside) {
            if (sleepTimeNotifyOnEnd) {
                nextNotificationTime = sleepResult.nextDate;
                isDelayedBySleepTime = true;
            } else {
                nextNotificationTime = null;
            }
        } else {
            isDelayedBySleepTime = false;
        }
    } else {
        isDelayedBySleepTime = false;
    }

    saveSettings();
    updateTimerLogic(true);
}

// おやすみタイム判定ロジック
function applySleepTime(targetDate) {
    if (!targetDate) return { isInside: false, nextDate: null };

    const [sh, sm] = sleepTimeStart.split(':').map(Number);
    const [eh, em] = sleepTimeEnd.split(':').map(Number);

    const startDate = new Date(targetDate);
    startDate.setHours(sh, sm, 0, 0);

    let endDate = new Date(targetDate);
    endDate.setHours(eh, em, 0, 0);

    if (startDate > endDate) {
        endDate.setDate(endDate.getDate() + 1);
    }

    let checkStart = new Date(startDate);
    let checkEnd = new Date(endDate);
    if (sh > eh) {
        if (targetDate.getHours() < eh || (targetDate.getHours() === eh && targetDate.getMinutes() < em)) {
            checkStart.setDate(checkStart.getDate() - 1);
            checkEnd = new Date(targetDate);
            checkEnd.setHours(eh, em, 0, 0);
        } else {
            checkEnd.setDate(checkEnd.getDate() + 1);
        }
    }

    const isInside = (targetDate >= checkStart && targetDate < checkEnd);
    return {
        isInside,
        nextDate: isInside ? checkEnd : targetDate
    };
}

function markCompleted(isAuto = false) {
    const now = new Date();
    lastCompletedTime = now;
    recalculateNextNotificationTime(isAuto);
    if (!isAuto && notifyOnComplete) showNotification(completeTitle, `>> ${formatTime(nextNotificationTime)}`, 'complete');
}

function resetTimer() {
    lastCompletedTime = null;
    nextNotificationTime = null;
    lastNotifiedTime = null;
    pendingAutoUpdateTime = null;
    isDelayedNotification = false;
    saveSettings();
    updateTimerLogic(true);
}

function getNextFixedTime(fromTime) {
    if (fixedTimes.length === 0) return null;
    const from = new Date(fromTime);
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    let nextTime = null;
    for (const timeStr of fixedTimes) {
        const [h, m] = timeStr.split(':').map(Number);
        const candidate = new Date(today);
        candidate.setHours(h, m, 0, 0);
        if (candidate > from) {
            if (!nextTime || candidate < nextTime) nextTime = candidate;
        }
    }
    if (!nextTime) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const [h, m] = fixedTimes[0].split(':').map(Number);
        nextTime = new Date(tomorrow);
        nextTime.setHours(h, m, 0, 0);
    }
    return nextTime;
}

function getPreviousFixedTime(fromTime) {
    if (fixedTimes.length === 0) return null;
    const from = new Date(fromTime);
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    let prevTime = null;

    for (const timeStr of fixedTimes) {
        const [h, m] = timeStr.split(':').map(Number);
        const candidate = new Date(today);
        candidate.setHours(h, m, 0, 0);
        if (candidate < from) {
            if (!prevTime || candidate > prevTime) prevTime = candidate;
        }
    }

    if (!prevTime) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const lastTimeStr = fixedTimes[fixedTimes.length - 1];
        const [h, m] = lastTimeStr.split(':').map(Number);
        prevTime = new Date(yesterday);
        prevTime.setHours(h, m, 0, 0);
    }
    return prevTime;
}

function updateTimerLogic(forceUpdate = false) {
    const now = new Date();
    const lastTouchText = lastCompletedTime ? formatTime(lastCompletedTime) : '00:00:00';
    const nextTouchText = nextNotificationTime ? formatTime(nextNotificationTime) : '00:00:00';

    const updateInfo = (last, status, next) => {
        updateText('lastTouchDisplay', `前回 ${last}`);
        updateText('statusDisplay', status);
        updateText('nextTouchDisplay', `次回 ${next}`);

        const isReset = (!lastCompletedTime);
        document.getElementById('timer').classList.toggle('placeholder', isReset);
        document.getElementById('lastTouchDisplay').classList.toggle('placeholder', isReset);
    };

    if (!nextNotificationTime) {
        updateText('timer', '00:00:00');
        updateInfo('00:00:00', 'タイマー未設定', '未設定');
        updateDynamicTitle();
        return;
    }

    const timeSinceScheduled = now - nextNotificationTime;
    const actionWaitMs = actionTimeSeconds * 1000;

    // 1. 通知の発信判定
    if (timeSinceScheduled >= -(notificationAdvanceSeconds * 1000)) {
        if (!lastNotifiedTime || lastNotifiedTime.getTime() !== nextNotificationTime.getTime()) {
            const delayThreshold = 60000;
            isDelayedNotification = (timeSinceScheduled > delayThreshold);

            showNotification(remindTitle, remindBody, 'remind');
            lastNotifiedTime = nextNotificationTime;
            saveSettings();
        }
    }

    // 2. 手動操作待ちモード
    const effectiveAutoUpdate = isDelayedBySleepTime ? sleepTimeAutoUpdate : autoUpdateNext;
    if (isDelayedNotification || (!effectiveAutoUpdate && timeSinceScheduled >= 0)) {
        updateText('timer', '00:00:00');
        updateInfo(lastTouchText, "タッチ待機中...", nextTouchText);
        updateDynamicTitle();
        document.getElementById('completedBtn').classList.add('btn-emphasis');
        document.getElementById('autoUpdateBar').style.width = '0%';
        return;
    }

    // 3. リセット状態
    if (!lastCompletedTime && timeSinceScheduled < 0) {
        updateText('timer', '00:00:00');
        updateInfo('00:00:00', '', nextTouchText);
        updateDynamicTitle();
        document.getElementById('autoUpdateBar').style.width = '0%';
        return;
    }

    // 4. 操作待機中
    if (timeSinceScheduled >= 0 && timeSinceScheduled < actionWaitMs) {
        const remainingWait = Math.ceil((actionWaitMs - timeSinceScheduled) / 1000);
        const progress = (timeSinceScheduled / actionWaitMs) * 100;

        updateText('timer', '00:00:00');
        updateInfo(lastTouchText, `カフェタッチ中... (${remainingWait}s)`, nextTouchText);
        updateDynamicTitle();
        document.getElementById('autoUpdateBar').style.width = `${progress}%`;
        return;
    }

    // 5. 自動更新の実行
    if (timeSinceScheduled >= actionWaitMs) {
        document.getElementById('autoUpdateBar').style.width = '100%';
        lastCompletedTime = new Date(nextNotificationTime.getTime() + actionWaitMs);

        const originalAutoUpdate = autoUpdateNext;
        if (isDelayedBySleepTime) {
            autoUpdateNext = sleepTimeAutoUpdate;
        }

        if (autoUpdateNext) {
            recalculateNextNotificationTime(false);
        }

        autoUpdateNext = originalAutoUpdate;
        return;
    }

    // 6. 通常カウントダウン中
    const diff = nextNotificationTime - now;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastComplete = lastCompletedTime ? (now - lastCompletedTime) : Infinity;

    let canTouchAnytime = false;
    if (lastScheduledSource === 'fixed' && diff > cooldownMs && timeSinceLastComplete > cooldownMs) {
        canTouchAnytime = true;
    }
    if (lastCompletedTime) {
        const nextResetAfterTouch = getNextFixedTime(lastCompletedTime);
        if (nextResetAfterTouch && nextResetAfterTouch <= now) {
            canTouchAnytime = true;
        }
    }

    if (canTouchAnytime) {
        updateText('timer', '00:00:00');
        updateInfo(lastTouchText, "いつでもタッチ可能", nextTouchText);
        updateDynamicTitle();
        document.getElementById('autoUpdateBar').style.width = '0%';
        return;
    }

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    updateText('timer', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    updateInfo(lastTouchText, "", nextTouchText);
    updateDynamicTitle();
    document.getElementById('autoUpdateBar').style.width = '0%';
}

// 動的なタイトル更新 (Electron ウィンドウタイトル)
function updateDynamicTitle() {
    const baseTitle = "カフェタッチリマインダー";

    const setBothTitles = (text) => {
        if (window.electronAPI) window.electronAPI.setTitle(text);
        const tbText = document.getElementById('titlebar-text');
        if (tbText) tbText.textContent = text;
    };

    if (!showTitleTimer || !nextNotificationTime) {
        setBothTitles(baseTitle);
        return;
    }

    const now = new Date();
    const timeSinceScheduled = now - nextNotificationTime;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastComplete = lastCompletedTime ? (now - lastCompletedTime) : Infinity;

    let isTouchTiming = (timeSinceScheduled >= 0) ||
        (lastScheduledSource === 'fixed' && (nextNotificationTime - now) > cooldownMs && timeSinceLastComplete > cooldownMs) ||
        (lastCompletedTime && getNextFixedTime(lastCompletedTime) <= now);

    if (isTouchTiming) {
        setBothTitles(baseTitle);
    } else {
        const diff = nextNotificationTime - now;
        const totalMinutes = Math.ceil(diff / 60000);
        setBothTitles(`(${totalMinutes}分) ${baseTitle}`);
    }
}

function updateText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

function formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// Electron通知 (メインプロセスの Notification API を使用)
function showNotification(title, body, type = 'normal') {
    if (muteNotifications && type !== 'test') return;

    const keepNotification = document.getElementById('requireInteractionInput') ? document.getElementById('requireInteractionInput').checked : false;
    const shouldRequireInteractionPC = (type === 'remind' && keepNotification);

    if (window.electronAPI) {
        window.electronAPI.showNotification(title, body, {
            silent: !notificationSound,
            requireInteraction: shouldRequireInteractionPC,
            preventFocus: preventFocusOnNotificationClick
        });
    }
}

// 通知クリック時のコールバック
if (window.electronAPI) {
    window.electronAPI.onNotificationClicked(() => {
        const keepNotification = document.getElementById('requireInteractionInput') ? document.getElementById('requireInteractionInput').checked : false;
        if (keepNotification) {
            markCompleted();
        }
    });
}

function sendTestNotification() {
    showNotification(remindTitle, remindBody + " (テスト)", 'test');
}

function setColor(color) {
    primaryColor = color;
    document.getElementById('colorPicker').value = color;
    applyPrimaryColor();
    saveSettings();
}

function setTextColor(color) {
    textColor = color;
    applyPrimaryColor();
    saveSettings();
}

function applyPrimaryColor() {
    document.documentElement.style.setProperty('--color-teal-500', primaryColor);
    document.documentElement.style.setProperty('--color-teal-300', primaryColor);
    document.documentElement.style.setProperty('--initial-color', primaryColor);
    document.documentElement.style.setProperty('--initial-text-color', textColor);

    let r = 0, g = 0, b = 0;
    if (primaryColor.startsWith('#')) {
        r = parseInt(primaryColor.slice(1, 3), 16);
        g = parseInt(primaryColor.slice(3, 5), 16);
        b = parseInt(primaryColor.slice(5, 7), 16);
    }
    document.documentElement.style.setProperty('--color-teal-500-rgb', `${r}, ${g}, ${b}`);

    if (window.electronAPI && window.electronAPI.setTitleBarOverlay) {
        window.electronAPI.setTitleBarOverlay(primaryColor, textColor === 'white' ? '#ffffff' : '#000000');
    }

    updateFixedTimesList();
    document.getElementById('timer').style.color = primaryColor;
    document.querySelector('h1').style.color = primaryColor;

    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.style.color = muteNotifications ? '#e34a45' : primaryColor;
    }
}

// ミュート制御
function toggleMute() {
    muteNotifications = !muteNotifications;
    updateMuteUI();
    saveSettings();
}

function updateMuteUI() {
    const btn = document.getElementById('muteBtn');
    const iconOn = document.getElementById('bellIconOn');
    const iconOff = document.getElementById('bellIconOff');
    if (!btn || !iconOn || !iconOff) return;

    if (muteNotifications) {
        btn.classList.add('muted');
        iconOn.style.display = 'none';
        iconOff.style.display = 'block';
        btn.style.color = '#e34a45';
    } else {
        btn.classList.remove('muted');
        iconOn.style.display = 'block';
        iconOff.style.display = 'none';
        btn.style.color = primaryColor;
    }
}

// 遡及登録
function toggleRetroactiveMode() {
    const panel = document.getElementById('retroactivePanel');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';
    retroactiveBaseTime = new Date();
    const now = retroactiveBaseTime;
    document.getElementById('retroactiveTimeInput').value =
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    document.getElementById('retroactiveSlider').value = 0;
    document.getElementById('retroactiveSlider').min = -cooldownMinutes;
    document.getElementById('retroactiveSliderLabelMin').textContent = `${Math.floor(cooldownMinutes / 60)}時間前`;
    document.getElementById('retroactiveRangeLabel').textContent = '前回タッチした時刻を設定してください';
}

function syncTimeFromSlider() {
    const offset = parseInt(document.getElementById('retroactiveSlider').value);
    const base = retroactiveBaseTime || new Date();
    const target = new Date(base.getTime() + offset * 60000);
    document.getElementById('retroactiveTimeInput').value =
        `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;

    if (offset === 0) {
        document.getElementById('retroactiveRangeLabel').textContent = '前回タッチした時刻を設定してください';
    } else {
        const absMin = Math.abs(offset);
        const h = Math.floor(absMin / 60);
        const m = absMin % 60;
        if (h > 0 && m > 0) {
            document.getElementById('retroactiveRangeLabel').textContent = `約${h}時間${m}分前`;
        } else if (h > 0) {
            document.getElementById('retroactiveRangeLabel').textContent = `約${h}時間前`;
        } else {
            document.getElementById('retroactiveRangeLabel').textContent = `約${m}分前`;
        }
    }
}

function syncSliderFromTime() {
    const timeVal = document.getElementById('retroactiveTimeInput').value;
    if (!timeVal) return;
    const [h, m] = timeVal.split(':').map(Number);
    const base = retroactiveBaseTime || new Date();
    const target = new Date(base);
    target.setHours(h, m, 0, 0);
    if (target > base) target.setDate(target.getDate() - 1);
    const diffMin = Math.round((target - base) / 60000);
    const slider = document.getElementById('retroactiveSlider');
    const clampedValue = Math.max(parseInt(slider.min), Math.min(0, diffMin));
    slider.value = clampedValue;
    syncTimeFromSlider();
}

function confirmRetroactive() {
    const timeVal = document.getElementById('retroactiveTimeInput').value;
    if (!timeVal) return;
    const [h, m] = timeVal.split(':').map(Number);
    const now = new Date();
    const completedAt = new Date(now);
    completedAt.setHours(h, m, 0, 0);
    if (completedAt > now) completedAt.setDate(completedAt.getDate() - 1);
    lastCompletedTime = completedAt;
    recalculateNextNotificationTime(true);
    document.getElementById('retroactivePanel').style.display = 'none';
}

// 設定リセット
function resetApp() {
    if (confirm('すべての設定を削除しますか？\nこの操作は取り消せません。')) {
        localStorage.removeItem('cafeTouchSettings');
        location.reload();
    }
}

// === Visibility Change ===
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        setWorkerRate(200);
        updateTimerLogic(true);
    } else {
        setWorkerRate(1000);
    }
});

// === Load ===
window.addEventListener('load', () => {
    loadSettings();

    document.getElementById('showTitleTimerInput').addEventListener('change', saveSettingsAndRecalculate);
    document.getElementById('notifyOnCompleteInput').addEventListener('change', saveSettings);
    document.getElementById('notificationSoundInput').addEventListener('change', saveSettings);
    document.getElementById('requireInteractionInput').addEventListener('change', () => { toggleFocusSetting(); saveSettings(); });
    document.getElementById('preventFocusOnNotificationClickInput').addEventListener('change', saveSettings);
    document.getElementById('autoUpdateNextInput').addEventListener('change', saveSettings);
    document.getElementById('sleepTimeEnabledInput')?.addEventListener('change', saveSettings);
    document.getElementById('sleepTimeNotifyOnEndInput')?.addEventListener('change', () => { toggleSleepTimeAutoUpdate(); saveSettings(); });
    document.getElementById('sleepTimeAutoUpdateInput')?.addEventListener('change', saveSettings);
});
