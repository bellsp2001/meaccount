import { isValidEmail, isValidThaiTaxId, checkPasswordStrength, sanitizeAmount } from '../src/utils/validation';

describe('isValidEmail', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('accepts emails with subdomains and plus-addressing', () => {
    expect(isValidEmail('user+tag@mail.example.co.th')).toBe(true);
  });

  it('rejects missing @ symbol', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects missing domain extension', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('rejects consecutive dots', () => {
    expect(isValidEmail('user..name@example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects leading dot in local part', () => {
    expect(isValidEmail('.user@example.com')).toBe(false);
  });
});

describe('isValidThaiTaxId', () => {
  it('accepts exactly 13 digits', () => {
    expect(isValidThaiTaxId('0105555000001')).toBe(true);
  });

  it('accepts 13 digits with dashes stripped', () => {
    expect(isValidThaiTaxId('0-1055-55000-00-1')).toBe(true);
  });

  it('rejects fewer than 13 digits', () => {
    expect(isValidThaiTaxId('12345')).toBe(false);
  });

  it('rejects more than 13 digits', () => {
    expect(isValidThaiTaxId('01055550000012')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidThaiTaxId('')).toBe(false);
  });
});

describe('checkPasswordStrength', () => {
  it('flags a short password as invalid', () => {
    const result = checkPasswordStrength('abc');
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('accepts a password meeting the minimum length', () => {
    const result = checkPasswordStrength('longenough');
    expect(result.valid).toBe(true);
  });

  it('gives a higher score to a password with mixed case, digits, and symbols', () => {
    const weak = checkPasswordStrength('password');
    const strong = checkPasswordStrength('Str0ng!Pass');
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('caps score at 4 for maximally complex passwords', () => {
    const result = checkPasswordStrength('VeryStr0ng!Password123');
    expect(result.score).toBe(4);
  });

  it('lists specific missing requirements', () => {
    const result = checkPasswordStrength('alllowercase');
    expect(result.issues).toContain('ควรมีตัวพิมพ์ใหญ่');
    expect(result.issues).toContain('ควรมีตัวเลข');
  });
});

describe('sanitizeAmount', () => {
  it('parses a plain number string', () => {
    expect(sanitizeAmount('1500')).toBe(1500);
  });

  it('strips thousand separators', () => {
    expect(sanitizeAmount('1,500,000')).toBe(1500000);
  });

  it('strips currency symbol and spaces', () => {
    expect(sanitizeAmount('฿ 2,500.50')).toBe(2500.5);
  });

  it('returns null for empty input', () => {
    expect(sanitizeAmount('')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(sanitizeAmount('abc')).toBeNull();
  });

  it('returns null for negative amounts', () => {
    expect(sanitizeAmount('-500')).toBeNull();
  });

  it('accepts zero', () => {
    expect(sanitizeAmount('0')).toBe(0);
  });
});
