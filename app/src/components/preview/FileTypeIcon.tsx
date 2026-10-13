import {
  File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, Folder, Presentation,
  type LucideIcon,
} from 'lucide-react';
import { fileTone, type FileTone } from './fileKind';
import s from './preview.module.css';

const icons: Record<FileTone, LucideIcon> = {
  pdf: FileText, doc: FileType, slide: Presentation, sheet: FileSpreadsheet, image: FileImage, video: FileVideo, audio: FileAudio,
  code: FileCode, text: FileText, archive: FileArchive, other: File,
};

/** 按文件类型着色的图标块；folder 为真时显示文件夹。 */
export function FileTypeIcon({ name, mimeType, folder, size = 36, className }: {
  name: string; mimeType?: string; folder?: boolean; size?: number; className?: string;
}) {
  const tone = folder ? 'folder' : fileTone(name, mimeType);
  const Glyph = folder ? Folder : icons[tone as FileTone];
  return (
    <span className={`${s.typeIcon}${className ? ` ${className}` : ''}`} data-tone={tone} style={{ width: size, height: size }} aria-hidden="true">
      <Glyph size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  );
}
