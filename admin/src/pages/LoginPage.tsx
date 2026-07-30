import { useState, type FormEvent } from 'react'
import { KeyRound, LockKeyhole } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
import { adminApi } from '../lib/api'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui'
import { Field, FormMessage, formStyles } from '../components/forms'
import styles from '../styles/Auth.module.css'

interface LoginLocationState {
  from?: string
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const setSession = useAuthStore((state) => state.setSession)
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const session = await adminApi.auth.login({ email: email.trim(), password })
      setSession(session)
      const state = location.state as LoginLocationState | null
      navigate(state?.from ?? '/', { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '登录失败，请核对凭据')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-label="管理后台介绍">
        <div className={styles.brand}>
          <span className={styles.seal} aria-hidden="true">务</span>
          <span>
            <strong>学籍总务处</strong>
            <small>XIAOBAI COMMERCIAL LEDGER</small>
          </span>
        </div>
        <div className={styles.statement}>
          <p>Independent administration</p>
          <h1>把每一次商业变更，<em>留在账上。</em></h1>
          <p>订阅、权益、积分与团队权限在这里独立治理。所有关键操作均记录操作者与理由。</p>
        </div>
        <p className={styles.footnote}>仅供受邀管理成员使用 · 与主站用户账号完全分离</p>
      </section>
      <section className={styles.formSide} aria-label="管理员登录">
        <div className={styles.ticket}>
          <header className={styles.ticketHeader}>
            <span className={styles.ticketNo}>ADMIN ACCESS · SESSION 01</span>
            <h2>管理成员登录</h2>
            <p>使用已激活的独立管理账号进入。</p>
          </header>
          <form className={styles.form} onSubmit={handleSubmit}>
            <Field label="管理邮箱" htmlFor="email" required>
              <input
                className={formStyles.input}
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <Field label="独立管理密码" htmlFor="password" required>
              <input
                className={formStyles.input}
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            <Button
              className={styles.submit}
              type="submit"
              icon={<KeyRound size={17} />}
              disabled={submitting}
            >
              {submitting ? '正在验证…' : '验证并进入总务处'}
            </Button>
            <div className={styles.security}>
              <LockKeyhole size={18} aria-hidden="true" />
              <span>管理账号不能自行注册，只能通过最高管理员发出的邮箱邀请激活。</span>
            </div>
            <p className={styles.meta}>
              收到首次邀请？ <Link to="/activate">激活管理账号</Link>
            </p>
          </form>
        </div>
      </section>
    </main>
  )
}
