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
    <div style={{ minHeight: '100vh', display: 'flex', background: '#07090E' }}>
      {/* Left panel — Branding */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px', background: 'linear-gradient(160deg,#0C1422 0%,#07090E 100%)', borderRight: '1px solid #151C28' }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 48 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 26, color: '#07090E', boxShadow: '0 0 32px #00D4AA44' }}>M</div>
            <div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Me<span style={{ color: '#00D4AA' }}>Account</span></p>
              <p style={{ margin: 0, fontSize: 10, color: '#2A3A50', textTransform: 'uppercase', letterSpacing: '0.15em' }}>AI-Powered Platform</p>
            </div>
          </div>

          <h2 style={{ margin: '0 0 16px', fontSize: 28, fontWeight: 800, lineHeight: 1.3 }}>
            โปรแกรมบัญชี<br />
            <span style={{ color: '#00D4AA' }}>อัจฉริยะ</span> สำหรับธุรกิจไทย
          </h2>
          <p style={{ margin: '0 0 40px', fontSize: 14, color: '#4A5A70', lineHeight: 1.7 }}>
            จัดการบัญชี ภาษี และการเงินครบวงจร ด้วย AI ที่เข้าใจกฎหมายไทย
          </p>

          {[
            { icon: '🧠', text: 'AI ตรวจสอบบัญชีและภาษีอัตโนมัติ' },
            { icon: '📄', text: 'OCR อ่านใบเสร็จและ Invoice' },
            { icon: '📊', text: 'วิเคราะห์การเงินแบบ Real-time' },
          ].map(f => (
            <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 18 }}>{f.icon}</span>
              <span style={{ fontSize: 13, color: '#6A7A90' }}>{f.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — Form */}
      <div style={{ width: 480, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 48px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>เข้าสู่ระบบ</h2>
        <p style={{ margin: '0 0 32px', fontSize: 13, color: '#4A5A70' }}>กรอกอีเมลและรหัสผ่านของคุณ</p>

        <form onSubmit={handleSubmit(d => login.mutate(d))} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Email */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>อีเมล</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#3A4A60' }}>✉</span>
              <input {...register('email')} type="email" placeholder="admin@company.com"
                style={{ width: '100%', background: '#0A0E18', border: `1px solid ${errors.email ? '#FF6B6B' : '#151C28'}`, borderRadius: 9, padding: '11px 14px 11px 38px', fontSize: 13, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {errors.email && <p style={{ margin: '5px 0 0', fontSize: 11, color: '#FF6B6B' }}>{errors.email.message}</p>}
          </div>

          {/* Password */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6A7A90', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>รหัสผ่าน</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#3A4A60' }}>🔒</span>
              <input {...register('password')} type={showPass ? 'text' : 'password'} placeholder="••••••••"
                style={{ width: '100%', background: '#0A0E18', border: `1px solid ${errors.password ? '#FF6B6B' : '#151C28'}`, borderRadius: 9, padding: '11px 42px 11px 38px', fontSize: 13, color: '#DDE3EE', outline: 'none', boxSizing: 'border-box' }} />
              <button type="button" onClick={() => setShowPass(p => !p)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#3A4A60', cursor: 'pointer', fontSize: 13 }}>
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
            style={{ background: 'linear-gradient(135deg,#00D4AA,#4FACFE)', color: '#07090E', fontWeight: 800, fontSize: 14, border: 'none', borderRadius: 10, padding: '13px', cursor: login.isPending ? 'not-allowed' : 'pointer', opacity: login.isPending ? 0.7 : 1, width: '100%', marginTop: 4 }}>
            {login.isPending ? '⏳ กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ →'}
          </button>
        </form>

        {/* Demo hint */}
        <div style={{ marginTop: 28, background: '#00D4AA08', border: '1px solid #00D4AA20', borderRadius: 10, padding: '14px 16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#00D4AA' }}>🔑 Demo Credentials</p>
          {[
            ['Admin', 'admin@meaccount.com', 'Admin@1234'],
            ['Accountant', 'accountant@meaccount.com', 'Test@1234'],
          ].map(([role, email, pass]) => (
            <div key={role} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#4A5A70', marginBottom: 3 }}>
              <span style={{ color: '#00D4AA', minWidth: 75 }}>{role}:</span>
              <span>{email}</span>
              <span style={{ color: '#2A3A50' }}>/ {pass}</span>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 32, fontSize: 11, color: '#2A3A50', textAlign: 'center' }}>
          MeAccount v0.1.0 · Phase 1 · W3–4
        </p>
      </div>
    </div>
  )
}
