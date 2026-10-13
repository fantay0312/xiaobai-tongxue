/**
 * 文件预览器：全屏浮层，按类型选择渲染器。
 * 文件内容由调用方的 load() 提供（一次下载为 Blob），预览、下载共用同一份。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog as RDialog } from 'radix-ui';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Ellipsis, HardDriveDownload, MessageSquarePlus, ScanText, X } from 'lucide-react';
import { Button, Empty, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Segmented, toast, type SegmentOption } from '../ui';
import { saveBlob } from '../../lib/notebookMedia';
import { fileKind, formatSize, kindLabel, withAccurateType, type FileKind } from './fileKind';
import { FileTypeIcon } from './FileTypeIcon';
import { MediaPlayer } from './MediaPlayer';
import { PdfViewer } from './PdfViewer';
import { DocxView, ImageView, ParsedTextView, PptxView, StageLoading, TextView, ViewerError } from './viewers';
import s from './preview.module.css';

export interface PreviewFile { id: string; name: string; mimeType?: string; size?: number }

export interface FilePreviewProps {
  file: PreviewFile;
  /** 下载文件内容；每次打开或重试时调用一次 */
  load: () => Promise<Blob>;
  onClose: () => void;
  /** 上一份 / 下一份（当前文件夹内），不传则不显示 */
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
  onUseInConversation?: () => void;
  /** 有解析结果时提供，出现「解析文本」页签 */
  loadParsedText?: () => Promise<string>;
  /** 「详情」页签内容，由调用方提供 */
  details?: ReactNode;
  /** 文件名旁的状态标记 */
  status?: ReactNode;
  /** 时间点笔记保存到谁名下 */
  noteOwner?: string | null;
  /** 标题；不给就用文件名。生成的内容用它自己的标题 */
  title?: string;
  /** 标题下的说明；不给就是「类型 · 大小」 */
  subtitle?: string;
  /** 替换文件类型图标 */
  icon?: ReactNode;
  /** 头部主动作，如「打开」跳到它所在的板块 */
  primaryAction?: { label: string; icon?: ReactNode; onClick: () => void };
  /** 追加到「更多」菜单里的项（MenuItem） */
  menuItems?: ReactNode;
  /** 下载按钮的说法；生成的内容叫「导出」 */
  downloadLabel?: string;
}

type Pane = 'preview' | 'parsed' | 'details';
type LoadState = { phase: 'idle' } | { phase: 'loading' } | { phase: 'ready'; blob: Blob } | { phase: 'error'; message: string };

/** 超过这个体积不自动下载，先提示再按需加载 */
const AUTO_LIMIT: Partial<Record<FileKind, number>> = {
  pdf: 40 * 1024 ** 2, image: 30 * 1024 ** 2, video: 60 * 1024 ** 2, audio: 60 * 1024 ** 2,
  docx: 25 * 1024 ** 2, pptx: 40 * 1024 ** 2,
  markdown: 2 * 1024 ** 2, text: 2 * 1024 ** 2, code: 2 * 1024 ** 2, json: 2 * 1024 ** 2, csv: 2 * 1024 ** 2,
};

export function FilePreview(props: FilePreviewProps) {
  const { onClose, onPrev, onNext } = props;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // 输入框、进度条、分段控件自己要用方向键
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="radiogroup"], [role="menu"]')) return;
    const go = event.key === 'ArrowLeft' ? onPrev : onNext;
    if (go) { event.preventDefault(); go(); }
  };
  return (
    <RDialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <RDialog.Portal>
        <RDialog.Overlay className={s.overlay} />
        <RDialog.Content className={s.panel} aria-describedby={undefined} onKeyDown={onKeyDown} onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus(); }}>
          <PreviewSession key={props.file.id} {...props} />
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function PreviewSession({
  file, load, onClose, onPrev, onNext, position, onUseInConversation, loadParsedText, details, status, noteOwner = null,
  title, subtitle, icon, primaryAction, menuItems, downloadLabel = '下载',
}: FilePreviewProps) {
  const kind = fileKind(file.name, file.mimeType);
  const limit = AUTO_LIMIT[kind];
  const renderable = limit !== undefined;
  const oversized = renderable && (file.size ?? 0) > limit;
  const [state, setState] = useState<LoadState>({ phase: renderable && !oversized ? 'loading' : 'idle' });
  const [pane, setPane] = useState<Pane>('preview');
  const [saving, setSaving] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const tokenRef = useRef(0);
  const pendingRef = useRef<Promise<Blob> | null>(null);

  /** 取文件内容：进行中的下载复用同一次请求 */
  const fetchBlob = (): Promise<Blob> => {
    if (!pendingRef.current) {
      const request = loadRef.current().then((blob) => withAccurateType(blob, file.name, file.mimeType));
      pendingRef.current = request;
      request.catch(() => { if (pendingRef.current === request) pendingRef.current = null; });
    }
    return pendingRef.current;
  };
  const start = () => {
    const token = ++tokenRef.current;
    setState({ phase: 'loading' });
    fetchBlob().then(
      (blob) => { if (tokenRef.current === token) setState({ phase: 'ready', blob }); },
      (reason: unknown) => { if (tokenRef.current === token) setState({ phase: 'error', message: reason instanceof Error ? reason.message : '文件下载失败，请检查连接后重试。' }); },
    );
  };
  useEffect(() => {
    if (renderable && !oversized) start();
    return () => { tokenRef.current += 1; };
    // 只在打开这份文件时触发一次
  }, []);

  const download = () => {
    if (saving) return;
    if (state.phase === 'ready') { saveBlob(file.name, state.blob); return; }
    setSaving(true);
    fetchBlob()
      .then((blob) => saveBlob(file.name, blob))
      .catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : '下载失败，请重试。'))
      .finally(() => setSaving(false));
  };

  const panes: SegmentOption<Pane>[] = [
    { value: 'preview', label: '预览' },
    ...(loadParsedText ? [{ value: 'parsed' as const, label: '解析文本' }] : []),
    ...(details ? [{ value: 'details' as const, label: '详情' }] : []),
  ];
  const activePane = panes.some((item) => item.value === pane) ? pane : 'preview';
  const sizeText = file.size === undefined ? '' : formatSize(file.size);
  const heading = title ?? file.name;
  const metaText = subtitle ?? [kindLabel(file.name, file.mimeType), sizeText].filter(Boolean).join(' · ');
  // 手机上头部按钮都收进「更多」；桌面只在调用方追加了菜单项时才出现，且不重复头部已有的按钮
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

  const renderPreview = () => {
    if (!renderable) {
      return (
        <div className={s.stageCenter}>
          <div className={s.fallback}>
            <FileTypeIcon name={file.name} mimeType={file.mimeType} size={64} />
            <h3>{file.name}</h3>
            <p>{[kindLabel(file.name, file.mimeType), sizeText].filter(Boolean).join(' · ')}</p>
            <p className={s.fallbackNote}>
              {kind === 'office' ? '旧版办公文档暂不支持在线预览，可下载后用本机软件打开。' : '这种格式暂不支持在线预览，可下载后查看。'}
              {loadParsedText ? '已有解析结果，可直接阅读解析文本。' : ''}
            </p>
            <div className={s.fallbackActions}>
              <Button variant="solid" icon={<Download size={15} />} loading={saving} onClick={download}>下载原件</Button>
              {loadParsedText && <Button variant="outline" icon={<ScanText size={15} />} onClick={() => setPane('parsed')}>看解析文本</Button>}
            </div>
          </div>
        </div>
      );
    }
    if (state.phase === 'idle') {
      return (
        <div className={s.stageCenter}>
          <Empty
            icon={<HardDriveDownload size={22} strokeWidth={1.75} />}
            title={`文件较大（${sizeText}）`}
            description="预览需要先把整份文件下载到浏览器，可能要等一会儿。"
            action={(
              <>
                <Button variant="solid" onClick={start}>加载预览</Button>
                <Button variant="outline" icon={<Download size={15} />} loading={saving} onClick={download}>下载原件</Button>
              </>
            )}
          />
        </div>
      );
    }
    if (state.phase === 'loading') return <StageLoading label={sizeText ? `正在加载预览（${sizeText}）…` : '正在加载预览…'} />;
    if (state.phase === 'error') return <ViewerError title="预览加载失败" description={state.message} onRetry={start} />;
    const { blob } = state;
    if (kind === 'pdf') return <PdfViewer blob={blob} name={file.name} onDownload={download} />;
    if (kind === 'image') return <ImageView blob={blob} name={file.name} onDownload={download} />;
    if (kind === 'video' || kind === 'audio') return <MediaPlayer blob={blob} kind={kind} file={file} owner={noteOwner} onDownload={download} />;
    if (kind === 'docx') return <DocxView blob={blob} onDownload={download} />;
    if (kind === 'pptx') return <PptxView blob={blob} onDownload={download} />;
    return <TextView blob={blob} kind={kind} name={file.name} onDownload={download} />;
  };

  return (
    <>
      <header className={s.head}>
        {/* 手机上预览铺满全屏：左上角返回，其余操作收进「更多」 */}
        <IconButton label="返回" tip={false} className={s.headBack} onClick={onClose}><ArrowLeft size={18} /></IconButton>
        {icon ? <span className={s.headIconSlot}>{icon}</span> : <FileTypeIcon name={file.name} mimeType={file.mimeType} size={36} className={s.headIcon} />}
        <div className={s.headText}>
          <RDialog.Title className={s.title} title={heading}>{heading}</RDialog.Title>
          <p className={s.meta}>
            <span>{metaText}</span>
            {status}
          </p>
        </div>
        <div className={s.headActions}>
          {(onPrev || onNext || position) && (
            <div className={s.pager}>
              <IconButton label="上一份" shortcut="←" size="sm" tip="bottom" disabled={!onPrev} onClick={onPrev}><ChevronLeft size={16} /></IconButton>
              {position && <span className={s.pagerText}>{position.index + 1} / {position.total}</span>}
              <IconButton label="下一份" shortcut="→" size="sm" tip="bottom" disabled={!onNext} onClick={onNext}><ChevronRight size={16} /></IconButton>
            </div>
          )}
          {primaryAction && (
            <Button variant="solid" className={s.headButton} icon={primaryAction.icon} aria-label={primaryAction.label} onClick={primaryAction.onClick}><span>{primaryAction.label}</span></Button>
          )}
          {onUseInConversation && (
            <Button variant="soft" className={s.headButton} icon={<MessageSquarePlus size={15} />} aria-label="用于对话" onClick={onUseInConversation}><span>用于对话</span></Button>
          )}
          <Button variant="outline" className={s.headButton} icon={<Download size={15} />} aria-label={downloadLabel} loading={saving} onClick={download}><span>{downloadLabel}</span></Button>
          <Menu modal={false}>
            <MenuTrigger asChild>
              <IconButton label="更多操作" tip={false} className={s.headMore} data-extra={menuItems ? '' : undefined}><Ellipsis size={18} /></IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              {narrow && (
                <>
                  {position && <MenuLabel>第 {position.index + 1} 份，共 {position.total} 份</MenuLabel>}
                  {(onPrev || onNext) && (
                    <>
                      <MenuItem icon={<ChevronLeft size={15} />} disabled={!onPrev} onSelect={() => onPrev?.()}>上一份</MenuItem>
                      <MenuItem icon={<ChevronRight size={15} />} disabled={!onNext} onSelect={() => onNext?.()}>下一份</MenuItem>
                      <MenuSeparator />
                    </>
                  )}
                  {primaryAction && <MenuItem icon={primaryAction.icon} onSelect={primaryAction.onClick}>{primaryAction.label}</MenuItem>}
                  {onUseInConversation && <MenuItem icon={<MessageSquarePlus size={15} />} onSelect={onUseInConversation}>用于对话</MenuItem>}
                  <MenuItem icon={<Download size={15} />} disabled={saving} onSelect={download}>{downloadLabel === '下载' ? '下载原件' : downloadLabel}</MenuItem>
                  {menuItems && <MenuSeparator />}
                </>
              )}
              {menuItems}
            </MenuContent>
          </Menu>
          <IconButton label="关闭预览" shortcut="Esc" tip="bottom" className={s.headClose} onClick={onClose}><X size={18} /></IconButton>
        </div>
      </header>

      {panes.length > 1 && (
        <div className={s.paneBar}>
          <Segmented size="sm" label="预览内容" value={activePane} onChange={setPane} options={panes} />
        </div>
      )}

      <div className={s.stage} data-pane={activePane}>
        {/* 预览保持挂载：切到其他页签再回来，视频进度和缩放不丢 */}
        <div className={s.stageLayer} hidden={activePane !== 'preview'}>{renderPreview()}</div>
        {activePane === 'parsed' && loadParsedText && <div className={s.stageLayer}><ParsedTextView load={loadParsedText} /></div>}
        {activePane === 'details' && details && <div className={s.stageLayer}><div className={s.docStage}><div className={s.detailsPane}>{details}</div></div></div>}
      </div>
    </>
  );
}
