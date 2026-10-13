/**
 * 认证表单的几块小件：就地错误文案、统一提示行、验证码框（带发码钮与倒计时）、密码框（可显隐）。
 * 登录页、找回密码与个人中心的换绑流程共用。
 */
import { forwardRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { Button, Field, IconButton, Input, cx, type InputProps } from '../../components/ui';
import { joinIds } from '../../hooks/useAuthForm';
import fs from './EmailCodeField.module.css';

/** 字段下方的就地错误。带 id，输入框用 aria-describedby 指向它 */
export function IssueText({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id}>{children}</span>;
}

/**
 * 表单级提示行：不属于某个字段的错误，或「验证码已发送」这类进展。
 * 容器常驻（空时零高度），读屏才能稳定播报后插入的内容。
 */
export function FormFeedback({ id, error, success }: {
  id: string; error?: string | null; success?: string | null;
}) {
  return (
    <div className={fs.feedback} aria-live="polite">
      {error ? (
        <p className={cx(fs.alert, fs.alertBad)} id={id} role="alert">
          <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : success ? (
        <p className={cx(fs.alert, fs.alertOk)}>
          <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{success}</span>
        </p>
      ) : null}
    </div>
  );
}

interface CodeFieldProps {
  id: string;
  label: string;
  code: string;
  /** 当前出错字段是否就是验证码 */
  invalid: boolean;
  /** 有文案就显示在字段下方；不传则由外层的统一提示行承担 */
  issueMessage?: string;
  feedbackId: string;
  sending: boolean;
  cooldown: number;
  disabled?: boolean;
  onCodeChange: (value: string) => void;
  onSend: () => void;
}

export function CodeField({
  id, label, code, invalid, issueMessage, feedbackId, sending, cooldown, disabled = false,
  onCodeChange, onSend,
}: CodeFieldProps) {
  const hintId = `${id}-hint`;
  const inline = invalid && Boolean(issueMessage);
  const sendLabel = sending ? '正在发送…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码';

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={<span id={hintId}>6 位数字，十分钟内有效</span>}
      error={inline ? <IssueText id={feedbackId}>{issueMessage}</IssueText> : undefined}
    >
      <Input
        id={id}
        wrapClassName={fs.wrap}
        className={cx(fs.autofill, fs.codeDigits)}
        type="text"
        value={code}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        disabled={disabled}
        invalid={invalid}
        placeholder="6 位验证码"
        leading={<ShieldCheck size={16} strokeWidth={1.75} />}
        aria-describedby={joinIds(invalid && feedbackId, !inline && hintId)}
        onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        trailing={(
          <>
            <span className={fs.codeRule} aria-hidden="true" />
            <Button
              variant="ghost"
              size="sm"
              className={fs.sendCode}
              loading={sending}
              disabled={disabled || sending || cooldown > 0}
              aria-describedby={inline ? undefined : hintId}
              onClick={onSend}
            >
              {sendLabel}
            </Button>
          </>
        )}
      />
    </Field>
  );
}

type PasswordInputProps = Omit<InputProps, 'type' | 'leading' | 'trailing'>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, wrapClassName, disabled, ...rest }, ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      ref={ref}
      {...rest}
      disabled={disabled}
      wrapClassName={cx(fs.wrap, wrapClassName)}
      className={cx(fs.autofill, className)}
      type={visible ? 'text' : 'password'}
      leading={<Lock size={16} strokeWidth={1.75} />}
      trailing={(
        <IconButton
          label={visible ? '隐藏密码' : '显示密码'}
          size="sm"
          tip={false}
          className={fs.eye}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
        </IconButton>
      )}
    />
  );
});
