import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../deploy/deeptutor');

export function createDeepTutorProvider({ enabled = false, python = path.join(runtime, '.runtime/venv/bin/python'), runner = path.join(runtime, 'runner.py'), model, baseUrl, apiKey } = {}) {
  let cached;
  let probing;
  const installed = () => enabled && existsSync(python) && existsSync(runner) && !!model && !!apiKey && !!baseUrl;
  function invoke(payload, signal, check = false) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('study-cancelled'));
      const child = spawn(python, [runner, ...(check ? ['--check'] : [])], {
        cwd: runtime, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
      });
      let stdout = '';
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
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout) > 96000) finish(new Error('study-output-limit'));
      });
      child.on('close', (code) => {
        if (code !== 0) return finish(new Error('deeptutor-failed'));
        try {
          const result = JSON.parse(stdout);
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
    async ask(payload, signal) {
      if (!installed()) throw new Error('deeptutor-unavailable');
      const result = await invoke(payload, signal);
      if (typeof result.content !== 'string' || !result.content.trim() || !Number.isInteger(result.rounds) || result.rounds < 1 || result.rounds > 4) throw new Error('deeptutor-invalid-response');
      return { content: result.content.slice(0, 16000), engine: 'deeptutor', version: String(result.version).slice(0, 30), rounds: result.rounds };
    },
  };
}
