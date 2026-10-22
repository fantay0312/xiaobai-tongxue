import { BookOpen, Plus } from 'lucide-react';

export function AddButton({ onClick, compact }: { onClick: () => void; compact?: boolean }) {
  return <button type="button" onClick={onClick} className={`lib-add${compact ? ' is-compact' : ''}`}>
    <BookOpen size={compact ? 22 : 26} aria-hidden />
    <span className="min-w-0 text-left"><span className="lib-add-title">导入书籍</span>
      {!compact && <span className="lib-add-sub">EPUB、PDF、TXT 或 Markdown</span>}
    </span>
    {!compact && <span className="lib-add-plus" aria-hidden><Plus size={15} strokeWidth={2.2} /></span>}
  </button>;
}
