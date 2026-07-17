import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  MAX_TRANSCRIPT_BYTES,
  TranscriptRequestError,
  deleteTranscript,
  fetchTranscriptFile,
  getTranscript,
  transcriptMimeForFile,
  uploadTranscript,
  type TranscriptMeta,
} from '../../lib/transcripts';

type TranscriptAction = 'upload' | 'preview' | 'download' | 'delete';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorHint(error: unknown): string {
  if (!(error instanceof TranscriptRequestError)) return '成绩单服务暂时连不上，请稍后再试。';
  if (error.code === 'unsupported-file' || error.status === 415) {
    return '只支持 PDF、JPEG、PNG 或 WebP 格式。';
  }
  if (error.code === 'empty-file') return '这个文件是空的，请重新选择。';
  if (error.code === 'file-too-large' || error.status === 413) return '文件超过 8 MB，请压缩后再上传。';
  if (error.status === 401) return '登录状态已失效，请重新登录后再试。';
  if (error.status === 403) return '请先完成验证邮箱绑定，再上传成绩单。';
  if (error.status === 404) return '这份成绩单已不存在，请刷新后重新上传。';
  if (error.status === 429) return '操作太频繁了，请稍等片刻。';
  if (error.code === 'bad-response') return '服务器没有返回完整的成绩单信息，请刷新重试。';
  return '成绩单操作没有完成，请稍后再试。';
}

function displayBlob(blob: Blob, transcript: TranscriptMeta): Blob {
  return blob.type === transcript.mime ? blob : new Blob([blob], { type: transcript.mime });
}

export function useTranscriptUpload(enabled: boolean) {
  const [loading, setLoading] = useState(enabled);
  const [transcript, setTranscript] = useState<TranscriptMeta | null>(null);
  const [action, setAction] = useState<TranscriptAction | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emptyUploadRef = useRef<HTMLButtonElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const actionAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const releasePreview = useCallback((returnFocus = false) => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    if (returnFocus) window.requestAnimationFrame(() => previewButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setTranscript(null);
      releasePreview();
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setIssue(null);
    void getTranscript(ctrl.signal)
      .then((next) => { if (mountedRef.current) setTranscript(next); })
      .catch((error: unknown) => {
        if (mountedRef.current && !isAbortError(error)) setIssue(errorHint(error));
      })
      .finally(() => {
        if (mountedRef.current && !ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [enabled, releasePreview]);

  useEffect(() => {
    if (confirmingDelete) window.requestAnimationFrame(() => confirmDeleteRef.current?.focus());
  }, [confirmingDelete]);

  const beginAction = (next: TranscriptAction): AbortController => {
    actionAbortRef.current?.abort();
    const ctrl = new AbortController();
    actionAbortRef.current = ctrl;
    setAction(next);
    setIssue(null);
    setNotice(null);
    return ctrl;
  };

  const endAction = (ctrl: AbortController) => {
    if (actionAbortRef.current === ctrl) actionAbortRef.current = null;
    if (mountedRef.current && !ctrl.signal.aborted) setAction(null);
  };

  const chooseFile = () => {
    setIssue(null);
    setNotice(null);
    setConfirmingDelete(false);
    inputRef.current?.click();
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!transcriptMimeForFile(file)) return setIssue('只支持 PDF、JPEG、PNG 或 WebP 格式。');
    if (file.size <= 0) return setIssue('这个文件是空的，请重新选择。');
    if (file.size > MAX_TRANSCRIPT_BYTES) return setIssue('文件超过 8 MB，请压缩后再上传。');
    const replacing = transcript !== null;
    releasePreview();
    const ctrl = beginAction('upload');
    try {
      const uploaded = await uploadTranscript(file, ctrl.signal);
      if (!mountedRef.current || ctrl.signal.aborted) return;
      setTranscript(uploaded);
      setConfirmingDelete(false);
      setNotice(replacing ? '成绩单已替换，新档案已保存。' : '成绩单已上传并保存。');
      if (!replacing) window.requestAnimationFrame(() => previewButtonRef.current?.focus());
    } catch (error) {
      if (mountedRef.current && !isAbortError(error)) setIssue(errorHint(error));
    } finally { endAction(ctrl); }
  };

  const handlePreview = async () => {
    if (!transcript || action) return;
    if (previewUrl) return releasePreview();
    const ctrl = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = ctrl;
    setAction('preview');
    setIssue(null);
    setNotice(null);
    try {
      const blob = await fetchTranscriptFile(ctrl.signal);
      if (!mountedRef.current || ctrl.signal.aborted) return;
      const url = URL.createObjectURL(displayBlob(blob, transcript));
      if (!mountedRef.current || ctrl.signal.aborted) return URL.revokeObjectURL(url);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (error) {
      if (mountedRef.current && !isAbortError(error)) setIssue(errorHint(error));
    } finally {
      if (previewAbortRef.current === ctrl) previewAbortRef.current = null;
      if (mountedRef.current && !ctrl.signal.aborted) setAction(null);
    }
  };

  const handleDownload = async () => {
    if (!transcript || action) return;
    const ctrl = beginAction('download');
    try {
      const blob = await fetchTranscriptFile(ctrl.signal);
      if (!mountedRef.current || ctrl.signal.aborted) return;
      const url = URL.createObjectURL(displayBlob(blob, transcript));
      const link = Object.assign(document.createElement('a'), {
        href: url, download: transcript.name, hidden: true,
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('下载已开始。');
    } catch (error) {
      if (mountedRef.current && !isAbortError(error)) setIssue(errorHint(error));
    } finally { endAction(ctrl); }
  };

  const requestDelete = () => {
    setIssue(null);
    setNotice(null);
    setConfirmingDelete(true);
  };

  const cancelDelete = () => {
    setConfirmingDelete(false);
    window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
  };

  const handleDelete = async () => {
    if (!transcript || action) return;
    const ctrl = beginAction('delete');
    releasePreview();
    try {
      await deleteTranscript(ctrl.signal);
      if (!mountedRef.current || ctrl.signal.aborted) return;
      setTranscript(null);
      setConfirmingDelete(false);
      setNotice('成绩单已删除。');
      window.requestAnimationFrame(() => emptyUploadRef.current?.focus());
    } catch (error) {
      if (mountedRef.current && !isAbortError(error)) setIssue(errorHint(error));
    } finally { endAction(ctrl); }
  };

  return {
    loading, transcript, action, issue, notice, confirmingDelete, previewUrl,
    inputRef, emptyUploadRef, previewButtonRef, deleteButtonRef, confirmDeleteRef,
    chooseFile, handleFile, handlePreview, handleDownload,
    requestDelete, cancelDelete, handleDelete, releasePreview,
  };
}
