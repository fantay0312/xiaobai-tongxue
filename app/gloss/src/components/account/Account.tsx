"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { barBtn } from "@/components/ui/Popover";

/** Signed out: a quiet "Sign in". Signed in: the avatar, with Clerk's account menu. */
export function Account() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className={`${barBtn} !px-3 whitespace-nowrap`} data-tip="在不同设备保留高亮和笔记">
            登录
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <span className="grid size-9 place-items-center">
          <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
        </span>
      </Show>
    </>
  );
}
