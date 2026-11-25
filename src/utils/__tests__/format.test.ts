import { describeUserAgent, formatCount, initials, timeAgo } from '../format';

describe('formatCount', () => {
  it('abbreviates large numbers', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1250)).toBe('1.3K');
    expect(formatCount(1_500_000)).toBe('1.5M');
    expect(formatCount(2_000_000_000)).toBe('2B');
    expect(formatCount(null)).toBe('0');
  });
});

describe('initials', () => {
  it('takes up to two initials', () => {
    expect(initials('Alice Example')).toBe('AE');
    expect(initials('alice')).toBe('A');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('timeAgo', () => {
  it('handles recent and invalid values', () => {
    expect(timeAgo(new Date())).toBe('just now');
    expect(timeAgo('not-a-date')).toBe('');
    expect(timeAgo(null)).toBe('');
    expect(timeAgo(new Date(Date.now() - 3 * 60 * 60 * 1000))).toMatch(/3 hours ago/);
  });
});

describe('describeUserAgent', () => {
  it('describes common clients', () => {
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe('Chrome on macOS');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(describeUserAgent('okhttp/4.12.0')).toBe('Android app');
    expect(describeUserAgent(null)).toBe('Unknown device');
  });
});
