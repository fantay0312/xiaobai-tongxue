import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Seal } from '../../components/shell/Seal';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { XiaobaiMood } from '../../types';
import { Icon } from '../../components/ui/Icon';
import { useAuthStore, type AuthField } from '../../store/authStore';
import { useDocTitle } from '../../hooks/useDocTitle';
import { CODE_RE, EMAIL_RE, NAME_RE, useCooldown, type Issue } from '../../hooks/useAuthForm';
import { EmailCodeField } from './EmailCodeField';
import { PasswordResetForm } from './PasswordResetForm';
import fs from './EmailCodeField.module.css';
import s from './login.module.css';

type Mode = 'login' | 'register' | 'reset';
type LoginMethod = 'password' | 'email-code';

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

function safeNextPath(value: string): string {
  return value.startsWith('/') && !value.startsWith('//')
    && !value.includes('\\') && !containsControlCharacter(value) ? value : '/study';
}

function AuthNotice({ title, text, role, children }: {
  title: string; text: string; role?: 'status' | 'alert'; children?: ReactNode;
}) {
  return (
    <div className={s.page}>
      <section className={s.notice} role={role} aria-live={role === 'status' ? 'polite' : undefined}>
        <Seal className={s.noticeSeal} />
        <h1 className={s.noticeTitle}>{title}</h1>
        <p className={s.noticeText}>{text}</p>
        {children}
      </section>
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const emailBindingRequired = useAuthStore((state) => state.emailBindingRequired);
  const emailAuthAvailable = useAuthStore((state) => state.emailAuthAvailable);
  const registrationAvailable = useAuthStore((state) => state.registrationAvailable);
  const inviteRequired = useAuthStore((state) => state.inviteRequired);
  const init = useAuthStore((state) => state.init);
  const requestEmailCode = useAuthStore((state) => state.requestEmailCode);
  const requestEmailBindingCode = useAuthStore((state) => state.requestEmailBindingCode);
  const bindEmail = useAuthStore((state) => state.bindEmail);
  const login = useAuthStore((state) => state.login);
  const loginWithEmailCode = useAuthStore((state) => state.loginWithEmailCode);
  const register = useAuthStore((state) => state.register);
  const logout = useAuthStore((state) => state.logout);
  const [mode, setMode] = useState<Mode>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetFlowBusy, setResetFlowBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const { cooldown, resetCooldown, startCooldown } = useCooldown();

  const bindingEmail = status === 'authed' && emailBindingRequired;
  const canRegister = !bindingEmail && emailAuthAvailable && registrationAvailable;
  const registering = !bindingEmail && mode === 'register' && canRegister;
  const resetting = !bindingEmail && mode === 'reset' && emailAuthAvailable;
  const emailCodeLogin = !bindingEmail && mode === 'login'
    && emailAuthAvailable && loginMethod === 'email-code';
  const usesEmailCode = bindingEmail || registering || emailCodeLogin;
  const usesAccountCredentials = !bindingEmail && !emailCodeLogin && !resetting;
  // 卷首小白:表情与台词随当前帖态切换(纯派生,不入 store)
  const avatarMood: XiaobaiMood = bindingEmail ? 'thinking'
    : registering ? 'shy'
    : resetting ? 'thinking'
    : 'curious';
  const plateVoice = bindingEmail ? '先生的名帖，还差一笔。'
    : registering ? '初次递帖？小生这厢有礼。'
    : resetting ? '先生忘了口令？小生陪先生慢慢寻。'
    : emailCodeLogin ? '先生今日也来教小生？'
    : '先生又来授业了？';
  const next = safeNextPath(params.get('next') || '/study');
  useDocTitle(bindingEmail ? '补录验证邮箱' : resetting ? '找回密码' : registering ? '递帖注册' : '登入书斋');

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const fieldId: Partial<Record<AuthField, string>> = {
      email: 'auth-email', code: 'auth-code', username: 'auth-username',
      password: 'auth-password', currentPassword: 'auth-current-password', invite: 'auth-invite',
    };
    document.getElementById(fieldId[issue.field] ?? '')?.focus();
  }, [issue]);

  const clearFieldIssue = (field: AuthField) => {
    setIssue((current) => current?.field === field || current?.field === 'form' ? null : current);
  };

  const resetSensitiveState = () => {
    setPassword(''); setCurrentPassword(''); setCode(''); setInvite('');
    setIssue(null); setFeedback(null); resetCooldown();
  };

  const switchMode = (nextMode: Mode) => {
    if (nextMode === mode || busy || resetFlowBusy || sendingCode
      || (nextMode === 'register' && !canRegister)) return;
    setMode(nextMode);
    if (nextMode === 'login') setLoginMethod('password');
    resetSensitiveState();
  };

  const startPasswordReset = () => {
    if (busy || resetFlowBusy || sendingCode || !emailAuthAvailable) return;
    setMode('reset');
    resetSensitiveState();
  };

  const switchLoginMethod = () => {
    if (busy || sendingCode) return;
    if (loginMethod === 'password') {
      const normalizedIdentifier = username.trim().toLowerCase();
      if (!email && EMAIL_RE.test(normalizedIdentifier)) setEmail(normalizedIdentifier);
      setLoginMethod('email-code');
    } else {
      if (!username && email.trim()) setUsername(email.trim().toLowerCase());
      setLoginMethod('password');
    }
    resetSensitiveState();
  };

  const changeEmail = (value: string) => {
    setEmail(value); setCode(''); resetCooldown(); setFeedback(null);
    setIssue((current) => current?.field === 'email' || current?.field === 'code' || current?.field === 'form'
      ? null : current);
  };

  const validate = (): Issue | null => {
    if (bindingEmail && !currentPassword) {
      return { field: 'currentPassword', message: '请输入当前账号密码以确认身份' };
    }
    if (bindingEmail && currentPassword.length > 128) {
      return { field: 'currentPassword', message: '当前密码不能超过 128 位' };
    }
    if (usesEmailCode && !EMAIL_RE.test(email.trim())) return { field: 'email', message: '请输入有效的邮箱地址' };
    if (usesEmailCode && !CODE_RE.test(code)) return { field: 'code', message: '请输入邮件中的 6 位验证码' };
    if (usesAccountCredentials && !username.trim()) {
      return { field: 'username', message: registering ? '请输入账号' : '请输入邮箱或账号' };
    }
    if (registering && !NAME_RE.test(username.trim())) {
      return { field: 'username', message: '账号名需 2–20 字，可用汉字、字母、数字、_ 或 -' };
    }
    if (usesAccountCredentials && !password) return { field: 'password', message: '请输入密码' };
    if (registering && password.length < 8) return { field: 'password', message: '密码至少需要 8 位' };
    if (password.length > 128) return { field: 'password', message: '密码不能超过 128 位' };
    if (registering && inviteRequired && !invite.trim()) return { field: 'invite', message: '请输入邀请码' };
    return null;
  };

  const sendCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (registering && inviteRequired && !invite.trim()) {
      setIssue({ field: 'invite', message: '请先输入邀请码' }); return;
    }
    if (!EMAIL_RE.test(normalizedEmail)) {
      setIssue({ field: 'email', message: '请输入有效的邮箱地址' }); return;
    }
    if (bindingEmail && !currentPassword) {
      setIssue({ field: 'currentPassword', message: '请先输入当前账号密码' }); return;
    }
    setSendingCode(true); setIssue(null); setFeedback(null);
    const result = bindingEmail
      ? await requestEmailBindingCode(normalizedEmail, currentPassword)
      : await requestEmailCode(
        normalizedEmail,
        registering ? 'register' : 'login',
        registering && inviteRequired ? invite.trim() : undefined,
      );
    setSendingCode(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '验证码发送失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    startCooldown(Math.max(60, result.retryAfter ?? 60));
    setFeedback('验证码已发送，请在十分钟内完成验证');
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || sendingCode) return;
    const localIssue = validate();
    if (localIssue) { setIssue(localIssue); setFeedback(null); return; }
    setBusy(true); setIssue(null); setFeedback(null);
    const normalizedEmail = email.trim().toLowerCase();
    const result = bindingEmail
      ? await bindEmail(normalizedEmail, code, currentPassword)
      : registering
        ? await register({ username: username.trim(), password, email: normalizedEmail, code,
          ...(inviteRequired ? { invite: invite.trim() } : {}) })
        : emailCodeLogin
          ? await loginWithEmailCode(normalizedEmail, code)
          : await login(username.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '认证失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    if (useAuthStore.getState().emailBindingRequired) {
      setPassword(''); setEmail(''); setCode(''); resetCooldown();
      setFeedback('账号已验证，请补录常用邮箱后继续');
      return;
    }
    navigate(next, { replace: true });
  };

  const exitBinding = async () => {
    if (busy || sendingCode) return;
    setBusy(true); setIssue(null); setFeedback(null);
    const result = await logout();
    setBusy(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '退出失败，请稍后再试' });
      return;
    }
    setEmail(''); setCode(''); setPassword(''); resetCooldown();
  };

  if (status === 'unknown') {
    return <AuthNotice title="正在验帖" text="正在确认书斋登录状态…" role="status" />;
  }
  if (status === 'unavailable') {
    return (
      <AuthNotice title="暂时无法验帖" text="认证服务暂时无法连接，请检查网络后重试。" role="alert">
        <button className={s.noticeAction} type="button" onClick={() => void init()}>重新连接</button>
      </AuthNotice>
    );
  }
  if (status === 'standalone' || (status === 'authed' && !bindingEmail)) {
    const standalone = status === 'standalone';
    return (
      <AuthNotice title={standalone ? '本地演示模式' : '已在书斋中'}
        text={standalone ? '当前为本地演示，无需登录即可使用全部功能。' : '你已登录，可以直接给小白开讲。'}>
        <Link className={s.noticeLink} to={standalone ? '/study' : next}>
          {standalone ? '回书斋' : '继续'} <Icon name="arrow-right" size={16} />
        </Link>
      </AuthNotice>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.split}>
        <aside className={s.plate}>
          <p className={s.plateVoice} lang="zh">{plateVoice}</p>
          <div className={s.plateAvatar} aria-hidden="true">
            <XiaobaiAvatar mood={avatarMood} level={1} variant="paper" size={150} />
          </div>
          <p className={s.plateMotto} lang="zh">教<br />然<br />后<br />知<br />困</p>
          <p className={s.plateGloss}>把知识讲给会追问的<br />AI 学生「小白」听</p>
          <Seal className={s.straddleSeal} />
        </aside>

        <section className={s.form} aria-labelledby="auth-title">
          <p className={s.eyebrow}>{bindingEmail ? '补全名帖' : resetting ? '重校名帖' : '凭帖入斋'}</p>
          <h1 className={s.title} id="auth-title">
            {bindingEmail ? '绑定验证邮箱' : resetting ? '找回密码' : registering ? '递帖注册' : '登入书斋'}
          </h1>
          <p className={s.sub}>{bindingEmail
            ? '输入当前密码并验证常用邮箱。完成后才能继续使用备课与讲解功能。'
            : resetting
            ? '用注册邮箱接收验证码，核验通过后设置新的登录密码。'
            : registering
            ? '验证邮箱并设置账号，注册成功后即可入斋。'
            : emailCodeLogin ? '输入邮箱验证码，无需密码即可继续。' : '使用邮箱或账号与密码登录。'}</p>

          {bindingEmail ? (
            <div className={s.bindingAccount} aria-label={`当前账号 ${user ?? ''}`}>
              <span>当前账号</span>
              <strong>{user}</strong>
              <small>邮箱待验证</small>
            </div>
          ) : !resetting ? <div className={s.modes} role="group" aria-label="登录或注册">
            <button type="button" className={s.modeBtn} aria-pressed={!registering}
              disabled={busy || sendingCode}
              onClick={() => switchMode('login')}>登录</button>
            {canRegister ? <button type="button" className={s.modeBtn} aria-pressed={registering}
              disabled={busy || sendingCode}
              onClick={() => switchMode('register')}>注册</button> : null}
          </div> : null}
          {!bindingEmail && !registering && !resetting && emailAuthAvailable ? (
            <button className={s.methodSwitch} type="button" disabled={busy || sendingCode}
              aria-controls="auth-form" onClick={switchLoginMethod}>
              {emailCodeLogin ? '改用邮箱或账号 + 密码' : '改用邮箱验证码'}
            </button>
          ) : null}

          {resetting ? (
            <PasswordResetForm
              onBusyChange={setResetFlowBusy}
              onSuccess={() => navigate(next, { replace: true })}
            />
          ) : <form className={s.fields} id="auth-form" noValidate aria-busy={busy || sendingCode} onSubmit={onSubmit}>
            <fieldset className={s.fieldset} disabled={busy}>
              {registering && inviteRequired ? <label className={fs.field} htmlFor="auth-invite">
                <span className={fs.label}>邀请码</span>
                <input id="auth-invite" className={fs.input} type="text" value={invite}
                  autoComplete="off" spellCheck={false} required aria-invalid={issue?.field === 'invite' || undefined}
                  aria-describedby={issue?.field === 'invite' ? 'auth-feedback' : 'auth-invite-hint'}
                  onChange={(event) => { setInvite(event.target.value); clearFieldIssue('invite'); }} />
                <span className={fs.hint} id="auth-invite-hint">获取注册验证码前需要先核验邀请码</span>
              </label> : null}
              {bindingEmail ? <label className={fs.field} htmlFor="auth-current-password">
                <span className={fs.label}>当前账号密码</span>
                <input id="auth-current-password" className={fs.input} type="password" value={currentPassword}
                  autoFocus autoComplete="current-password" maxLength={128} required disabled={sendingCode}
                  aria-invalid={issue?.field === 'currentPassword' || undefined}
                  aria-describedby={issue?.field === 'currentPassword' ? 'auth-feedback' : 'auth-current-password-hint'}
                  onChange={(event) => { setCurrentPassword(event.target.value); clearFieldIssue('currentPassword'); }} />
                <span className={fs.hint} id="auth-current-password-hint">发码与绑定前都需要再次确认</span>
              </label> : null}
              {usesEmailCode ? <EmailCodeField email={email} code={code} issueField={issue?.field}
                sending={sendingCode} cooldown={cooldown} onEmailChange={changeEmail}
                onCodeChange={(value) => { setCode(value); clearFieldIssue('code'); }}
                onSend={() => void sendCode()} /> : null}
              {usesAccountCredentials ? <>
                <label className={fs.field} htmlFor="auth-username">
                  <span className={fs.label}>{registering ? '账号' : '邮箱或账号'}</span>
                  <input id="auth-username" className={fs.input} type="text" value={username}
                    autoComplete="username" autoCapitalize="none" spellCheck={false}
                    maxLength={registering ? 20 : 254} required
                    aria-invalid={issue?.field === 'username' || undefined}
                    aria-describedby={issue?.field === 'username' ? 'auth-feedback' : registering ? 'auth-name-hint' : undefined}
                    onChange={(event) => { setUsername(event.target.value); clearFieldIssue('username'); }} />
                  {registering ? <span className={fs.hint} id="auth-name-hint">2–20 字，可用汉字、字母、数字、_ 或 -</span> : null}
                </label>
                <label className={fs.field} htmlFor="auth-password">
                  <span className={fs.label}>密码</span>
                  <input id="auth-password" className={fs.input} type="password" value={password}
                    autoComplete={registering ? 'new-password' : 'current-password'} maxLength={128} required
                    aria-invalid={issue?.field === 'password' || undefined}
                    aria-describedby={issue?.field === 'password' ? 'auth-feedback' : registering ? 'auth-password-hint' : undefined}
                    onChange={(event) => { setPassword(event.target.value); clearFieldIssue('password'); }} />
                  {registering ? <span className={fs.hint} id="auth-password-hint">至少 8 位</span> : null}
                </label>
                {!registering && emailAuthAvailable ? (
                  <button className={s.forgotPassword} type="button" onClick={startPasswordReset}>
                    忘记密码？用邮箱验证码找回
                  </button>
                ) : null}
              </> : null}
            </fieldset>

            <div className={s.feedbackSlot}>
              {issue ? <p className={s.error} id="auth-feedback" role="alert">{issue.message}</p>
                : feedback ? <p className={s.success} role="status">{feedback}</p> : null}
            </div>
            <button className={s.submit} type="submit" data-busy={busy || undefined}
              disabled={busy || sendingCode}>{busy
                ? bindingEmail ? '正在核验…' : registering ? '正在注册…' : '正在登录…'
                : bindingEmail ? '验证并继续' : registering ? '注册并入斋' : '登录'}</button>
          </form>}

          <footer className={s.foot}>
            <p className={s.footSign}>
              <span className={s.footSeal} aria-hidden="true">问</span>
              春雾书院 · 敬候赐教
            </p>
            <div className={s.footRow}>
              <span>{bindingEmail ? '验证完成前，此账号无法进入使用页面'
                : resetting ? '验证码只会发送到已绑定的注册邮箱'
                : registering ? '邮箱验证为必填项' : canRegister ? '新用户可验证邮箱注册' : '新账号注册暂未开放'}</span>
              {bindingEmail ? (
                <button className={s.bindingLogout} type="button" disabled={busy || sendingCode}
                  onClick={() => void exitBinding()}>退出账号</button>
              ) : resetting ? (
                <button className={s.bindingLogout} type="button" disabled={resetFlowBusy}
                  onClick={() => switchMode('login')}>
                  {resetFlowBusy ? '正在处理…' : '返回密码登录'}
                </button>
              ) : <Link className={s.backLink} to="/study"><Icon name="arrow-left" size={15} />先随便看看</Link>}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
