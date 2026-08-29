/**
 * 记忆匣·小白记得的事(2026-08-30):学伴记忆的可见可控层(Anthropic 式「逐条可看、可改、可删、可暂停」)。
 * 位于卷五四层记忆登记册之下,自带 store 选择器,不动 MemoryPanorama。
 * 制式:h3 短题 + 一句话;画像走教师页 .roster 同款登记行;条目按种类分组,细线行,动作只用文字钮;
 * 删除/清空两步确认就地展开(不弹窗);唯一动画是新记下的那一行 global(rise)。
 * bond 类不列行:卷尾「小白眼里的你」已用第一人称讲同一件事(情分只经画像的「情分」一行露面)。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { MemoryItem, MemoryKind } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { MIN_VISIBLE_CONFIDENCE } from '../../engine/learnerMemory';
import { relDay } from '../../lib/relDay';
import sec from '../../styles/section.module.css';
import m from './MemoryLedger.module.css';

const KIND_GROUPS: { kind: MemoryKind; label: string }[] = [
  { kind: 'preference', label: '偏好' },
  { kind: 'habit', label: '习惯' },
  { kind: 'strength', label: '长处' },
  { kind: 'weakness', label: '短板' },
  { kind: 'milestone', label: '里程碑' },
  { kind: 'note', label: '笔记' },
];

const SECTION_LABELS: { key: 'style' | 'strengths' | 'weaknesses' | 'pace' | 'bond'; label: string }[] = [
  { key: 'style', label: '讲法' },
  { key: 'strengths', label: '长处' },
  { key: 'weaknesses', label: '短板' },
  { key: 'pace', label: '节奏' },
  { key: 'bond', label: '情分' },
];

const ALL_CONFIRM = '__all__';

function sortRows(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned)
    || Number(a.muted) - Number(b.muted)
    || b.lastSeenAt.localeCompare(a.lastSeenAt)
    || a.id.localeCompare(b.id));
}

export function MemoryLedger() {
  const memory = useAppStore((st) => st.memory);
  const events = useAppStore((st) => st.events);
  const pinMemory = useAppStore((st) => st.pinMemory);
  const muteMemory = useAppStore((st) => st.muteMemory);
  const editMemory = useAppStore((st) => st.editMemory);
  const deleteMemory = useAppStore((st) => st.deleteMemory);
  const addExplicitMemory = useAppStore((st) => st.addExplicitMemory);
  const setMemoryPaused = useAppStore((st) => st.setMemoryPaused);
  const recomposeProfile = useAppStore((st) => st.recomposeProfile);
  const resetMemory = useAppStore((st) => st.resetMemory);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState('');
  const [freshId, setFreshId] = useState<string | null>(null);
  /* 两步确认的焦点纪律:展开时焦点落到「取消」,删完/清完落回「记一条」输入框(行已卸载,焦点不能掉到 body) */
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (confirmId !== null) cancelRef.current?.focus();
  }, [confirmId]);
  const settleFocus = () => { addInputRef.current?.focus(); };

  const { items, profile, paused } = memory;

  /* 上过的课(有开课或要点事件),供「这条关于」下拉;不列整个书目 */
  const studiedTopics = useMemo(() => {
    const ids: string[] = [];
    for (const e of events) {
      if ((e.type === 'session_started' || e.type === 'checklist_hit') && !ids.includes(e.topicId)) ids.push(e.topicId);
    }
    return ids.map((id) => getTopic(id)).filter((t): t is NonNullable<typeof t> => !!t);
  }, [events]);

  const groups = useMemo(
    () => KIND_GROUPS
      .map((g) => ({ ...g, items: sortRows(items.filter((it) => it.kind === g.kind)) }))
      .filter((g) => g.items.length > 0),
    [items],
  );

  const hasProfile = !!profile && (
    profile.summary !== '' || SECTION_LABELS.some(({ key }) => profile.sections[key] !== '')
  );

  const beginEdit = (it: MemoryItem) => {
    setConfirmId(null);
    setEditingId(it.id);
    setEditText(it.text);
  };
  const commitEdit = () => {
    if (editingId && editText.trim()) editMemory(editingId, editText);
    setEditingId(null);
  };
  const cancelEdit = () => setEditingId(null);
  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const before = new Set(items.map((it) => it.id));
    addExplicitMemory(text, scope ? { topicId: scope } : {});
    const added = useAppStore.getState().memory.items.find((it) => !before.has(it.id));
    setFreshId(added?.id ?? null);
    setDraft('');
  };

  const empty = items.length === 0 && !hasProfile;

  return (
    <section id="memory-ledger" className={m.ledger} aria-labelledby="memory-ledger-title">
      <div className={m.head}>
        <div className={m.headCopy}>
          <h3 id="memory-ledger-title" className={m.h3}>小白记得的事</h3>
          <p className={m.note}>
            {paused
              ? '记忆已暂停：这段时间上的课不会再记下来，再按一次就继续。'
              : '一条一条写下的，先生可以改、可以删。'}
          </p>
        </div>
        <button
          type="button"
          className={`${m.act} ${paused ? m.actOn : ''}`}
          aria-pressed={paused}
          onClick={() => setMemoryPaused(!paused)}
        >
          暂停记忆
        </button>
      </div>

      {empty && (
        <p className={sec.empty}>还没记下什么——讲完一课，小白会把先生的讲法、长处和短板记在这里。</p>
      )}

      {hasProfile && profile && (
        <div className={m.profile}>
          {profile.summary && <p className={m.summary}>{profile.summary}</p>}
          <dl className={m.roster}>
            {SECTION_LABELS.filter(({ key }) => profile.sections[key]).map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{profile.sections[key]}</dd>
              </div>
            ))}
          </dl>
          <p className={m.meta}>
            <span>整理于 {relDay(profile.updatedAt)} · 凭 {profile.basis.itemCount} 条记忆、{profile.basis.sessionCount} 堂课</span>
            <button type="button" className={m.textBtn} onClick={recomposeProfile}>重新整理</button>
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <ul className={m.list}>
          {groups.map((g) => (
            <li key={g.kind} className={m.group} role="group" aria-labelledby={`mem-kind-${g.kind}`}>
              <p id={`mem-kind-${g.kind}`} className={m.kind}>
                {g.label}
                <small>{g.items.length}</small>
              </p>
              <ul className={m.rows}>
                {g.items.map((it) => {
                  const editing = editingId === it.id;
                  const confirming = confirmId === it.id;
                  const scopeTitle = it.scope.topicId ? getTopic(it.scope.topicId)?.title ?? null : null;
                  const observing = it.source === 'observed' && it.confidence < MIN_VISIBLE_CONFIDENCE;
                  return (
                    <li
                      key={it.id}
                      className={`${m.row} ${it.muted ? m.rowMuted : ''} ${freshId === it.id ? m.rowNew : ''}`}
                    >
                      <div className={m.main}>
                        {editing ? (
                          <input
                            className={m.input}
                            maxLength={60}
                            autoFocus
                            aria-label="编辑这条记忆"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={onEditKey}
                          />
                        ) : (
                          <p className={m.text}>{it.text}</p>
                        )}
                        <div className={m.rowMeta}>
                          {scopeTitle && <span>《{scopeTitle}》</span>}
                          <span>{relDay(it.lastSeenAt)}</span>
                          {it.source === 'explicit' && <span>先生亲笔</span>}
                          {observing && <span>还在观察</span>}
                          {it.muted && <span className={m.srOnly}>已隐藏，不会进入小白的提示</span>}
                          {it.evidence.length > 0 && (
                            <details className={m.ev}>
                              <summary>证据 {it.evidence.length} 条</summary>
                              <ul>
                                {it.evidence.map((e, i) => <li key={i}>「{e}」</li>)}
                              </ul>
                            </details>
                          )}
                        </div>
                      </div>
                      <div
                        className={m.acts}
                        role={confirming ? 'group' : undefined}
                        aria-label={confirming ? '删掉这条？' : undefined}
                      >
                        {editing ? (
                          <>
                            <button type="button" className={m.act} onClick={commitEdit}>保存</button>
                            <button type="button" className={m.act} onClick={cancelEdit}>取消</button>
                          </>
                        ) : confirming ? (
                          <>
                            <span key="ask" className={m.confirm} role="status">删掉这条？</span>
                            <button
                              key="yes"
                              type="button"
                              className={`${m.act} ${m.danger}`}
                              onClick={() => { deleteMemory(it.id); setConfirmId(null); settleFocus(); }}
                            >
                              删除
                            </button>
                            <button key="no" ref={cancelRef} type="button" className={m.act} onClick={() => setConfirmId(null)}>取消</button>
                          </>
                        ) : (
                          <>
                            <button key="edit" type="button" className={m.act} onClick={() => beginEdit(it)}>编辑</button>
                            <button
                              key="pin"
                              type="button"
                              className={`${m.act} ${it.pinned ? m.actOn : ''}`}
                              aria-pressed={it.pinned}
                              onClick={() => pinMemory(it.id, !it.pinned)}
                            >
                              固定
                            </button>
                            <button key="mute" type="button" className={m.act} onClick={() => muteMemory(it.id, !it.muted)}>
                              {it.muted ? '取消隐藏' : '隐藏'}
                            </button>
                            <button
                              key="del"
                              type="button"
                              className={m.act}
                              onClick={() => { setEditingId(null); setConfirmId(it.id); }}
                            >
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <form className={m.add} onSubmit={submitAdd}>
        <input
          ref={addInputRef}
          className={m.input}
          maxLength={60}
          placeholder="记一条给小白，比如：先生开讲前爱先问一句"
          aria-label="记一条给小白"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <select className={m.select} aria-label="这条关于" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">所有课</option>
          {studiedTopics.map((t) => <option key={t.topicId} value={t.topicId}>《{t.title}》</option>)}
        </select>
        <button type="submit" className={m.btn} disabled={!draft.trim()}>记下</button>
      </form>

      {items.length > 0 && (
        <p
          className={m.foot}
          role={confirmId === ALL_CONFIRM ? 'group' : undefined}
          aria-label={confirmId === ALL_CONFIRM ? `清掉全部 ${items.length} 条？` : undefined}
        >
          {confirmId === ALL_CONFIRM ? (
            <>
              <span key="ask" className={m.confirm} role="status">清掉全部 {items.length} 条？</span>
              <button
                key="yes"
                type="button"
                className={`${m.act} ${m.danger}`}
                onClick={() => { resetMemory(); setConfirmId(null); settleFocus(); }}
              >
                清空
              </button>
              <button key="no" ref={cancelRef} type="button" className={m.act} onClick={() => setConfirmId(null)}>取消</button>
            </>
          ) : (
            <>
              <span key="count">共 {items.length} 条 · </span>
              <button key="open" type="button" className={m.textBtn} onClick={() => { setEditingId(null); setConfirmId(ALL_CONFIRM); }}>
                清空记忆
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
