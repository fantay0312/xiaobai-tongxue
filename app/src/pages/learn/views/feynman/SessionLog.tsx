/**
 * 课堂记录：最近几堂课的分数、落下的印、降服的心魔，以及答卷和批注的入口。
 */
import { FileCheck2, PenLine, Presentation } from 'lucide-react';
import { Badge, Button, Empty, Tip } from '../../../../components/ui';
import type { SessionRecord } from './data';
import s from './feynman.module.css';

interface Props {
  records: SessionRecord[];
  total: number;
  onOpen: (to: string) => void;
}

function scoreTone(score: number): 'ok' | 'accent' | 'warn' {
  if (score >= 80) return 'ok';
  if (score >= 60) return 'accent';
  return 'warn';
}

export function SessionLog({ records, total, onOpen }: Props) {
  return (
    <section className={s.section} aria-labelledby="feynman-log-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-log-title" className={s.sectionTitle}>课堂记录</h2>
          <p className={s.sectionNote}>
            {total > 0 ? `共上过 ${total} 堂课${total > records.length ? `，这里是最近 ${records.length} 堂` : ''}` : '每堂课的答卷和批注都留在这里'}
          </p>
        </div>
        {total > records.length && (
          <Button variant="ghost" size="sm" onClick={() => onOpen('/growth')}>去成长册看全部</Button>
        )}
      </header>

      {records.length === 0 ? (
        <div className={s.panel}>
          <Empty
            icon={<Presentation size={20} strokeWidth={1.75} />}
            title="还没有课堂记录"
            description="上完第一堂课，小白的答卷、批注和他写的日记都会出现在这里。"
          />
        </div>
      ) : (
        <ul className={s.panel}>
          {records.map((record) => {
            const { report } = record;
            return (
              <li key={report.sessionId} className={s.logRow}>
                <div className={s.logMain}>
                  <p className={s.logTitle}>
                    <b>{record.title}</b>
                    <span>{record.when} · {record.modeLabel} · {report.turnCount} 轮</span>
                  </p>
                  <div className={s.logChips}>
                    {record.score !== null && (
                      <Badge tone={scoreTone(record.score)}>小测 {record.score} 分</Badge>
                    )}
                    {report.masteredNow && <Badge tone="ok" dot>出师</Badge>}
                    {record.demonsMet > 0 && (
                      <Badge tone={record.demonsBeaten === record.demonsMet ? 'ok' : 'neutral'}>
                        心魔 {record.demonsBeaten}/{record.demonsMet}
                      </Badge>
                    )}
                    {record.xpGained > 0 && <Badge tone="accent">学识 +{record.xpGained}</Badge>}
                    {record.newSeals.length > 0 && (
                      <span className={s.logSeals}>
                        {record.newSeals.slice(0, 4).map((seal) => (
                          <Tip key={seal.id} label={`新印「${seal.name}」：${seal.desc}`}>
                            <span className={s.miniSeal} data-tier={seal.tier} tabIndex={0}>{seal.glyph}</span>
                          </Tip>
                        ))}
                        {record.newSeals.length > 4 && (
                          <span className={s.logMore}>+{record.newSeals.length - 4}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className={s.logActions}>
                  {report.quiz && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<PenLine size={14} strokeWidth={1.75} />}
                      onClick={() => onOpen(`/exam/${report.sessionId}`)}
                    >
                      答卷
                    </Button>
                  )}
                  <Button
                    variant="soft"
                    size="sm"
                    icon={<FileCheck2 size={14} strokeWidth={1.75} />}
                    onClick={() => onOpen(`/review/${report.sessionId}`)}
                  >
                    批注
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
