export interface PendingMutation {
  fingerprint: string
  key: string
}

export function mutationKeyForDraft(
  current: PendingMutation | null,
  fingerprint: string,
  generate: () => string = () => crypto.randomUUID(),
): PendingMutation {
  if (current?.fingerprint === fingerprint) return current
  return { fingerprint, key: generate() }
}
