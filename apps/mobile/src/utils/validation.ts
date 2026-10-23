/**
 * Form validation helpers — pure functions, unit tested directly.
 */

export function isValidEmail(email: string): boolean {
  // Deliberately conservative: local@domain.tld, no consecutive dots, no leading/trailing dot
  const re = /^[a-zA-Z0-9]([a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;
  if (!re.test(email)) return false;
  if (email.includes('..')) return false;
  return true;
}

export function isValidThaiTaxId(taxId: string): boolean {
  const digits = taxId.replace(/[^0-9]/g, '');
  return digits.length === 13;
}

export interface PasswordStrength {
  valid: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  issues: string[];
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const issues: string[] = [];
  if (password.length < 8) issues.push('ต้องมีอย่างน้อย 8 ตัวอักษร');
  if (!/[A-Z]/.test(password)) issues.push('ควรมีตัวพิมพ์ใหญ่');
  if (!/[0-9]/.test(password)) issues.push('ควรมีตัวเลข');

  let score: PasswordStrength['score'] = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return { valid: password.length >= 8, score: score as PasswordStrength['score'], issues };
}

export function sanitizeAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s฿]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  if (Number.isNaN(value) || value < 0) return null;
  return value;
}
