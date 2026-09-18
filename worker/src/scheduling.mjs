const JST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

export const MAX_QUEUE_DELAY_SECONDS = 86400;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }
  return date;
}

function getJstCalendarDate(date) {
  const jstDate = new Date(date.getTime() + JST_OFFSET_MILLISECONDS);
  return {
    year: jstDate.getUTCFullYear(),
    month: jstDate.getUTCMonth(),
    day: jstDate.getUTCDate(),
  };
}

/** Create an instant for a fixed Asia/Tokyo wall-clock time. */
export function createJstFixedTime(fromTime, timeString, dayOffset = 0) {
  const from = asDate(fromTime);
  const [hours, minutes] = String(timeString).split(':').map(Number);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const { year, month, day } = getJstCalendarDate(from);
  const utcMilliseconds = Date.UTC(year, month, day + dayOffset, hours, minutes, 0, 0);
  return new Date(utcMilliseconds - JST_OFFSET_MILLISECONDS);
}

/** Return the next configured fixed time strictly after `fromTime` in JST. */
export function getNextFixedTimeJst(fromTime, fixedTimes) {
  const from = asDate(fromTime);
  if (!Array.isArray(fixedTimes) || fixedTimes.length === 0) {
    return null;
  }

  let nextTime = null;
  for (const timeString of fixedTimes) {
    const todayCandidate = createJstFixedTime(from, timeString);
    if (!todayCandidate) continue;

    const candidate = todayCandidate > from
      ? todayCandidate
      : createJstFixedTime(from, timeString, 1);
    if (candidate && (!nextTime || candidate < nextTime)) {
      nextTime = candidate;
    }
  }
  return nextTime;
}

/** Calculate the next target from operation completion time. */
export function getNextTargetDate(now, fixedTimes, cooldownMinutes) {
  const from = asDate(now);
  const candidates = [];
  const nextFixedTime = getNextFixedTimeJst(from, fixedTimes);
  if (nextFixedTime) {
    candidates.push(nextFixedTime);
  }

  const cooldownDate = new Date(from.getTime() + cooldownMinutes * 60 * 1000);
  if (!Number.isNaN(cooldownDate.getTime())) {
    candidates.push(cooldownDate);
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] || null;
}

/**
 * Reproduce the browser's automatic-chain calculation for a Queue message.
 * `now` is when the Queue consumer actually runs; the target is based on the
 * original notification time (`now + advanceSeconds`).
 */
export function calculateNextAutoUpdate({
  now,
  actionTimeSeconds,
  advanceSeconds = 0,
  cooldownMinutes,
  fixedTimes,
}) {
  const actualNow = asDate(now);
  const scheduledNotificationTime = new Date(actualNow.getTime() + advanceSeconds * 1000);
  const completionTime = new Date(scheduledNotificationTime.getTime() + actionTimeSeconds * 1000);
  const nextTargetTime = getNextTargetDate(completionTime, fixedTimes, cooldownMinutes);
  if (!nextTargetTime) {
    throw new Error('Unable to calculate the next notification target');
  }

  const delaySeconds = Math.floor((nextTargetTime.getTime() - actualNow.getTime()) / 1000) - advanceSeconds;
  return {
    scheduledNotificationTime,
    completionTime,
    nextTargetTime,
    delaySeconds,
  };
}

export function isValidQueueDelaySeconds(delaySeconds) {
  return typeof delaySeconds === 'number' &&
    Number.isFinite(delaySeconds) &&
    delaySeconds >= 0 &&
    delaySeconds <= MAX_QUEUE_DELAY_SECONDS;
}
