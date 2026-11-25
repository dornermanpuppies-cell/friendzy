import {
  birthDateError,
  calculateAge,
  normalizeUsername,
  parseIsoDate,
  passwordStrength,
  signUpSchema,
  USERNAME_REGEX,
  usernameError,
  zodFieldErrors,
} from '../validation';

describe('username rules', () => {
  it.each(['alice', 'alice_01', 'a.b.c', 'friend_zy', 'abc'])('accepts %s', (u) => {
    expect(USERNAME_REGEX.test(u)).toBe(true);
    expect(usernameError(u)).toBeNull();
  });

  it.each(['ab', '.alice', 'alice.', 'ali..ce', 'al ice', 'a'.repeat(31), 'alice!'])('rejects %s', (u) => {
    expect(usernameError(u)).not.toBeNull();
  });

  it('accepts mixed case by normalising to lowercase', () => {
    expect(usernameError('Alice')).toBeNull();
    expect(normalizeUsername('Alice')).toBe('alice');
  });

  it('rejects reserved names', () => {
    expect(usernameError('admin')).toMatch(/reserved/);
    expect(usernameError('friendzy')).toMatch(/reserved/);
  });

  it('normalises input', () => {
    expect(normalizeUsername('  @Alice_01 ')).toBe('alice_01');
  });
});

describe('date of birth', () => {
  const today = new Date(2026, 10, 25); // 25 Nov 2026

  it('parses ISO dates without timezone shift', () => {
    const d = parseIsoDate('2004-02-29');
    expect(d?.getFullYear()).toBe(2004);
    expect(d?.getMonth()).toBe(1);
    expect(d?.getDate()).toBe(29);
    expect(parseIsoDate('2005-02-29')).toBeNull();
    expect(parseIsoDate('nope')).toBeNull();
  });

  it('calculates age with birthday not yet reached', () => {
    expect(calculateAge(new Date(2010, 11, 1), today)).toBe(15);
    expect(calculateAge(new Date(2010, 10, 25), today)).toBe(16);
  });

  it('enforces the minimum sign-up age (16)', () => {
    expect(birthDateError('2010-11-26', today)).toMatch(/at least 16/);
    expect(birthDateError('2010-11-25', today)).toBeNull();
    expect(birthDateError('1800-01-01', today)).toMatch(/valid date/);
    expect(birthDateError('2026-13-01', today)).toMatch(/YYYY-MM-DD/);
  });
});

describe('password strength', () => {
  it('scores passwords', () => {
    expect(passwordStrength('short').score).toBe(0);
    expect(passwordStrength('password1').score).toBeGreaterThanOrEqual(2);
    expect(passwordStrength('Str0ng!Passphrase').score).toBe(4);
  });
});

describe('signUpSchema', () => {
  const valid = {
    displayName: 'Alice Example',
    username: 'Alice.Example',
    email: 'Alice@Example.com ',
    password: 'friendzy2026',
    birthDate: '2000-05-05',
    countryCode: 'pt',
    acceptTerms: true as const,
  };

  it('accepts and normalises valid input', () => {
    const result = signUpSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('alice.example');
      expect(result.data.email).toBe('alice@example.com');
      expect(result.data.countryCode).toBe('PT');
    }
  });

  it('requires terms, letters+numbers in password and a real country', () => {
    const result = signUpSchema.safeParse({ ...valid, acceptTerms: false, password: 'onlyletters', countryCode: 'ZZ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = zodFieldErrors(result.error);
      expect(errors.acceptTerms).toBeTruthy();
      expect(errors.password).toMatch(/letter and one number/);
      expect(errors.countryCode).toMatch(/country/i);
    }
  });
});
