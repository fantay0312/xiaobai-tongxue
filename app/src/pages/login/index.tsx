import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Ticket, UserRound } from 'lucide-react';
import {
  Badge, Button, Field, Input, Segmented, Spinner, type SegmentOption,
} from '../../components/ui';
import type { XiaobaiMood } from '../../types';
import { useAuthStore, type AuthField } from '../../store/authStore';
import { useDocTitle } from '../../hooks/useDocTitle';
import { safeNextPath } from '../../lib/authNavigation';
import {
  CODE_RE, EMAIL_RE, MAINLAND_PHONE_RE, NAME_RE, mainlandPhoneToE164,
  useCooldown, type Issue,
} from '../../hooks/useAuthForm';
import { EmailCodeField } from './EmailCodeField';
import { PhoneCodeField } from './PhoneCodeField';
import { PasswordResetForm } from './PasswordResetForm';
import { StoryPanel } from './StoryPanel';
import { FormFeedback, IssueText, PasswordInput } from './fields';
import fs from './EmailCodeField.module.css';
import s from './login.module.css';

type Mode = 'login' | 'register' | 'reset';
type LoginMethod = 'password' | 'phone-code' | 'email-code';
type RegistrationMethod = 'phone' | 'email';

const FEEDBACK_ID = 'auth-feedback';

/** 左故事栏 + 右内容栏。表单与各种状态提示共用同一副骨架，切换时不跳版 */
function AuthFrame({ mood, voice, labelledBy, children }: {
  mood: XiaobaiMood; voice: string; labelledBy: string; children: ReactNode;
}) {
  return (
    <div className={s.page}>
      <StoryPanel mood={mood} voice={voice} />
      <section className={s.panel} aria-labelledby={labelledBy}>
        <div className={s.sheet}>{children}</div>
      </section>
    </div>
  );
}

function AuthNotice({ mood, voice, title, text, role, pending, children }: {
  mood: XiaobaiMood; voice: string; title: string; text: string;
  role?: 'status' | 'alert'; pending?: boolean; children?: ReactNode;
}) {
  return (
    <AuthFrame mood={mood} voice={voice} labelledBy="auth-notice-title">
      <div className={s.notice} role={role} aria-live={role === 'status' ? 'polite' : undefined}>
        {pending ? <Spinner size={20} className={s.noticeSpinner} /> : null}
        <h1 className={s.title} id="auth-notice-title">{title}</h1>
        <p className={s.sub}>{text}</p>
        {children ? <div className={s.noticeActions}>{children}</div> : null}
      </div>
    </AuthFrame>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const emailBindingRequired = useAuthStore((state) => state.emailBindingRequired);
  const phoneBindingRequired = useAuthStore((state) => state.phoneBindingRequired);
  const emailAuthAvailable = useAuthStore((state) => state.emailAuthAvailable);
  const smsAuthAvailable = useAuthStore((state) => state.smsAuthAvailable);
  const registrationAvailable = useAuthStore((state) => state.registrationAvailable);
  const inviteRequired = useAuthStore((state) => state.inviteRequired);
  const init = useAuthStore((state) => state.init);
  const requestEmailCode = useAuthStore((state) => state.requestEmailCode);
  const requestEmailBindingCode = useAuthStore((state) => state.requestEmailBindingCode);
  const bindEmail = useAuthStore((state) => state.bindEmail);
  const requestSmsCode = useAuthStore((state) => state.requestSmsCode);
  const requestPhoneBindingCode = useAuthStore((state) => state.requestPhoneBindingCode);
  const bindPhone = useAuthStore((state) => state.bindPhone);
  const login = useAuthStore((state) => state.login);
  const loginWithEmailCode = useAuthStore((state) => state.loginWithEmailCode);
  const loginWithPhoneCode = useAuthStore((state) => state.loginWithPhoneCode);
  const register = useAuthStore((state) => state.register);
  const logout = useAuthStore((state) => state.logout);
  const [mode, setMode] = useState<Mode>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [registrationMethod, setRegistrationMethod] = useState<RegistrationMethod>('phone');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetFlowBusy, setResetFlowBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const pendingOperation = useRef<AbortController | null>(null);
  useEffect(() => () => pendingOperation.current?.abort(), []);
  const { cooldown, resetCooldown, startCooldown } = useCooldown();

  const bindingEmail = status === 'authed' && emailBindingRequired;
  const bindingPhone = status === 'authed' && !emailBindingRequired && phoneBindingRequired;
  const bindingRequired = bindingEmail || bindingPhone;
  const canRegister = !bindingRequired && (smsAuthAvailable || emailAuthAvailable) && registrationAvailable;
  const registering = !bindingRequired && mode === 'register' && canRegister;
  const phoneRegistration = registering && smsAuthAvailable && (registrationMethod === 'phone' || !emailAuthAvailable);
  const emailRegistration = registering && !phoneRegistration;
  const resetting = !bindingRequired && mode === 'reset'
    && (smsAuthAvailable || emailAuthAvailable);
  const emailCodeLogin = !bindingRequired && mode === 'login'
    && emailAuthAvailable && loginMethod === 'email-code';
  const phoneCodeLogin = !bindingRequired && mode === 'login'
    && smsAuthAvailable && loginMethod === 'phone-code';
  const usesEmailCode = bindingEmail || emailRegistration || emailCodeLogin;
  const usesPhoneCode = bindingPhone || phoneRegistration || phoneCodeLogin;
  const usesAccountCredentials = !bindingRequired && !emailCodeLogin && !phoneCodeLogin && !resetting;
  // 帖上小白的表情与台词随当前步骤切换（纯派生，不入 store）
  const avatarMood: XiaobaiMood = bindingRequired ? 'thinking'
    : registering ? 'shy'
      : resetting ? 'thinking'
        : 'curious';
  const voice = bindingPhone ? '名帖还差一枚手机印记。'
    : bindingEmail ? '先生的名帖，还差一笔。'
      : registering ? '初次递帖？小生这厢有礼。'
        : resetting ? '忘了口令？小生陪先生寻。'
          : emailCodeLogin || phoneCodeLogin ? '先生今日也来教小生？'
            : '先生又来授业了？';
  const title = bindingPhone ? '绑定手机号'
    : bindingEmail ? '绑定邮箱'
      : resetting ? '找回密码'
        : registering ? '注册' : '登录';
  const next = safeNextPath(params.get('next') || '/learn');
  useDocTitle(title);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const fieldId: Partial<Record<AuthField, string>> = {
      email: 'auth-email', phone: 'auth-phone', code: 'auth-code', username: 'auth-username',
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
    if (nextMode === 'register') setRegistrationMethod('phone');
    if (nextMode === 'login' && loginMethod === 'email-code' && !emailAuthAvailable) {
      setLoginMethod(smsAuthAvailable ? 'phone-code' : 'password');
    }
    resetSensitiveState();
  };

  const startPasswordReset = () => {
    if (busy || resetFlowBusy || sendingCode || (!smsAuthAvailable && !emailAuthAvailable)) return;
    setMode('reset');
    resetSensitiveState();
  };

  const switchLoginMethod = (method: LoginMethod) => {
    if (busy || sendingCode || method === loginMethod) return;
    if (method === 'email-code') {
      const normalizedIdentifier = username.trim().toLowerCase();
      if (!email && EMAIL_RE.test(normalizedIdentifier)) setEmail(normalizedIdentifier);
    } else if (method === 'password') {
      if (!username && email.trim()) setUsername(email.trim().toLowerCase());
    }
    setLoginMethod(method);
    resetSensitiveState();
  };

  const changeEmail = (value: string) => {
    setEmail(value); setCode(''); resetCooldown(); setFeedback(null);
    setIssue((current) => current?.field === 'email' || current?.field === 'code' || current?.field === 'form'
      ? null : current);
  };

  const changePhone = (value: string) => {
    setPhone(value); setCode(''); resetCooldown(); setFeedback(null);
    setIssue((current) => current?.field === 'phone' || current?.field === 'code'
      || current?.field === 'form' ? null : current);
  };

  const validate = (): Issue | null => {
    if (bindingRequired && !currentPassword) {
      return { field: 'currentPassword', message: '请输入当前账号密码以确认身份' };
    }
    if (bindingRequired && currentPassword.length > 128) {
      return { field: 'currentPassword', message: '当前密码不能超过 128 位' };
    }
    if (usesEmailCode && !EMAIL_RE.test(email.trim())) return { field: 'email', message: '请输入有效的邮箱地址' };
    if (usesEmailCode && !CODE_RE.test(code)) return { field: 'code', message: '请输入邮件中的 6 位验证码' };
    if (usesPhoneCode && !MAINLAND_PHONE_RE.test(phone)) {
      return { field: 'phone', message: '请输入中国大陆 11 位手机号' };
    }
    if (usesPhoneCode && !CODE_RE.test(code)) return { field: 'code', message: '请输入短信中的 6 位验证码' };
    if (usesAccountCredentials && !username.trim()) {
      return { field: 'username', message: registering ? '请输入账号' : '请输入手机号、邮箱或账号' };
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
    if (pendingOperation.current && !pendingOperation.current.signal.aborted) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (registering && inviteRequired && !invite.trim()) {
      setIssue({ field: 'invite', message: '请先输入邀请码' }); return;
    }
    if (usesEmailCode && !EMAIL_RE.test(normalizedEmail)) {
      setIssue({ field: 'email', message: '请输入有效的邮箱地址' }); return;
    }
    if (usesPhoneCode && !MAINLAND_PHONE_RE.test(phone)) {
      setIssue({ field: 'phone', message: '请输入中国大陆 11 位手机号' }); return;
    }
    if (bindingRequired && !currentPassword) {
      setIssue({ field: 'currentPassword', message: '请先输入当前账号密码' }); return;
    }
    setSendingCode(true); setIssue(null); setFeedback(null);
    const operation = new AbortController();
    pendingOperation.current = operation;
    const result = bindingPhone
      ? await requestPhoneBindingCode(mainlandPhoneToE164(phone), currentPassword, operation.signal)
      : phoneCodeLogin || phoneRegistration
        ? await requestSmsCode(mainlandPhoneToE164(phone), phoneRegistration ? 'register' : 'login', operation.signal,
          phoneRegistration && inviteRequired ? invite.trim() : undefined)
        : bindingEmail
          ? await requestEmailBindingCode(normalizedEmail, currentPassword, operation.signal)
          : await requestEmailCode(
            normalizedEmail,
            registering ? 'register' : 'login',
            registering && inviteRequired ? invite.trim() : undefined,
            operation.signal,
          );
    if (operation.signal.aborted) return;
    pendingOperation.current = null;
    setSendingCode(false);
    if (!result.ok && registering && result.alreadyRegistered) {
      const contact = usesPhoneCode ? '手机号' : '邮箱';
      setMode('login');
      setLoginMethod(usesPhoneCode ? 'phone-code' : 'email-code');
      setPassword(''); setCode(''); setInvite(''); resetCooldown();
      setIssue(null);
      setFeedback(`该${contact}已注册，已切换到验证码登录。请获取登录验证码。`);
      return;
    }
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '验证码发送失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    startCooldown(Math.max(60, result.retryAfter ?? 60));
    setFeedback(`${usesPhoneCode ? '短信' : '邮箱'}验证码已发送，请在十分钟内完成验证`);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || sendingCode || pendingOperation.current) return;
    const localIssue = validate();
    if (localIssue) { setIssue(localIssue); setFeedback(null); return; }
    setBusy(true); setIssue(null); setFeedback(null);
    const operation = new AbortController();
    pendingOperation.current = operation;
    const normalizedEmail = email.trim().toLowerCase();
    const result = bindingPhone
      ? await bindPhone(mainlandPhoneToE164(phone), code, currentPassword)
      : bindingEmail
        ? await bindEmail(normalizedEmail, code, currentPassword)
        : registering
          ? await register({
            username: username.trim(), password, code,
            ...(phoneRegistration
              ? { method: 'phone', phone: mainlandPhoneToE164(phone) } as const
              : { method: 'email', email: normalizedEmail } as const),
            ...(inviteRequired ? { invite: invite.trim() } : {}),
          })
          : phoneCodeLogin
            ? await loginWithPhoneCode(mainlandPhoneToE164(phone), code, operation.signal)
            : emailCodeLogin
              ? await loginWithEmailCode(normalizedEmail, code, operation.signal)
              : await login(username.trim(), password, operation.signal);
    if (operation.signal.aborted) return;
    pendingOperation.current = null;
    setBusy(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '认证失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    const auth = useAuthStore.getState();
    if (auth.emailBindingRequired || auth.phoneBindingRequired) {
      setPassword(''); setEmail(''); setPhone(''); setCode(''); resetCooldown();
      setFeedback(auth.emailBindingRequired
        ? '账号已验证，请补录常用邮箱后继续'
        : '账号已验证，请绑定常用手机号后继续');
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
    setEmail(''); setPhone(''); setCode(''); setPassword(''); resetCooldown();
  };

  if (status === 'unknown') {
    return (
      <AuthNotice mood="idle" voice="稍候，小生去看看门牌。" role="status" pending
        title="正在确认登录状态" text="马上就好。" />
    );
  }
  if (status === 'unavailable') {
    return (
      <AuthNotice mood="confused" voice="书斋的门一时推不开。" role="alert"
        title="暂时连不上" text="认证服务暂时无法连接，请检查网络后重试。">
        <Button variant="solid" size="lg" onClick={() => void init()}>重新连接</Button>
      </AuthNotice>
    );
  }
  if (status === 'standalone' || (status === 'authed' && !bindingRequired)) {
    return <Navigate to={next} replace />;
  }

  const locked = busy || sendingCode;
  const activeMethod: LoginMethod = emailCodeLogin ? 'email-code' : phoneCodeLogin ? 'phone-code' : 'password';
  const methodOptions: SegmentOption<LoginMethod>[] = [
    { value: 'password', label: '密码', disabled: locked },
    ...(emailAuthAvailable
      ? [{ value: 'email-code' as const, label: '邮箱验证码', disabled: locked }] : []),
    ...(smsAuthAvailable
      ? [{ value: 'phone-code' as const, label: '手机验证码', disabled: locked }] : []),
  ];
  const choosingMethod = !bindingRequired && !registering && !resetting && methodOptions.length > 1;

  // 出错字段在当前表单里就地提示；不在表单里的（或表单级错误）落到统一提示行
  const shownFields: AuthField[] = [
    ...(registering && inviteRequired ? ['invite' as const] : []),
    ...(bindingRequired ? ['currentPassword' as const] : []),
    ...(usesEmailCode ? ['email' as const, 'code' as const] : []),
    ...(usesPhoneCode ? ['phone' as const, 'code' as const] : []),
    ...(usesAccountCredentials ? ['username' as const, 'password' as const] : []),
  ];
  const fieldIssue = issue && shownFields.includes(issue.field) ? issue : null;
  const formIssue = issue && !fieldIssue ? issue : null;
  const errorFor = (field: AuthField) => fieldIssue?.field === field
    ? <IssueText id={FEEDBACK_ID}>{fieldIssue.message}</IssueText> : undefined;
  const describedBy = (field: AuthField, hintId?: string) => issue?.field === field ? FEEDBACK_ID : hintId;

  const sub = bindingPhone ? '验证常用手机号并确认当前密码，完成后才能继续使用。'
    : bindingEmail ? '确认当前密码并验证常用邮箱，完成后才能继续使用。'
      : resetting ? '优先用已绑定的手机号验证，也可改用已验证邮箱。'
        : registering ? phoneRegistration ? '验证手机号，再设置账号和密码。无需填写邮箱。' : '验证邮箱，再设置账号和密码。'
          : phoneCodeLogin ? '输入手机号和短信验证码，无需密码。'
            : emailCodeLogin ? '输入邮箱和验证码，无需密码。'
              : '使用手机号、邮箱或账号与密码登录。';
  const footNote = bindingPhone ? '完成手机验证前无法进入学习页面；忘记密码可退出后用已验证邮箱找回'
    : bindingEmail ? '验证完成前，此账号无法进入学习页面'
      : resetting ? '仅向已绑定手机号或已验证邮箱发送验证码'
        : registering ? phoneRegistration ? '邮箱可选，注册后可在个人中心绑定' : '邮箱注册后，需绑定手机号以继续使用'
          : canRegister ? null : '新账号注册暂未开放';
  const submitLabel = busy
    ? bindingRequired ? '正在核验…' : registering ? '正在注册…' : '正在登录…'
    : bindingRequired ? '验证并继续' : registering ? '注册' : '登录';

  return (
    <AuthFrame mood={avatarMood} voice={voice} labelledBy="auth-title">
      <header className={s.head}>
        <h1 className={s.title} id="auth-title">{title}</h1>
        <p className={s.sub}>{sub}</p>
      </header>

      {bindingRequired ? (
        <div className={s.account}>
          <span className={s.accountIcon} aria-hidden="true">
            <UserRound size={16} strokeWidth={1.75} />
          </span>
          <span className={s.accountText}>
            <span>当前账号</span>
            <strong>{user}</strong>
          </span>
          <Badge tone="warn" dot>{bindingPhone ? '手机号待验证' : '邮箱待验证'}</Badge>
        </div>
      ) : null}

      {choosingMethod ? (
        <Segmented
          block
          label="登录方式"
          value={activeMethod}
          options={methodOptions}
          onChange={switchLoginMethod}
        />
      ) : null}

      {registering && smsAuthAvailable && emailAuthAvailable ? (
        <Segmented
          block
          label="注册方式"
          value={phoneRegistration ? 'phone' : 'email'}
          options={[
            { value: 'phone', label: '手机号注册', disabled: locked },
            { value: 'email', label: '邮箱注册', disabled: locked },
          ]}
          onChange={(value: RegistrationMethod) => {
            setRegistrationMethod(value); setCode(''); resetCooldown(); setIssue(null); setFeedback(null);
          }}
        />
      ) : null}

      {resetting ? (
        <PasswordResetForm
          onBusyChange={setResetFlowBusy}
          onSuccess={() => navigate(next, { replace: true })}
        />
      ) : (
        <form className={s.form} id="auth-form" noValidate aria-busy={locked} onSubmit={onSubmit}>
          <fieldset className={s.fieldset} disabled={busy}>
            {registering && inviteRequired ? (
              <Field
                label="邀请码"
                htmlFor="auth-invite"
                hint={<span id="auth-invite-hint">获取注册验证码前需要先核验邀请码</span>}
                error={errorFor('invite')}
              >
                <Input
                  id="auth-invite"
                  wrapClassName={fs.wrap}
                  className={fs.autofill}
                  type="text"
                  value={invite}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  invalid={issue?.field === 'invite'}
                  leading={<Ticket size={16} strokeWidth={1.75} />}
                  aria-describedby={describedBy('invite', 'auth-invite-hint')}
                  onChange={(event) => { setInvite(event.target.value); clearFieldIssue('invite'); }}
                />
              </Field>
            ) : null}

            {bindingRequired ? (
              <Field
                label="当前账号密码"
                htmlFor="auth-current-password"
                hint={<span id="auth-current-password-hint">发码与绑定前都需要再次确认</span>}
                error={errorFor('currentPassword')}
              >
                <PasswordInput
                  id="auth-current-password"
                  value={currentPassword}
                  autoFocus
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  disabled={sendingCode}
                  invalid={issue?.field === 'currentPassword'}
                  aria-describedby={describedBy('currentPassword', 'auth-current-password-hint')}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value);
                    clearFieldIssue('currentPassword');
                  }}
                />
              </Field>
            ) : null}

            {usesEmailCode ? (
              <EmailCodeField
                email={email}
                code={code}
                issueField={issue?.field}
                issueMessage={fieldIssue?.message}
                sending={sendingCode}
                cooldown={cooldown}
                onEmailChange={changeEmail}
                onCodeChange={(value) => { setCode(value); clearFieldIssue('code'); }}
                onSend={() => void sendCode()}
              />
            ) : null}

            {usesPhoneCode ? (
              <PhoneCodeField
                phone={phone}
                code={code}
                issueField={issue?.field}
                issueMessage={fieldIssue?.message}
                sending={sendingCode}
                cooldown={cooldown}
                onPhoneChange={changePhone}
                onCodeChange={(value) => { setCode(value); clearFieldIssue('code'); }}
                onSend={() => void sendCode()}
              />
            ) : null}

            {usesAccountCredentials ? (
              <>
                <Field
                  label={registering ? '账号' : '手机号、邮箱或账号'}
                  htmlFor="auth-username"
                  hint={registering
                    ? <span id="auth-name-hint">2–20 字，可用汉字、字母、数字、_ 或 -</span> : undefined}
                  error={errorFor('username')}
                >
                  <Input
                    id="auth-username"
                    wrapClassName={fs.wrap}
                    className={fs.autofill}
                    type="text"
                    value={username}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={registering ? 20 : 254}
                    required
                    invalid={issue?.field === 'username'}
                    leading={<UserRound size={16} strokeWidth={1.75} />}
                    aria-describedby={describedBy('username', registering ? 'auth-name-hint' : undefined)}
                    onChange={(event) => { setUsername(event.target.value); clearFieldIssue('username'); }}
                  />
                </Field>
                <Field
                  label="密码"
                  htmlFor="auth-password"
                  hint={registering ? <span id="auth-password-hint">至少 8 位</span> : undefined}
                  error={errorFor('password')}
                >
                  <PasswordInput
                    id="auth-password"
                    value={password}
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    maxLength={128}
                    required
                    invalid={issue?.field === 'password'}
                    aria-describedby={describedBy('password', registering ? 'auth-password-hint' : undefined)}
                    onChange={(event) => { setPassword(event.target.value); clearFieldIssue('password'); }}
                  />
                </Field>
                {!registering && (smsAuthAvailable || emailAuthAvailable) ? (
                  <div className={s.fieldTail}>
                    <button className={s.link} type="button" onClick={startPasswordReset}>
                      忘记密码？
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </fieldset>

          <div className={s.actions}>
            <FormFeedback
              id={FEEDBACK_ID}
              error={formIssue?.message}
              success={issue ? null : feedback}
            />
            <Button type="submit" variant="solid" size="lg" block loading={busy} disabled={locked}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}

      {bindingRequired ? (
        <p className={s.alt}>
          <button className={s.link} type="button" disabled={locked} onClick={() => void exitBinding()}>
            退出账号
          </button>
        </p>
      ) : resetting ? (
        <p className={s.alt}>
          <button className={s.link} type="button" disabled={resetFlowBusy}
            onClick={() => switchMode('login')}>
            {resetFlowBusy ? '正在处理…' : '返回登录'}
          </button>
        </p>
      ) : registering ? (
        <p className={s.alt}>
          <span>已有账号？</span>
          <button className={s.link} type="button" disabled={locked} onClick={() => switchMode('login')}>
            登录
          </button>
        </p>
      ) : canRegister ? (
        <p className={s.alt}>
          <span>还没有账号？</span>
          <button className={s.link} type="button" disabled={locked} onClick={() => switchMode('register')}>
            注册
          </button>
        </p>
      ) : null}

      {footNote || !bindingRequired ? (
        <footer className={s.foot}>
          {footNote ? <span>{footNote}</span> : null}
          {!bindingRequired ? (
            <Link className={`${s.link} ${s.linkQuiet}`} to="/">返回首页</Link>
          ) : null}
        </footer>
      ) : null}
    </AuthFrame>
  );
}
