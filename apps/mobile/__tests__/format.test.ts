import {
  formatCurrency, formatThaiDate, formatRelativeTime,
  truncate, getInitials, riskLevelColor, formatCount,
} from '../src/utils/format';

describe('formatCurrency', () => {
  it('formats a normal amount with 2 decimals and Thai grouping', () => {
    expect(formatCurrency(1234.5)).toBe('฿1,234.50');
  });

  it('formats zero correctly', () => {
    expect(formatCurrency(0)).toBe('฿0.00');
  });

  it('returns a placeholder for NaN', () => {
    expect(formatCurrency(NaN)).toBe('฿0.00');
  });

  it('compacts millions with the M suffix', () => {
    expect(formatCurrency(2_500_000, { compact: true })).toBe('฿2.5M');
  });

  it('compacts thousands with the K suffix', () => {
    expect(formatCurrency(45_000, { compact: true })).toBe('฿45.0K');
  });

  it('does not compact small amounts even when compact=true', () => {
    expect(formatCurrency(500, { compact: true })).toBe('฿500.00');
  });

  it('handles negative amounts', () => {
    expect(formatCurrency(-1000)).toBe('฿-1,000.00');
  });
});

describe('formatThaiDate', () => {
  it('formats an ISO date string', () => {
    const result = formatThaiDate('2025-03-15');
    expect(result).toContain('2568'); // Buddhist year
  });

  it('returns a placeholder for invalid dates', () => {
    expect(formatThaiDate('not-a-date')).toBe('—');
  });

  it('accepts a Date object directly', () => {
    const result = formatThaiDate(new Date(2025, 2, 15));
    expect(result).toContain('2568');
  });
});

describe('formatRelativeTime', () => {
  it('returns "เมื่อสักครู่" for very recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('เมื่อสักครู่');
  });

  it('returns minutes for timestamps within the last hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5 นาทีที่แล้ว');
  });

  it('returns hours for timestamps within the last day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3 ชั่วโมงที่แล้ว');
  });

  it('falls back to a full date for old timestamps', () => {
    const longAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const result = formatRelativeTime(longAgo);
    expect(result).not.toContain('ที่แล้ว');
  });

  it('returns a placeholder for invalid input', () => {
    expect(formatRelativeTime('garbage')).toBe('—');
  });
});

describe('truncate', () => {
  it('leaves short strings unchanged', () => {
    expect(truncate('สั้น', 10)).toBe('สั้น');
  });

  it('truncates long strings with an ellipsis', () => {
    const result = truncate('This is a fairly long sentence', 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles exact-length strings without truncating', () => {
    expect(truncate('exact', 5)).toBe('exact');
  });
});

describe('getInitials', () => {
  it('returns two-letter initials for a two-word name', () => {
    expect(getInitials('สมชาย ใจดี')).toBe('สใ');
  });

  it('returns first two chars for a single-word name', () => {
    expect(getInitials('Somchai')).toBe('SO');
  });

  it('handles empty input gracefully', () => {
    expect(getInitials('')).toBe('?');
  });

  it('handles names with extra whitespace', () => {
    expect(getInitials('  John   Doe  ')).toBe('JD');
  });
});

describe('riskLevelColor', () => {
  it('maps known risk levels to distinct colors', () => {
    expect(riskLevelColor('critical')).toBe('#FF3B3B');
    expect(riskLevelColor('high')).toBe('#FF6B6B');
    expect(riskLevelColor('medium')).toBe('#F5A623');
    expect(riskLevelColor('low')).toBe('#4FACFE');
  });

  it('falls back to a neutral color for unknown levels', () => {
    expect(riskLevelColor('unknown')).toBe('#8A9BB0');
  });
});

describe('formatCount', () => {
  it('joins a Thai-formatted number with its classifier', () => {
    expect(formatCount(1234, 'รายการ')).toBe('1,234 รายการ');
  });

  it('handles zero', () => {
    expect(formatCount(0, 'คน')).toBe('0 คน');
  });
});
