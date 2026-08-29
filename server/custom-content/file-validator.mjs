import path from 'node:path';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./file-validator-worker.mjs', import.meta.url);
const WORKER_TIMEOUT_MS = 45_000;

function workerError(code, status = 500) {
  const error = new Error(code);
  error.status = status;
  return error;
}

export async function validateUploadedFile({ bytes, filename, maximum, validateInProcess }) {
  const extension = path.extname(filename).toLowerCase();
  if (extension !== '.docx' && extension !== '.pptx') {
    return { ...validateInProcess(bytes, filename, maximum), bytes };
  }
  const expectedLength = bytes.length;
  let transferable = bytes.buffer instanceof ArrayBuffer && bytes.buffer.byteLength >= 64 * 1024;
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, {
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(workerError('file-validation-timeout', 503));
    }, WORKER_TIMEOUT_MS);
    timer.unref?.();
    const finish = (task) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      task();
    };
    worker.once('message', (message) => finish(() => {
      if (!message?.ok) {
        reject(workerError(String(message?.error ?? 'file-content-mismatch'), Number(message?.status) || 415));
        return;
      }
      if (transferable && message.bytes?.byteLength !== expectedLength) {
        reject(workerError('file-validation-failed', 503));
        return;
      }
      const returned = transferable
        ? Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength)
        : bytes;
      resolve({ ...message.result, bytes: returned });
    }));
    worker.once('error', () => finish(() => reject(workerError('file-validation-failed', 503))));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(workerError('file-validation-failed', 503)));
    });
    try {
      worker.postMessage(
        { bytes, filename, maximum, returnBytes: transferable },
        transferable ? [bytes.buffer] : [],
      );
    } catch (error) {
      if (error?.name !== 'DataCloneError' || !transferable) {
        finish(() => reject(workerError('file-validation-failed', 503)));
        return;
      }
      transferable = false;
      try {
        worker.postMessage({ bytes, filename, maximum, returnBytes: false });
      } catch {
        finish(() => reject(workerError('file-validation-failed', 503)));
      }
    }
  });
}
