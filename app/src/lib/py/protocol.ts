/**
 * 主线程（pyRuntime.ts）与 Worker（pyWorker.ts）之间的消息格式。
 * 只放类型，两边都用 import type 引入，不产生运行时依赖。
 */
import type { PyFile } from '../pyRuntime';

/** pyodide-lock.json 里 tool.xiaobai 的内容，由 scripts/fetch-pyodide.mjs 写入 */
export interface PyManifest {
  /** Pyodide 版本，也用来给本地缓存分版本 */
  pyodide: string;
  packages: string[];
  /** 随站文件 → 字节数与 sha256（十六进制） */
  files: Record<string, { size: number; sha256: string }>;
  /** 给 matplotlib 用的中文字体（相对 pyodide/ 的路径），没有就不配置 */
  font?: string;
}

export interface InitMessage {
  type: 'init';
  /** 运行环境文件所在目录的绝对地址，以 / 结尾 */
  base: string;
  /** 精简后的 pyodide-lock.json 原文 */
  lock: string;
  manifest: PyManifest;
  /** 预热时就下载并导入的包 */
  preload: string[];
}

export interface RunMessage {
  type: 'run';
  id: number;
  code: string;
  files: PyFile[];
}

export type ToWorker = InitMessage | RunMessage;

export interface RunOutcome {
  ok: boolean;
  stderr: string;
  result?: string;
  figures: string[];
  files: PyFile[];
  error?: string;
}

export type FromWorker =
  | { type: 'progress'; ratio: number; label: string }
  | { type: 'ready' }
  | { type: 'fail'; message: string }
  /** 依赖包已装好，用户代码开始执行（超时从这里算起） */
  | { type: 'started'; id: number }
  | { type: 'stdout'; id: number; text: string }
  | { type: 'done'; id: number; outcome: RunOutcome };
