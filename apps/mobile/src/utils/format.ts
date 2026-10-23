/**
 * Formatting utilities used across the app. Pure functions — no React, no native
 * modules — so they can be unit tested directly under plain Jest.
 */

export function formatCurrency(amount: number, options?: { compact?: boolean }): string {
  if (Number.isNaN(amount)) return '฿0.00';

  if (options?.compact && Math.abs(amount) >= 1_000_000) {
    return `฿${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (options?.compact && Math.abs(amount) >= 1_000) {
    return `฿${(amount / 1_000).toFixed(1)}K`;
  }

  return `฿${amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatThaiDate(isoDate: string | Date): string {
  const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'เมื่อสักครู่';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} นาทีที่แล้ว`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ชั่วโมงที่แล้ว`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} วันที่แล้ว`;
  return formatThaiDate(isoDate);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function riskLevelColor(level: string): string {
  switch (level) {
    case 'critical': return '#FF3B3B';
    case 'high': return '#FF6B6B';
    case 'medium': return '#F5A623';
    case 'low': return '#4FACFE';
    default: return '#8A9BB0';
  }
}

/**
 * Pluralization helper for Thai counters — Thai doesn't inflect nouns for
 * number, but the classifier word after the number does change per item type.
 * Returns "{count} {classifier}" e.g. formatCount(3, 'รายการ') -> "3 รายการ"
 */
export function formatCount(count: number, classifier: string): string {
  return `${count.toLocaleString('th-TH')} ${classifier}`;
}
