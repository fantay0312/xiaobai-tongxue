/**
 * 一堂课的四站：备课 → 上课 → 赴考 → 批注复盘。每一站显示所选课程的真实进度。
 */
import { BookOpen, Check, FileCheck2, PenLine, Presentation, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Button } from '../../../../components/ui';
import type { Topic } from '../../../../types';
import type { Station, StationKey } from './data';
import s from './feynman.module.css';

const ICONS: Record<StationKey, ReactNode> = {
  prepare: <BookOpen size={16} strokeWidth={1.75} />,
  teach: <Presentation size={16} strokeWidth={1.75} />,
  exam: <PenLine size={16} strokeWidth={1.75} />,
  review: <FileCheck2 size={16} strokeWidth={1.75} />,
};

const LOCKED_HINT: Record<StationKey, string> = {
  prepare: '',
  teach: '',
  exam: '上完一堂课后开放',
  review: '上完一堂课后开放',
};

interface Props {
  topic: Topic | undefined;
  stations: Station[];
  busy: boolean;
  onRun: (station: Station) => void;
  onPick: () => void;
}

export function LoopStations({ topic, stations, busy, onRun, onPick }: Props) {
  return (
    <section className={s.section} aria-labelledby="feynman-loop-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-loop-title" className={s.sectionTitle}>一堂课的四站</h2>
          <p className={s.sectionNote}>
            {topic ? `${topic.course} · ${topic.title}` : '先在下面选一门课'}
          </p>
        </div>
        {topic && (
          <Button variant="ghost" size="sm" onClick={onPick}>换一门课</Button>
        )}
      </header>

      {topic ? (
        <>
          <ol className={s.stations}>
            {stations.map((station, index) => (
              <li key={station.key} className={s.station} data-state={station.state}>
                <div className={s.stationRail} aria-hidden="true">
                  <span className={s.stationNode}>
                    {station.state === 'done' ? <Check size={15} strokeWidth={2.25} /> : index + 1}
                  </span>
                  <span className={s.stationLine} />
                </div>
                <div className={s.stationBody}>
                  <h3 className={s.stationName}>
                    {ICONS[station.key]}
                    {station.name}
                    {station.state === 'current' && <Badge tone="accent">现在</Badge>}
                  </h3>
                  <p className={s.stationStatus}>{station.status}</p>
                  {station.to ? (
                    <Button
                      variant={station.state === 'current' ? 'soft' : 'ghost'}
                      size="sm"
                      className={station.state === 'current' ? s.stationAction : `${s.stationAction} ${s.stationGhost}`}
                      disabled={busy}
                      onClick={() => onRun(station)}
                    >
                      {station.cta}
                    </Button>
                  ) : (
                    <span className={s.stationLocked}>{LOCKED_HINT[station.key]}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className={s.loopBack}>
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            批注里有没讲透的地方，就补学后回到上课再讲一遍，直到小白出师。
          </p>
        </>
      ) : (
        <p className={s.loopEmpty}>书架上还没有可以教的课。</p>
      )}
    </section>
  );
}
