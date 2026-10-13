import { Mail } from 'lucide-react';
import { Field, Input } from '../../components/ui';
import type { AuthField } from '../../store/authStore';
import { joinIds } from '../../hooks/useAuthForm';
import { CodeField, IssueText } from './fields';
import fs from './EmailCodeField.module.css';

interface EmailCodeFieldProps {
  email: string;
  code: string;
  issueField?: AuthField;
  /** 传入后，邮箱或验证码出错时文案就显示在该字段下方；不传则只标红，由外层提示行说明 */
  issueMessage?: string;
  sending: boolean;
  cooldown: number;
  idPrefix?: string;
  feedbackId?: string;
  emailLabel?: string;
  autoFocusEmail?: boolean;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
}

export function EmailCodeField({
  email, code, issueField, issueMessage, sending, cooldown,
  idPrefix = 'auth', feedbackId = 'auth-feedback', emailLabel = '邮箱', autoFocusEmail = false,
  onEmailChange, onCodeChange, onSend,
}: EmailCodeFieldProps) {
  const emailId = `${idPrefix}-email`;
  const emailInvalid = issueField === 'email';
  const emailInline = emailInvalid && Boolean(issueMessage);

  return (
    <>
      <Field
        label={emailLabel}
        htmlFor={emailId}
        error={emailInline ? <IssueText id={feedbackId}>{issueMessage}</IssueText> : undefined}
      >
        <Input
          id={emailId}
          wrapClassName={fs.wrap}
          className={fs.autofill}
          type="email"
          value={email}
          autoFocus={autoFocusEmail}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          required
          disabled={sending}
          invalid={emailInvalid}
          placeholder="name@example.com"
          leading={<Mail size={16} strokeWidth={1.75} />}
          aria-describedby={joinIds(emailInvalid && feedbackId)}
          onChange={(event) => onEmailChange(event.target.value)}
        />
      </Field>
      <CodeField
        id={`${idPrefix}-code`}
        label="邮箱验证码"
        code={code}
        invalid={issueField === 'code'}
        issueMessage={issueMessage}
        feedbackId={feedbackId}
        sending={sending}
        cooldown={cooldown}
        onCodeChange={onCodeChange}
        onSend={onSend}
      />
    </>
  );
}
