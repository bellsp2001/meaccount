import { ButtonHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}

const styles: Record<Variant, string> = {
  primary:   'bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-strong)] text-[var(--color-on-accent)] font-bold hover:opacity-90',
  secondary: 'bg-[var(--color-border)] border border-[var(--color-border-strong)] text-[var(--color-text)] hover:bg-[var(--color-bg-inset)]',
  ghost:     'bg-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)]',
  danger:    'bg-[#FF6B6B20] border border-[#FF6B6B40] text-[#FF6B6B] hover:bg-[#FF6B6B30]',
}
const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-lg',
  lg: 'px-6 py-3 text-base rounded-xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, fullWidth, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant], sizes[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {loading && <Dot />}
      {children}
    </button>
  )
)
Button.displayName = 'Button'

function Dot() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  )
}
