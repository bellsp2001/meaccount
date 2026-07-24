export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.38 }} className="rounded-full bg-gradient-to-br from-[#00D4AA] to-[#4FACFE] flex items-center justify-center text-[#07090E] font-bold flex-shrink-0">
      {initials}
    </div>
  )
}
