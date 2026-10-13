import { createContext, useContext } from 'react';

export const ShellActionsContext = createContext<{ openSettings: () => void; openProfile: () => void } | null>(null);
export function useShellActions() {
  const actions = useContext(ShellActionsContext);
  if (!actions) throw new Error('Shell actions require AppShell');
  return actions;
}
