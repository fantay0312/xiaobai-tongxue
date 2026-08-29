import { parentPort } from 'node:worker_threads';
import { validateFileInProcess } from './service.mjs';

if (!parentPort) throw new Error('file-validator-worker-parent-required');

parentPort.once('message', ({ bytes, filename, maximum, returnBytes }) => {
  const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const result = validateFileInProcess(body, filename, maximum);
    parentPort.postMessage(
      { ok: true, result, ...(returnBytes ? { bytes: body } : {}) },
      returnBytes ? [body.buffer] : [],
    );
  } catch (error) {
    parentPort.postMessage(
      {
        ok: false,
        error: String(error?.message ?? 'file-content-mismatch'),
        status: Number(error?.status) || 415,
        ...(returnBytes ? { bytes: body } : {}),
      },
      returnBytes ? [body.buffer] : [],
    );
  }
});
