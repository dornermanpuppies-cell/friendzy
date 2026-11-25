import { formatDistanceToNowStrict, isToday, isYesterday, format } from 'date-fns';

/** 1234 → "1.2K", 1_500_000 → "1.5M" */
export function formatCount(value: number | null | undefined): string {
  const n = value ?? 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trimZero((n / 1000).toFixed(1))}K`;
  if (n < 1_000_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  return `${trimZero((n / 1_000_000_000).toFixed(1))}B`;
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function lastSeenLabel(value: string | Date | null | undefined, isOnline?: boolean | null): string {
  if (isOnline) return 'Online now';
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  if (isToday(date)) return `Last seen today at ${format(date, 'HH:mm')}`;
  if (isYesterday(date)) return `Last seen yesterday at ${format(date, 'HH:mm')}`;
  return `Last seen ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function formatDate(value: string | Date | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return format(date, pattern);
}

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  if (/friendzy/i.test(ua) && /android/i.test(ua)) return 'Friendzy for Android';
  if (/friendzy/i.test(ua) && /(iphone|ipad|ios)/i.test(ua)) return 'Friendzy for iOS';
  if (/okhttp|android/i.test(ua) && !/mozilla/i.test(ua)) return 'Android app';
  if (/cfnetwork|darwin/i.test(ua)) return 'iOS app';
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\//i.test(ua)
      ? 'Opera'
      : /chrome\//i.test(ua)
        ? 'Chrome'
        : /safari\//i.test(ua) && !/chrome/i.test(ua)
          ? 'Safari'
          : /firefox\//i.test(ua)
            ? 'Firefox'
            : 'Browser';
  // iPhone/iPad user agents also contain "like Mac OS X", so check them first.
  const os = /(iphone|ipad|ipod)/i.test(ua)
    ? 'iOS'
    : /android/i.test(ua)
      ? 'Android'
      : /windows/i.test(ua)
        ? 'Windows'
        : /mac os x/i.test(ua)
          ? 'macOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
