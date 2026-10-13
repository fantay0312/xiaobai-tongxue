import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../deploy/deeptutor');
const PROGRESS_LABELS = new Set(['PLAN', 'CHECK', 'FINISH']);

export function createDeepTutorProvider({ enabled = false, python = path.join(runtime, '.runtime/venv/bin/python'), runner = path.join(runtime, 'runner.py'), model, baseUrl, apiKey } = {}) {
  let cached;
  let probing;
  const installed = () => enabled && existsSync(python) && existsSync(runner) && !!model && !!apiKey && !!baseUrl;
  function invoke(payload, signal, check = false, onProgress) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('study-cancelled'));
      const child = spawn(python, [runner, ...(check ? ['--check'] : [])], {
        cwd: runtime, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
      });
      let stdout = '';
      let lastLine = '';
      let received = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) { child.kill('SIGKILL'); reject(error); } else resolve(value);
      };
      const abort = () => finish(new Error('study-cancelled'));
      const timer = setTimeout(() => finish(new Error('study-timeout')), check ? 12000 : 115000);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(new Error('deeptutor-unavailable')));
      child.stdin.on('error', () => {});
      child.stderr.resume(); // Never expose provider credentials, upstream errors or thinking.
      child.stdout.setEncoding('utf8'); // 多字节中文可能被管道切开，交给解码器拼接
      child.stdout.on('data', (chunk) => {
        received += Buffer.byteLength(chunk);
        if (received > 96000) return finish(new Error('study-output-limit'));
        stdout += chunk;
        // NDJSON：每完成一轮一行 {"progress": 标签}，最后一行才是结果。
        for (let end = stdout.indexOf('\n'); end >= 0; end = stdout.indexOf('\n')) {
          const line = stdout.slice(0, end).trim();
          stdout = stdout.slice(end + 1);
          if (!line) continue;
          lastLine = line;
          if (!onProgress || settled) continue;
          try { const label = JSON.parse(line).progress; if (PROGRESS_LABELS.has(label)) onProgress(label); } catch { /* 结果行由 close 统一校验 */ }
        }
      });
      child.on('close', (code) => {
        if (code !== 0) return finish(new Error('deeptutor-failed'));
        try {
          const result = JSON.parse(stdout.trim() || lastLine);
          if (result.error || result.engine !== 'deeptutor') throw new Error();
          finish(null, result);
        } catch { finish(new Error('deeptutor-invalid-response')); }
      });
      child.stdin.end(check ? '' : JSON.stringify({ study: payload, model, baseUrl, apiKey }));
    });
  }
  return {
    async status() {
      if (!installed()) return { available: false, engine: 'deeptutor' };
      if (cached && Date.now() - cached.at < 30000) return cached.value;
      if (!probing) probing = (async () => {
        let value;
        try { const result = await invoke(null, undefined, true); value = { available: result.available === true, engine: 'deeptutor', version: result.version }; }
        catch { value = { available: false, engine: 'deeptutor' }; }
        cached = { at: Date.now(), value };
        return value;
      })().finally(() => { probing = null; });
      return probing;
    },
    /** onProgress 只收到 PLAN / CHECK / FINISH 标签，不含任何模型正文。 */
    async ask(payload, signal, onProgress) {
      if (!installed()) throw new Error('deeptutor-unavailable');
      const result = await invoke(payload, signal, false, typeof onProgress === 'function' ? onProgress : undefined);
      if (typeof result.content !== 'string' || !result.content.trim() || !Number.isInteger(result.rounds) || result.rounds < 1 || result.rounds > 4) throw new Error('deeptutor-invalid-response');
      return { content: result.content.slice(0, 16000), engine: 'deeptutor', version: String(result.version).slice(0, 30), rounds: result.rounds };
    },
  };
}
