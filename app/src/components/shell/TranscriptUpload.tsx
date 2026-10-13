import { Download, FileText, FolderOpen, Image as ImageIcon, Trash2, Upload, X } from 'lucide-react';
import { TRANSCRIPT_ACCEPT, type TranscriptMeta } from '../../lib/transcripts';
import { Badge, Button, IconButton, Spinner } from '../ui';
import { useTranscriptUpload } from './useTranscriptUpload';
import s from './TranscriptUpload.module.css';

interface TranscriptUploadProps {
  enabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function mimeLabel(mime: TranscriptMeta['mime']): string {
  if (mime === 'application/pdf') return 'PDF 文档';
  if (mime === 'image/png') return 'PNG 图片';
  if (mime === 'image/webp') return 'WebP 图片';
  return 'JPEG 图片';
}

export function TranscriptUpload({ enabled = true }: TranscriptUploadProps) {
  const model = useTranscriptUpload(enabled);
  if (!enabled) {
    return (
      <div className={s.restricted}>
        <span className={s.emptyMark} aria-hidden="true"><FolderOpen size={20} strokeWidth={1.75} /></span>
        <p>完成验证邮箱绑定后，就可以在这里上传与管理自己的成绩单。</p>
      </div>
    );
  }

  const { transcript, action, previewUrl } = model;
  const busy = action !== null;
  const isImage = transcript?.mime.startsWith('image/') ?? false;
  const FileGlyph = isImage ? ImageIcon : FileText;
  return (
    <div className={s.root} aria-busy={model.loading || busy}>
      <input
        ref={model.inputRef}
        className={s.fileInput}
        type="file"
        accept={TRANSCRIPT_ACCEPT}
        tabIndex={-1}
        onChange={(event) => void model.handleFile(event)}
        aria-label="选择要上传的成绩单"
      />

      {model.loading ? (
        <p className={s.loading} role="status">
          <Spinner size={15} />正在读取你的成绩单…
        </p>
      ) : transcript ? (
        <article className={s.record} aria-label={`已上传成绩单：${transcript.name}`}>
          <div className={s.fileRow}>
            <span className={s.fileGlyph} data-image={isImage || undefined} aria-hidden="true">
              <FileGlyph size={20} strokeWidth={1.75} />
            </span>
            <div className={s.fileCopy}>
              <strong title={transcript.name}>{transcript.name}</strong>
              <span>
                {mimeLabel(transcript.mime)} · {formatBytes(transcript.size)} · {formatUpdatedAt(transcript.updatedAt)}
              </span>
            </div>
            <Badge tone="ok" dot className={s.archiveBadge}>已归档</Badge>
          </div>

          <div className={s.actions} aria-label="成绩单操作">
            <Button
              ref={model.previewButtonRef}
              variant="outline"
              size="sm"
              icon={<FileGlyph size={14} strokeWidth={1.75} />}
              disabled={busy}
              onClick={() => void model.handlePreview()}
            >
              {action === 'preview' ? '正在准备…' : previewUrl ? '收起预览' : '预览'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Download size={14} strokeWidth={1.75} />}
              disabled={busy}
              onClick={() => void model.handleDownload()}
            >
              {action === 'download' ? '正在准备…' : '下载'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Upload size={14} strokeWidth={1.75} />}
              disabled={busy}
              onClick={model.chooseFile}
            >
              {action === 'upload' ? '正在上传…' : '替换'}
            </Button>
            <Button
              ref={model.deleteButtonRef}
              className={s.deleteBtn}
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} strokeWidth={1.75} />}
              disabled={busy}
              aria-expanded={model.confirmingDelete}
              aria-controls="transcript-delete-confirm"
              onClick={model.requestDelete}
            >
              删除
            </Button>
          </div>

          {model.confirmingDelete ? (
            <div className={s.confirm} id="transcript-delete-confirm" role="group" aria-labelledby="transcript-delete-copy">
              <p id="transcript-delete-copy">删除后无法恢复，之后可以重新上传。</p>
              <div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={model.cancelDelete}>取消</Button>
                <Button
                  ref={model.confirmDeleteRef}
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void model.handleDelete()}
                >
                  {action === 'delete' ? '正在删除…' : '确认删除'}
                </Button>
              </div>
            </div>
          ) : null}
        </article>
      ) : (
        <div className={s.empty}>
          <span className={s.emptyMark} aria-hidden="true"><FolderOpen size={20} strokeWidth={1.75} /></span>
          <div className={s.emptyCopy}>
            <strong>还没有成绩单</strong>
            <p>上传 PDF 或图片，单个文件不超过 8 MB。</p>
          </div>
          <Button
            ref={model.emptyUploadRef}
            variant="solid"
            icon={<Upload size={15} strokeWidth={1.75} />}
            disabled={busy}
            onClick={model.chooseFile}
          >
            {action === 'upload' ? '正在上传…' : '上传成绩单'}
          </Button>
        </div>
      )}

      {previewUrl && transcript ? (
        <section className={s.preview} aria-labelledby="transcript-preview-title">
          <header>
            <div>
              <strong id="transcript-preview-title">成绩单预览</strong>
              <span>{transcript.name}</span>
            </div>
            <IconButton label="收起成绩单预览" size="sm" onClick={() => model.releasePreview(true)}>
              <X size={16} strokeWidth={1.75} />
            </IconButton>
          </header>
          {isImage ? (
            <img src={previewUrl} alt={`成绩单预览：${transcript.name}`} />
          ) : (
            <iframe
              src={previewUrl}
              title={`成绩单预览：${transcript.name}`}
              sandbox=""
              referrerPolicy="no-referrer"
            />
          )}
        </section>
      ) : null}

      <div className={s.feedback} aria-live="polite" aria-atomic="true">
        {model.notice ? <p className={s.notice}>{model.notice}</p> : null}
      </div>
      {model.issue ? <p className={s.issue} role="alert">{model.issue}</p> : null}
    </div>
  );
}
