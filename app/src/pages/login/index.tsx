/**
 * 登入书斋 /login —— 预置账号登录,暂不开放注册。
 * 未登录仅可查看(书斋/成长册/看板);登录后才能备课与开讲。
 * 构图:左侧扉页(印 + 竖排铭 + 门规),右侧表单;非对称,不是居中卡片。
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Seal } from '../../components/shell/Seal';
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
  const rawNext = params.get('next') || '/study';
  const next = /^\/(?!\/)[\w\-/]*$/.test(rawNext) ? rawNext : '/study';

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

  // /api/me 探测瞬间不渲染,免得完整表单闪一下再换提示卡(与 RequireAuth 同策)
  if (status === 'unknown') return null;

  if (status === 'standalone' || status === 'authed') {
    const standalone = status === 'standalone';
    return (
      <div className={s.page}>
        <section className={s.notice}>
          <Seal className={s.noticeSeal} />
          <h1 className={s.noticeTitle}>{standalone ? '本地演示模式' : '已在书斋中'}</h1>
          <p className={s.noticeText}>
            {standalone
              ? '当前未连接服务器,无需登录,全部功能直接可用。'
              : '你已登录,可以直接给小白开讲了。'}
          </p>
          <Link className={s.noticeLink} to={standalone ? '/study' : next}>
            {standalone ? '回书斋' : '继续'} →
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.split}>
        {/* 扉页:朱印 + 竖排铭 + 门规 */}
        <aside className={s.plate}>
          <Seal className={s.plateSeal} />
          <p className={s.plateMotto} lang="zh">教<br />然<br />后<br />知<br />困</p>
          <p className={s.plateGloss}>
            把知识讲给会追问的<br />AI 学生「小白」听
          </p>
        </aside>

        {/* 表单 */}
        <section className={s.form} aria-label="登录">
          <p className={s.eyebrow}>凭帖入斋</p>
          <h1 className={s.title}>登入书斋</h1>
          <p className={s.sub}>登录后方可备课、开讲;未登录也能浏览书斋与看板。</p>

          <form className={s.fields} onSubmit={onSubmit}>
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

            <div className={s.errorSlot} aria-live="polite">
              {error && <p className={s.error} role="alert">{error}</p>}
            </div>

            <button
              className={s.submit}
              type="submit"
              data-busy={busy || undefined}
              disabled={busy || !username.trim() || !password}
            >
              {busy ? '正在验帖…' : '登 入'}
            </button>
          </form>

          <footer className={s.foot}>
            <span>暂未开放注册,账号由管理员发放</span>
            <Link className={s.backLink} to="/study">← 先随便看看</Link>
          </footer>
        </section>
      </div>
    </div>
  );
}
