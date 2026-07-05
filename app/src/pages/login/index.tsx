/**
 * 登入书斋 /login —— 预置账号登录,暂不开放注册。
 * 未登录仅可查看(书斋/成长册/看板);登录后才能备课与开讲。
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import s from './login.module.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useAuthStore((st) => st.status);
  const login = useAuthStore((st) => st.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 只接受站内单层路径,杜绝畸形跳转;HashRouter 下绝对 URL 也只会落进 hash,双保险
  const rawNext = params.get('next') || '/';
  const next = /^\/(?!\/)[\w\-/]*$/.test(rawNext) ? rawNext : '/';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    const err = await login(username.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else navigate(next, { replace: true });
  };

  if (status === 'standalone') {
    return (
      <div className={s.page}>
        <section className={s.card}>
          <h1 className={s.title}>本地演示模式</h1>
          <p className={s.note}>当前没有连接服务器网关,无需登录,全部功能直接可用。</p>
          <Link className={s.submitLink} to="/">回书斋 →</Link>
        </section>
      </div>
    );
  }

  if (status === 'authed') {
    return (
      <div className={s.page}>
        <section className={s.card}>
          <h1 className={s.title}>已登入</h1>
          <p className={s.note}>你已经登录,可以直接开讲了。</p>
          <Link className={s.submitLink} to={next}>继续 →</Link>
        </section>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <section className={s.card} aria-label="登录">
        <p className={s.seal} aria-hidden="true">小白</p>
        <h1 className={s.title}>登入书斋</h1>
        <p className={s.sub}>教然后知困 · 登录后才能给小白开讲</p>

        <form className={s.form} onSubmit={onSubmit}>
          <label className={s.field}>
            <span className={s.label}>账号</span>
            <input
              className={s.input}
              type="text"
              value={username}
              autoComplete="username"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>密码</span>
            <input
              className={s.input}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className={s.error} role="alert">{error}</p>}
          <button className={s.submit} type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? '正在登入…' : '登入'}
          </button>
        </form>

        <p className={s.note}>
          暂未开放注册,账号由管理员发放。<br />
          未登录也可以浏览书斋、成长册与教师看板。
        </p>
        <Link className={s.backLink} to="/">← 先随便看看</Link>
      </section>
    </div>
  );
}
