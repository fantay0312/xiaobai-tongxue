import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { XiaoyanPet, type XiaoyanPetState } from '../../components/coach/XiaoyanPet';
import { Icon } from '../../components/ui/Icon';
import { clampCompanionPosition, type CompanionPosition, type LearningIdentity } from '../../engine/learningIdentity';
import type { Topic } from '../../types';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import s from './companion.module.css';

type IdentityUpdate = (patch: Partial<LearningIdentity>) => void;
export function StudyCompanion({ identity, onChange, topic, busy, reading, withComposer, level, onAsk, onJourney, onTeach }: {
  identity: LearningIdentity; onChange: IdentityUpdate; topic?: Topic; busy: boolean; reading: boolean;
  withComposer: boolean; level: 1 | 2 | 3 | 4 | 5; onAsk: () => void; onJourney: () => void; onTeach: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuSide, setMenuSide] = useState<'left' | 'right'>('right');
  const [position, setPosition] = useState(identity.position);
  const drag = useRef<{ startX: number; startY: number; origin: CompanionPosition } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const positionRef = useRef(position);
  positionRef.current = position;
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const constrained = (next: CompanionPosition) => clampCompanionPosition(next, viewport(), { width: 176, height: expanded ? 380 : 268 });
  useEffect(() => {
    const resize = () => setPosition((value) => value ? clampCompanionPosition(value, viewport(), { width: 176, height: 380 }) : null);
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    setPosition((value) => value ? clampCompanionPosition(value, { width: window.innerWidth, height: window.innerHeight }, { width: 176, height: expanded ? 380 : 268 }) : null);
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const bounds = panel.current?.getBoundingClientRect();
    if (bounds) setMenuSide(bounds.right + 222 > window.innerWidth ? 'left' : 'right');
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [expanded]);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { startX: event.clientX, startY: event.clientY, origin: { x: rect.left, y: rect.top } };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const { startX, startY, origin } = drag.current;
    const next = constrained({ x: origin.x + event.clientX - startX, y: origin.y + event.clientY - startY });
    positionRef.current = next;
    setPosition(next);
  };
  const up = () => { if (!drag.current) return; drag.current = null; setDragging(false); onChange({ position: positionRef.current }); };
  const name = identity.actor === 'xiaoyan' ? '小砚' : '小白';
  const state: XiaoyanPetState = busy ? 'working' : reading ? 'listening' : 'idle';
  const line = identity.actor === 'xiaoyan'
    ? busy ? '我在整理资料，马上回来。' : reading ? '慢慢读。哪句不懂，我们一起拆开。' : topic ? '有不明白的，随时叫我。' : '先挑一门课，或者带来自己的讲义。'
    : !identity.acceptedAt ? '我给你留了拜师帖，要拆开看看吗？' : topic ? '等你学懂了，试着讲给我听吧。' : '先生，今天我们学点什么？';
  const style: CSSProperties | undefined = position && !identity.minimized ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined;

  if (identity.minimized) return <button className={s.restore} style={{ '--mobile-restore-bottom': withComposer ? '205px' : '16px' } as CSSProperties} onClick={() => onChange({ minimized: false })} aria-label={`唤回学习伙伴${name}`}><Icon name="users-round" size={15} />唤回{name}</button>;
  return <aside ref={panel} className={`${s.companion} ${position ? s.floating : ''}`} style={style} aria-label="常驻学习伙伴" data-menu-side={menuSide} data-menu-below={Boolean(position && position.y < 160) || undefined} data-expanded={expanded || undefined} data-has-composer={withComposer || undefined} data-dragging={dragging || undefined} data-reduced-motion={reducedMotion || undefined}>
    <div className={s.controls}><button className={s.dragHandle} aria-label="拖动学习伙伴，可用方向键移动" title="拖动；方向键移动；Home 放回侧栏" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={(event) => {
      if (event.key === 'Home') { setPosition(null); onChange({ position: null }); event.preventDefault(); return; }
      const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const rect = panel.current?.getBoundingClientRect();
      const next = constrained({ x: (position?.x ?? rect?.left ?? 8) + delta[0], y: (position?.y ?? rect?.top ?? 64) + delta[1] });
      setPosition(next); onChange({ position: next });
    }}><Icon name="move" size={14} /></button><span>学习伙伴</span><button aria-label="收起学习伙伴" onClick={() => { onChange({ minimized: true }); setExpanded(false); }}><Icon name="minus" size={14} /></button></div>
    <div className={s.character}>{identity.actor === 'xiaoyan' ? <XiaoyanPet state={state} suppressReply className={s.pet} aria-label="与小砚互动" onClick={() => setExpanded((value) => !value)} /> : <button className={s.student} aria-label="与小白互动" onClick={() => setExpanded((value) => !value)}><XiaobaiAvatar mood={busy ? 'thinking' : identity.acceptedAt ? 'happy' : 'curious'} level={level} size={130} /></button>}</div>
    <button className={s.speech} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{line}</button>
    <div className={s.switcher} aria-label="选择学习伙伴"><button aria-pressed={identity.actor === 'xiaoyan'} onClick={() => onChange({ actor: 'xiaoyan' })}>小砚<span>助理</span></button><button aria-pressed={identity.actor === 'xiaobai'} onClick={() => onChange({ actor: 'xiaobai' })}>小白<span>学生</span></button></div>
    {expanded && <div className={s.actions}><button onClick={() => { setExpanded(false); onAsk(); }}><Icon name="lightbulb" size={14} />{topic ? '这道问题想请教你' : '帮我开始学习'}</button><button onClick={() => { setExpanded(false); onJourney(); }}><Icon name="mail" size={14} />拜师帖与师徒旅程</button>{topic && <button onClick={() => { setExpanded(false); onTeach(); }}><Icon name="graduation" size={14} />准备好，讲给小白听</button>}{position && <button onClick={() => { setPosition(null); onChange({ position: null }); }}><Icon name="arrow-left" size={14} />放回侧栏</button>}</div>}
  </aside>;
}
