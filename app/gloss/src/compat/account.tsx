import type { ReactNode } from 'react';
import { account, hostMessage } from './bridge';
export function useAuth() { return { isLoaded: true, isSignedIn: account.signedIn, userId: account.name }; }
export function useUser() { return { isSignedIn: account.signedIn, user: { firstName: account.name, fullName: account.name } }; }
export function Show({ when, children }: { when: string; children: ReactNode }) { return (when === 'signed-in') === account.signedIn ? children : null; }
export function SignInButton({ children }: { children: ReactNode; mode?: string }) { return <span onClick={() => hostMessage('login')}>{children}</span>; }
export function UserButton(_props: { appearance?: unknown }) { return <button aria-label="个人中心" onClick={() => hostMessage('profile')} className="grid size-7 place-items-center rounded-full bg-ink text-[12px] text-bg">{account.name.slice(0, 1).toUpperCase()}</button>; }
