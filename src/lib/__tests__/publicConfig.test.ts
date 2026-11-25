import { normalizePublicUrl, stripWrappingQuotes } from '../publicConfig';

describe('stripWrappingQuotes', () => {
  it('removes wrapping quotes and whitespace but keeps inner content', () => {
    expect(stripWrappingQuotes(' "https://acme.supabase.co" ')).toBe('https://acme.supabase.co');
    expect(stripWrappingQuotes("'eyJ.abc.def'")).toBe('eyJ.abc.def');
    expect(stripWrappingQuotes('`wss://x.livekit.cloud`')).toBe('wss://x.livekit.cloud');
    expect(stripWrappingQuotes('"\'double\'"')).toBe('double');
    expect(stripWrappingQuotes('plain')).toBe('plain');
    expect(stripWrappingQuotes(undefined)).toBe('');
  });

  it('leaves unbalanced or inner quotes alone', () => {
    expect(stripWrappingQuotes('"half')).toBe('"half');
    expect(stripWrappingQuotes('a"b')).toBe('a"b');
  });
});

describe('normalizePublicUrl', () => {
  it('adds the scheme to a bare host and removes a trailing slash', () => {
    expect(normalizePublicUrl('gwdpsrjmfrgcloacvdlg.supabase.co', 'https')).toBe('https://gwdpsrjmfrgcloacvdlg.supabase.co');
    expect(normalizePublicUrl('friendzy-9kc7beej.livekit.cloud/', 'wss')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
    expect(normalizePublicUrl('"https://gwdpsrjmfrgcloacvdlg.supabase.co/"', 'https')).toBe('https://gwdpsrjmfrgcloacvdlg.supabase.co');
  });

  it('keeps an existing scheme, even a wrong one, for the validator to report', () => {
    expect(normalizePublicUrl('http://localhost:54321', 'https')).toBe('http://localhost:54321');
    expect(normalizePublicUrl('ws://localhost:7880', 'wss')).toBe('ws://localhost:7880');
  });

  it('does not touch values that are not hosts', () => {
    expect(normalizePublicUrl('****', 'https')).toBe('****');
    expect(normalizePublicUrl('<project-ref>.supabase.co', 'https')).toBe('<project-ref>.supabase.co');
    expect(normalizePublicUrl('', 'https')).toBe('');
    expect(normalizePublicUrl(null, 'wss')).toBe('');
  });
});
