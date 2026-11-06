import { InputHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          className={clsx(
            'w-full bg-[var(--color-bg-inset)] border rounded-lg px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-dim)] outline-none transition-colors duration-150',
            leftIcon && 'pl-10',
            error
              ? 'border-[#FF6B6B] focus:border-[#FF6B6B]'
              : 'border-[var(--color-border)] focus:border-[var(--color-accent)]',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-[#FF6B6B]">{error}</p>}
      {hint && !error && <p className="text-xs text-[var(--color-dim)]">{hint}</p>}
    </div>
  )
)
Input.displayName = 'Input'
