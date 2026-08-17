import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ProfileState {
  avatars: Record<string, string>;
  setAvatar: (account: string, dataUrl: string) => void;
  removeAvatar: (account: string) => void;
}

export function profileAccountKey(account: string | null): string {
  return account?.trim().toLowerCase() ?? '';
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      avatars: {},
      setAvatar: (account, dataUrl) => set((state) => ({
        avatars: { ...state.avatars, [profileAccountKey(account)]: dataUrl },
      })),
      removeAvatar: (account) => set((state) => {
        const key = profileAccountKey(account);
        if (!key || !(key in state.avatars)) return state;
        const avatars = { ...state.avatars };
        delete avatars[key];
        return { avatars };
      }),
    }),
    {
      name: 'xiaobai-profile-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ avatars: state.avatars }),
    },
  ),
);
