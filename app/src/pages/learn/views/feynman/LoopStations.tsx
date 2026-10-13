/**
 * 一堂课的四站：备课 → 上课 → 赴考 → 批注复盘。每一站显示所选课程的真实进度。
 */
import { Check, ChevronsUpDown, RotateCcw } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge, Button } from '../../../../components/ui';
import { IconExam, IconLesson, IconPrep, IconReview, type XbIconProps } from '../../../../components/ui/icons';
import type { Topic } from '../../../../types';
import type { Station, StationKey } from './data';
import s from './feynman.module.css';

const ICONS: Record<StationKey, ComponentType<XbIconProps>> = {
  prepare: IconPrep,
  teach: IconLesson,
  exam: IconExam,
  review: IconReview,
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
  /** 主区里有选课列表时，跳到它；选课在侧栏时不传 */
  onPick?: () => void;
  /** 手机版式：当前课做成一条通栏的换课按钮，点开底部抽屉选课 */
  compact?: boolean;
}

function StationItem({ station, index, busy, onRun }: {
  station: Station;
  index: number;
  busy: boolean;
  onRun: (station: Station) => void;
}) {
  const StationIcon = ICONS[station.key];
  const current = station.state === 'current';
  return (
    <li className={s.station} data-state={station.state}>
      <div className={s.stationRail} aria-hidden="true">
        <span className={s.stationNode}>
          {station.state === 'done' ? <Check size={15} strokeWidth={2.25} /> : index + 1}
        </span>
        <span className={s.stationLine} />
      </div>
      <div className={s.stationBody}>
        <h3 className={s.stationName}>
          <StationIcon size={17} active={current} />
          {station.name}
          {current && <Badge tone="accent">现在</Badge>}
        </h3>
        <p className={s.stationStatus}>{station.status}</p>
        {station.to ? (
          <Button
            variant={current ? 'soft' : 'ghost'}
            size="sm"
            className={current ? s.stationAction : `${s.stationAction} ${s.stationGhost}`}
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
  );
}

export function LoopStations({ topic, stations, busy, onRun, onPick, compact = false }: Props) {
  return (
    <section className={s.section} aria-labelledby="feynman-loop-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-loop-title" className={s.sectionTitle}>一堂课的四站</h2>
          {!(compact && onPick) && (
            <p className={s.sectionNote}>
              {topic ? `${topic.course} · ${topic.title}` : '先选一门课'}
            </p>
          )}
        </div>
        {topic && onPick && !compact && (
          <Button variant="ghost" size="sm" onClick={onPick}>换一门课</Button>
        )}
      </header>

      {compact && onPick && (
        <button type="button" className={s.courseSwitch} aria-haspopup="dialog" onClick={onPick}>
          <span className={s.courseSwitchText}>
            <b>{topic ? topic.title : '选一门课'}</b>
            <span>{topic ? topic.course : '书架上的课都在这里'}</span>
          </span>
          <span className={s.courseSwitchHint}>
            换一门
            <ChevronsUpDown size={15} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </button>
      )}

      {topic ? (
        <>
          <ol className={s.stations}>
            {stations.map((station, index) => (
              <StationItem
                key={station.key}
                station={station}
                index={index}
                busy={busy}
                onRun={onRun}
              />
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
