/**
 * 按账号服务器存档同步 —— 登录态下学习数据与网关 /api/state 保持一致,换设备登录即还原。
 * 载荷 = { global, events, reports } 三件:
 *   拉:登录/会话恢复(authed)时取回服务器档 —— 有档 → 覆盖本地并重放派生态;
 *      无档 → 本地数据归属当前账号(lastSyncUser 相同或从未同步)则上传认领,
 *      归属别的账号则清空重开(换号登录不把上一位老师的学习史带进新账号)。
 *   推:appStore 三件变化后去抖 3s PUT;失败退避重试;页面隐藏时尽力冲刷。
 * 防互踩:PUT 带 baseVersion(上次见到的服务器 updatedAt),不符则 409 —— 客户端拉回远端档,
 *   按 id 并集合并 events/reports 后重推(双开页签/两台设备同时用,谁都不清掉谁)。
 * 守门:拉档没成功或旧账号尚未补录邮箱时一律不拉不推 —— 未验证会话与空档新机器都不许碰服务器档。
 * 纪律:settings/asrSettings(含密钥)永不进载荷;live(进行中会话)不同步;
 *      standalone(无网关)完全旁路,离线演示行为与从前一字不差。
 */
import { DEFAULT_GLOBAL, useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import { API_BASE, gatewayFetch } from '../lib/api';
import { TOPICS } from '../data';
// 进化派生(升期):不进 barrel 的纯函数,按路径直连
import { deriveEvolution } from '../engine/evolution';
import type { LearnEvent, SessionReport, XiaobaiGlobal } from '../types';

const LAST_USER_KEY = 'xiaobai-sync-user';
const DEBOUNCE_MS = 3000;
const RETRY_MS = 15_000;
/** Chrome 对 keepalive 请求体的硬限 ≈64KB(按字节),超限的档退回常规 fetch(尽力而为) */
const KEEPALIVE_LIMIT = 60 * 1024;

interface SyncPayload {
  global: XiaobaiGlobal;
  events: LearnEvent[];
  reports: SessionReport[];
}

let applyingRemote = false; // 正在把服务器档灌回本地:期间的 store 变化不回推
let pushTimer = 0;
let dirty = false;
let started = false;
/** 账号/鉴权状态真正变化时递增；所有在飞响应落地前必须核对。 */
let syncGeneration = 0;
let observedAuthKey: string | null = null;
/** 拉档成功后才等于当前账号名:是"允许推送"的闸门(空档新机不许覆写服务器老档) */
let syncedUser: string | null = null;
/** 上次见到的服务器档版本(updatedAt),PUT 时作为 baseVersion 防互踩 */
let serverVersion: string | null = null;

function syncIsCurrent(generation: number, user: string): boolean {
  const auth = useAuthStore.getState();
  return generation === syncGeneration && auth.status === 'authed'
    && auth.user === user && !auth.emailBindingRequired;
}

function snapshot(): SyncPayload {
  const s = useAppStore.getState();
  return { global: s.global, events: s.events, reports: s.reports };
}

/** 远端档消毒:字段缺失/被手工改坏时以默认值补齐、坏行丢弃——档坏最多丢数据,不许砸崩页面 */
function sanitize(remote: Partial<SyncPayload>): SyncPayload {
  const global: XiaobaiGlobal = {
    ...DEFAULT_GLOBAL,
    ...(remote.global && typeof remote.global === 'object' ? remote.global : {}),
  };
  if (!Array.isArray(global.relationshipMemory)) global.relationshipMemory = [];
  if (!Array.isArray(global.goldenAnalogies)) global.goldenAnalogies = [];
  // 事件行必须五脏俱全(id/t/type/topicId/payload):派生层(重放/回忆/成就)默认这些字段在
  const events = (Array.isArray(remote.events) ? remote.events : [])
    .filter((e): e is LearnEvent => {
      const ev = e as LearnEvent | null;
      return !!ev && typeof ev === 'object'
        && typeof ev.id === 'string' && typeof ev.t === 'string'
        && typeof ev.type === 'string' && typeof ev.topicId === 'string'
        && !!ev.payload && typeof ev.payload === 'object';
    });
  const reports = (Array.isArray(remote.reports) ? remote.reports : [])
    .filter((r): r is SessionReport => !!r && typeof r === 'object');
  // 远端旧规则档拉档即校准:按进化新规则(跨课程广度)从消毒后的事件流重算修行阶
  // (topicsMastered 是历史累计计数、不受广度影响,留存不动)
  global.learningLevel = deriveEvolution(events, TOPICS).stage;
  return { global, events, reports };
}

/** 409 冲突时的并集合并:events/reports 按 id 并集(时间序),global 留本地(最新操作在本机) */
function mergeRemote(remote: SyncPayload): void {
  const cur = useAppStore.getState();
  const seenE = new Set(cur.events.map((e) => e.id));
  const events = [...cur.events, ...remote.events.filter((e) => !seenE.has(e.id))]
    .sort((a, b) => a.t.localeCompare(b.t));
  const seenR = new Set(cur.reports.map((r) => r.sessionId));
  const reports = [...cur.reports, ...remote.reports.filter((r) => !seenR.has(r.sessionId))]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  applyingRemote = true;
  try {
    useAppStore.setState({
      events,
      reports,
      topicStates: {},
      // 修行阶 = 事件流的纯派生:并集后的事件可能带来别台设备的出师,按合并流重算,
      // 否则重推的快照会是"学识与修行阶自相矛盾"的档(不变式:learningLevel ≡ deriveEvolution(events).stage)
      global: { ...cur.global, learningLevel: deriveEvolution(events, TOPICS).stage },
    });
    useAppStore.getState().rebuildStates();
  } finally {
    applyingRemote = false;
  }
}

async function fetchRemote(): Promise<{ state: Partial<SyncPayload> | null; updatedAt: string | null } | null> {
  try {
    const res = await gatewayFetch(`${API_BASE}/state`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const doc = data as { state?: unknown; updatedAt?: unknown };
    return {
      state: doc?.state && typeof doc.state === 'object' ? (doc.state as Partial<SyncPayload>) : null,
      updatedAt: typeof doc?.updatedAt === 'string' ? doc.updatedAt : null,
    };
  } catch {
    return null;
  }
}

async function push(useKeepalive = false, isRetryAfterConflict = false): Promise<void> {
  // 闸门:必须是"已完成拉档"的当前账号才许推——防空档新机覆写、防换号期间的旧定时器串档
  const user = syncedUser;
  const generation = syncGeneration;
  if (!user || !syncIsCurrent(generation, user)) return;
  dirty = false;
  const body = JSON.stringify({ state: snapshot(), baseVersion: serverVersion });
  const bytes = new Blob([body]).size;
  try {
    const res = await gatewayFetch(`${API_BASE}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(useKeepalive && bytes <= KEEPALIVE_LIMIT ? { keepalive: true } : {}),
    });
    if (!syncIsCurrent(generation, user)) return;
    if (res.status === 409 && !isRetryAfterConflict) {
      // 别的页签/设备先写了:拉回远端并集合并,换新版本号重推一次
      const remote = await fetchRemote();
      if (!syncIsCurrent(generation, user)) return;
      if (remote?.state) {
        mergeRemote(sanitize(remote.state));
        serverVersion = remote.updatedAt;
        return push(false, true);
      }
      dirty = true;
      return;
    }
    if (res.status === 401) return;
    if (!res.ok) {
      dirty = true;
      scheduleRetry();
      return;
    }
    const data: unknown = await res.json().catch(() => null);
    if (!syncIsCurrent(generation, user)) return;
    const updatedAt = (data as { updatedAt?: unknown })?.updatedAt;
    if (typeof updatedAt === 'string') serverVersion = updatedAt;
  } catch {
    if (!syncIsCurrent(generation, user)) return;
    dirty = true; // 离线:退避后重试,或等下一次变化
    scheduleRetry();
  }
}

function schedulePush(delay = DEBOUNCE_MS): void {
  dirty = true;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(), delay);
}

function scheduleRetry(): void {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    if (dirty) void push();
  }, RETRY_MS);
}

function flushNow(): void {
  if (!dirty) return;
  window.clearTimeout(pushTimer);
  void push(true);
}

/** 登录/会话恢复:先拉服务器档,决定谁覆盖谁;成功后才开推送闸门 */
async function adopt(user: string, generation: number): Promise<boolean> {
  const remote = await fetchRemote();
  if (!syncIsCurrent(generation, user)) return false;
  if (!remote) return false; // 拉档失败:闸门不开,这一轮完全不同步

  if (remote.state) {
    const clean = sanitize(remote.state);
    applyingRemote = true;
    try {
      useAppStore.setState({ ...clean, topicStates: {}, live: null });
      useAppStore.getState().rebuildStates();
    } finally {
      applyingRemote = false;
    }
    serverVersion = remote.updatedAt;
    syncedUser = user;
  } else {
    // 服务器无档:本地若是别的账号留下的学习史,清空再认领
    let lastUser: string | null = null;
    let ownerKnown = true;
    try { lastUser = localStorage.getItem(LAST_USER_KEY); } catch { ownerKnown = false; }
    if (!syncIsCurrent(generation, user)) return false;
    if (!ownerKnown || (lastUser && lastUser.toLowerCase() !== user.toLowerCase())) {
      applyingRemote = true;
      try {
        useAppStore.getState().resetAll();
      } finally {
        applyingRemote = false;
      }
    }
    serverVersion = null;
    syncedUser = user; // 先开闸门再首推(push 闸门要看它)
    await push();
    if (!syncIsCurrent(generation, user)) return false;
  }
  if (!syncIsCurrent(generation, user)) return false;
  try { localStorage.setItem(LAST_USER_KEY, user); } catch { /* 存储不可用:仅失去归属检查 */ }
  return true;
}

/** App 启动时装一次:订阅两个 store,拉/推自动进行 */
export function initStateSync(): void {
  if (started) return;
  started = true;

  let adoptRetryTimer = 0;
  const onAuth = (status: string, user: string | null, emailBindingRequired: boolean) => {
    const authKey = `${status}\0${user ?? ''}\0${emailBindingRequired ? 'restricted' : 'ready'}`;
    if (authKey === observedAuthKey) return;
    observedAuthKey = authKey;
    syncGeneration += 1;
    // 任何登录态变化都先掐掉挂起的推送:旧账号的去抖定时器绝不许在新账号会话里开火
    window.clearTimeout(pushTimer);
    window.clearTimeout(adoptRetryTimer);
    dirty = false;
    if (status === 'authed' && user && !emailBindingRequired) {
      if (syncedUser !== user) {
        syncedUser = null;
        serverVersion = null;
        const tryAdopt = () => {
          const generation = syncGeneration;
          if (!syncIsCurrent(generation, user)) return;
          void adopt(user, generation).then((ok) => {
            // 拉档失败(断网/网关重启):30s 后再试,直到成功或登出
            if (!ok && syncIsCurrent(generation, user)) {
              adoptRetryTimer = window.setTimeout(tryAdopt, 30_000);
            }
          });
        };
        tryAdopt();
      }
    } else {
      syncedUser = null;
      serverVersion = null;
    }
  };
  useAuthStore.subscribe((s) => onAuth(s.status, s.user, s.emailBindingRequired));
  // initStateSync 装载时会话可能已恢复(装载顺序/HMR),补一次当前态
  const auth = useAuthStore.getState();
  onAuth(auth.status, auth.user, auth.emailBindingRequired);

  useAppStore.subscribe((state, prev) => {
    if (applyingRemote) return;
    const auth = useAuthStore.getState();
    if (auth.status !== 'authed' || auth.emailBindingRequired) return;
    if (state.global === prev.global && state.events === prev.events && state.reports === prev.reports) return;
    schedulePush();
  });

  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}
