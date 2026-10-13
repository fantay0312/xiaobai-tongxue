/** 科研台此刻能用什么：模型、文献连接器、Python、文件存储。探测结果短暂缓存，界面如实显示。 */
import { loadModelCatalog } from '../../lib/modelGateway';
import { pythonAvailable } from '../../lib/pyRuntime';
import { researchConnectorsAvailable } from '../../lib/researchConnectors';
import { storageMode } from './workspace';

export interface WorkbenchStatus {
  model: boolean;
  connectors: boolean;
  python: boolean;
  /** memory = IndexedDB 不可用，文件只在这次打开的页面里 */
  storage: 'indexeddb' | 'memory';
}

const TTL_MS = 30_000;
let cache: { at: number; value: WorkbenchStatus } | null = null;
let pending: Promise<WorkbenchStatus> | null = null;

const safe = <T,>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => fallback);

export function probeStatus(force = false): Promise<WorkbenchStatus> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  if (pending) return pending;
  pending = Promise.all([
    safe(loadModelCatalog().then((catalog) => catalog.available), false),
    safe(researchConnectorsAvailable(), false),
    safe(pythonAvailable(), false),
    safe(storageMode(), 'memory' as const),
  ]).then(([model, connectors, python, storage]) => {
    const value: WorkbenchStatus = { model, connectors, python, storage };
    cache = { at: Date.now(), value };
    pending = null;
    return value;
  });
  return pending;
}
