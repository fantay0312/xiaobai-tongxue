/**
 * Agent tokens: how a reader's agent (Grok Bot, Claude, ChatGPT) is let into
 * their library. A token is shown once; only its hash is stored. Server-side.
 */

import { createHash, randomBytes } from "node:crypto";

const PREFIX = "gls_";

export const hashToken = (token: string) => createHash("sha256").update(`gloss-agent:${token}`).digest("hex");

export function makeToken(): { id: string; token: string; hash: string } {
  const token = PREFIX + randomBytes(24).toString("base64url");
  return { id: randomBytes(8).toString("hex"), token, hash: hashToken(token) };
}

export const looksLikeToken = (s: string | null | undefined): s is string => typeof s === "string" && s.startsWith(PREFIX) && s.length > 20 && s.length < 80;
