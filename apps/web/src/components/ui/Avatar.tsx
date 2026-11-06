export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.38 }} className="rounded-full bg-gradient-to-br from-[var(--color-accent-light)] to-[var(--color-accent-strong)] flex items-center justify-center text-[var(--color-on-accent)] font-bold flex-shrink-0">
      {initials}
    </div>
  )
}
