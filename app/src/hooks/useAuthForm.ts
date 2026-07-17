import { useCallback, useEffect, useState } from 'react';
import type { AuthField } from '../store/authStore';

export type Issue = { field: AuthField; message: string };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CODE_RE = /^\d{6}$/;
export const NAME_RE = /^[\p{Script=Han}A-Za-z0-9_-]{2,20}$/u;

export function mapPasswordIssueField(field: AuthField | undefined): AuthField {
  return field === 'password' ? 'newPassword' : field ?? 'form';
}

interface CooldownState {
  cooldown: number;
  resetCooldown: () => void;
  startCooldown: (seconds: number) => void;
}

export function useCooldown(): CooldownState {
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));

  useEffect(() => {
    if (cooldownUntil <= clock) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(1000, cooldownUntil - clock),
    );
    return () => window.clearTimeout(timer);
  }, [clock, cooldownUntil]);

  const resetCooldown = useCallback(() => setCooldownUntil(0), []);
  const startCooldown = useCallback((seconds: number) => {
    const now = Date.now();
    const duration = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    setClock(now);
    setCooldownUntil(now + duration * 1000);
  }, []);

  return { cooldown, resetCooldown, startCooldown };
}
