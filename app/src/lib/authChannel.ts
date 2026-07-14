/** 跨标签页只广播“鉴权已变化”，账号身份仍以网关 /me 为准。 */
const CHANNEL_NAME = 'xiaobai-auth';
const STORAGE_KEY = 'xiaobai-auth-revision';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function broadcastAuthChange(): void {
  const marker = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const activeChannel = getChannel();
  if (activeChannel) {
    activeChannel.postMessage(marker);
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, marker); } catch { /* 聚焦重验仍会兜底 */ }
}

export function subscribeAuthChanges(listener: () => void): () => void {
  const activeChannel = getChannel();
  if (activeChannel) {
    const onMessage = () => listener();
    activeChannel.addEventListener('message', onMessage);
    return () => activeChannel.removeEventListener('message', onMessage);
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
