import { getLanguageLocale, t } from "../i18n";

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
const absoluteFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getPreferredLocale = (): string => {
  return getLanguageLocale();
};

const getRelativeFormatter = (locale: string): Intl.RelativeTimeFormat => {
  const key = locale.toLowerCase();
  const cached = rtfCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  rtfCache.set(key, formatter);
  return formatter;
};

const getAbsoluteFormatter = (locale: string): Intl.DateTimeFormat => {
  const key = locale.toLowerCase();
  const cached = absoluteFormatterCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  absoluteFormatterCache.set(key, formatter);
  return formatter;
};

const normalizeTimestamp = (timestamp: number): number => {
  if (!Number.isFinite(timestamp)) {
    return Date.now();
  }
  return timestamp;
};

export const formatMessageTimestamp = (
  timestamp: number,
  now: number = Date.now(),
  locale: string = getPreferredLocale()
): string => {
  const safeTs = normalizeTimestamp(timestamp);
  const safeNow = normalizeTimestamp(now);
  const diffMs = safeTs - safeNow;
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  // If a message timestamp appears in the future (clock skew), use Intl fallback.
  if (diffSeconds > 0) {
    const rtf = getRelativeFormatter(locale);

    if (absSeconds < 3600) {
      return rtf.format(Math.round(diffSeconds / 60), "minute");
    }

    if (absSeconds < 86400) {
      return rtf.format(Math.round(diffSeconds / 3600), "hour");
    }

    return rtf.format(Math.round(diffSeconds / 86400), "day");
  }

  const elapsedSeconds = Math.abs(diffSeconds);
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedSeconds < 30) {
    return t("justNow");
  }

  if (elapsedMinutes < 60) {
    if (elapsedMinutes <= 1) return t("minuteAgo");
    return t("minutesAgo", { n: elapsedMinutes });
  }

  if (elapsedHours < 24) {
    if (elapsedHours === 1) return t("hourAgo");
    return t("hoursAgo", { n: elapsedHours });
  }

  if (elapsedDays < 7) {
    if (elapsedDays === 1) return t("yesterday");
    return t("daysAgo", { n: elapsedDays });
  }

  return getAbsoluteFormatter(locale).format(new Date(safeTs));
};

export const formatAbsoluteTimestamp = (
  timestamp: number,
  locale: string = getPreferredLocale()
): string => {
  const safeTs = normalizeTimestamp(timestamp);
  return getAbsoluteFormatter(locale).format(new Date(safeTs));
};
