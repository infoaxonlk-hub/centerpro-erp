const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const colomboFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function calendarParts(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

export function isCalendarDate(value) {
  return calendarParts(value) !== null;
}

function colomboParts(instant) {
  const parts = Object.fromEntries(colomboFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function utcMilliseconds(year, month, day, hour, minute, second, millisecond = 0) {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(hour, minute, second, millisecond);
  return result.getTime();
}

export function colomboDateTimeToISOString(value) {
  const match = LOCAL_DATETIME_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fractionText = ""] = match;
  const date = `${yearText}-${monthText}-${dayText}`;
  const dateParts = calendarParts(date);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fractionText.padEnd(3, "0"));
  if (!dateParts || hour > 23 || minute > 59 || second > 59) return null;

  const requestedWallTime = utcMilliseconds(dateParts.year, dateParts.month, dateParts.day, hour, minute, second, millisecond);
  let instant = requestedWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = colomboParts(instant);
    const representedWallTime = utcMilliseconds(local.year, local.month, local.day, local.hour, local.minute, local.second, millisecond);
    const difference = requestedWallTime - representedWallTime;
    if (difference === 0) break;
    instant += difference;
  }

  const resolved = colomboParts(instant);
  if (resolved.year !== dateParts.year || resolved.month !== dateParts.month || resolved.day !== dateParts.day || resolved.hour !== hour || resolved.minute !== minute || resolved.second !== second) return null;
  return new Date(instant).toISOString();
}
