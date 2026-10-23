import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { useLogin } from '@/hooks/useAuth'

const schema = z.object({
  email: z.string().email('อีเมลไม่ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})
type F = z.infer<typeof schema>

export default function LoginPage() {
  const login = useLogin()
  const [showPass, setShowPass] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema) })

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'transparent' }}>
      {/* Left panel — Branding */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px', background: 'transparent' }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 48 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,var(--color-accent-light),var(--color-accent-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--color-on-accent)', boxShadow: '0 0 32px color-mix(in srgb, var(--color-accent) 27%, transparent)' }}>M</div>
            <div>
              <p style={{ margin: 0, fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Me<span style={{ color: 'var(--color-accent)' }}>Account</span></p>
              <p style={{ margin: 0, fontSize: 10, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>AI-Powered Platform</p>
            </div>
          </div>

          <h2 style={{ margin: '0 0 16px', fontSize: 28, fontWeight: 700, lineHeight: 1.35 }}>
            โปรแกรมบัญชี<br />
            <span style={{ color: 'var(--color-accent)' }}>อัจฉริยะ</span> สำหรับธุรกิจไทย
          </h2>
          <div style={{ width: 56, height: 2, background: 'linear-gradient(90deg,var(--color-accent),transparent)', margin: '0 0 24px' }} />
          <p style={{ margin: '0 0 40px', fontSize: 14, color: 'var(--color-muted)', lineHeight: 1.7 }}>
            จัดการบัญชี ภาษี และการเงินครบวงจร ด้วย AI ที่เข้าใจกฎหมายไทย
          </p>

          {[
            { icon: '🧠', text: 'AI ตรวจสอบบัญชีและภาษีอัตโนมัติ' },
            { icon: '📄', text: 'OCR อ่านใบเสร็จและ Invoice' },
            { icon: '📊', text: 'วิเคราะห์การเงินแบบ Real-time' },
          ].map(f => (
            <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 18 }}>{f.icon}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>{f.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — Form */}
      <div className="glass" style={{ width: 480, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 48px', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-pop)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>เข้าสู่ระบบ</h2>
        <p style={{ margin: '0 0 32px', fontSize: 13, color: 'var(--color-muted)' }}>กรอกอีเมลและรหัสผ่านของคุณ</p>

        <form onSubmit={handleSubmit(d => login.mutate(d))} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Email */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>อีเมล</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-dim)' }}>✉</span>
              <input {...register('email')} type="email" placeholder="admin@company.com"
                style={{ width: '100%', background: 'var(--color-bg-inset)', border: `1px solid ${errors.email ? '#FF6B6B' : 'var(--color-border)'}`, borderRadius: 9, padding: '11px 14px 11px 38px', fontSize: 13, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {errors.email && <p style={{ margin: '5px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.email.message}</p>}
          </div>

          {/* Password */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>รหัสผ่าน</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-dim)' }}>🔒</span>
              <input {...register('password')} type={showPass ? 'text' : 'password'} placeholder="••••••••"
                style={{ width: '100%', background: 'var(--color-bg-inset)', border: `1px solid ${errors.password ? '#FF6B6B' : 'var(--color-border)'}`, borderRadius: 9, padding: '11px 42px 11px 38px', fontSize: 13, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }} />
              <button type="button" onClick={() => setShowPass(p => !p)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-dim)', cursor: 'pointer', fontSize: 13 }}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>
            {errors.password && <p style={{ margin: '5px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.password.message}</p>}
          </div>

          {/* Error */}
          {login.isError && (
            <div style={{ background: '#FF6B6B12', border: '1px solid #FF6B6B35', borderRadius: 9, padding: '10px 14px' }}>
              <p style={{ margin: 0, fontSize: 12, color: '#FF6B6B' }}>⚠ อีเมลหรือรหัสผ่านไม่ถูกต้อง</p>
            </div>
          )}

          <button type="submit" disabled={login.isPending}
            style={{ background: 'linear-gradient(135deg,var(--color-accent-light),var(--color-accent-strong))', color: 'var(--color-on-accent)', fontWeight: 800, fontSize: 14, border: 'none', borderRadius: 10, padding: '13px', cursor: login.isPending ? 'not-allowed' : 'pointer', opacity: login.isPending ? 0.7 : 1, width: '100%', marginTop: 4 }}>
            {login.isPending ? '⏳ กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ →'}
          </button>
        </form>

        {/* Demo hint */}
        <div style={{ marginTop: 28, background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 13%, transparent)', borderRadius: 10, padding: '14px 16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#F2714E' }}>🔑 Demo Credentials</p>
          {[
            ['Admin', 'admin@meaccount.com', 'Admin@1234'],
            ['Accountant', 'accountant@meaccount.com', 'Test@1234'],
          ].map(([role, email, pass]) => (
            <div key={role} style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--color-muted)', marginBottom: 3 }}>
              <span style={{ color: 'var(--color-accent)', minWidth: 75 }}>{role}:</span>
              <span>{email}</span>
              <span style={{ color: 'var(--color-dim)' }}>/ {pass}</span>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 32, fontSize: 11, color: 'var(--color-dim)', textAlign: 'center' }}>
          MeAccount v0.1.0 · Phase 1 · W3–4
        </p>
      </div>
    </div>
  )
}
