import { useState, type FormEvent } from 'react'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '../components/ui'
import { Field, FormMessage, formStyles } from '../components/forms'
import { adminApi } from '../lib/api'
import { useAuthStore } from '../store/auth'
import styles from '../styles/Auth.module.css'

export default function ActivatePage() {
  const [searchParams] = useSearchParams()
  const [token, setToken] = useState(searchParams.get('token') ?? '')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const setSession = useAuthStore((state) => state.setSession)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 12) {
      setError('管理密码至少需要 12 个字符。')
      return
    }
    if (password !== confirmation) {
      setError('两次输入的密码不一致。')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const session = await adminApi.auth.activate({
        token: token.trim(),
        displayName: displayName.trim(),
        password,
      })
      setSession(session)
      navigate('/', { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '激活失败，请重新打开邀请链接')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-label="账号激活说明">
        <div className={styles.brand}>
          <span className={styles.seal} aria-hidden="true">启</span>
          <span>
            <strong>管理席位激活</strong>
            <small>INVITED OPERATORS ONLY</small>
          </span>
        </div>
        <div className={styles.statement}>
          <p>Invitation verification</p>
          <h1>一人一席位，<em>一权一留痕。</em></h1>
          <p>激活后仅获得邀请时配置的角色权限。你的每次敏感操作都会进入不可删改的审计账簿。</p>
        </div>
        <p className={styles.footnote}>邀请令牌仅可使用一次 · 过期后请联系最高管理员重发</p>
      </section>
      <section className={styles.formSide} aria-label="激活管理账号">
        <div className={styles.ticket}>
          <header className={styles.ticketHeader}>
            <span className={styles.ticketNo}>SEAT ACTIVATION · ONE-TIME PASS</span>
            <h2>激活管理账号</h2>
            <p>核对邀请令牌并设置独立管理密码。</p>
          </header>
          <form className={styles.form} onSubmit={handleSubmit}>
            <Field label="邀请令牌" htmlFor="token" required hint="通常已由邮件链接自动填写。">
              <input
                className={formStyles.input}
                id="token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </Field>
            <Field label="管理席位姓名" htmlFor="displayName" required>
              <input
                className={formStyles.input}
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field label="新管理密码" htmlFor="newPassword" required hint="至少 12 个字符，且不要复用主站密码。">
              <input
                className={formStyles.input}
                id="newPassword"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            <Field label="确认管理密码" htmlFor="confirmation" required>
              <input
                className={formStyles.input}
                id="confirmation"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            <Button
              className={styles.submit}
              type="submit"
              icon={<BadgeCheck size={17} />}
              disabled={submitting}
            >
              {submitting ? '正在激活…' : '确认席位并进入'}
            </Button>
            <div className={styles.security}>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>系统不会通过此页面创建新席位；只有有效邀请才能完成激活。</span>
            </div>
            <p className={styles.meta}>
              已完成激活？ <Link to="/login">返回登录</Link>
            </p>
          </form>
        </div>
      </section>
    </main>
  )
}
