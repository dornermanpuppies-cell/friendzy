import { COUNTRIES, countryName, flagEmoji, getCountry, isValidCountryCode } from '../countries';

describe('countries', () => {
  it('has unique, uppercase two-letter codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(codes.length).toBeGreaterThan(190);
  });

  it('looks up countries case-insensitively', () => {
    expect(getCountry('pt')?.name).toBe('Portugal');
    expect(countryName('US')).toBe('United States');
    expect(countryName('zz')).toBe('');
    expect(isValidCountryCode('br')).toBe(true);
    expect(isValidCountryCode('xx')).toBe(false);
  });

  it('derives flag emoji from the code', () => {
    expect(flagEmoji('FR')).toBe('🇫🇷');
    expect(flagEmoji('jp')).toBe('🇯🇵');
    expect(flagEmoji(null)).toBe('🌍');
  });
});
