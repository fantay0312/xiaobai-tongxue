/**
 * 科研台的输入框：与对话输入框同一家族。
 * 「/」开技能菜单，「@」附带课题文件、别的板块的成果或资料库文档；一行工具放权限模式、模型与发送/停止。
 */
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent, type ReactNode, type RefObject,
} from 'react';
import {
  ArrowUp, BookMarked, ChevronDown, ClipboardList, Database, FileText, FlaskConical, FolderOpen, Lightbulb, Paperclip, PenLine, Eraser,
  ScanSearch, Shield, ShieldCheck, ShieldQuestion, Square, SquareSlash, Target, X, Zap,
} from 'lucide-react';
import {
  IconButton, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, ModelPicker, Segmented, Tip,
  type ModelOption,
} from '../../../../components/ui';
import { SKILLS, attachmentLabel, matchSkills, parseInput, slashQuery, type Attachment, type FileMeta, type PermissionMode, type ResearchSkill, type WorkbenchStatus } from '../../../../engine/research';
import { ARTIFACT_LABELS, useArtifacts } from '../../../../lib/artifacts';
import { listLibrary } from '../../../../lib/fileLibrary';
import { useModelPrefs } from '../../../../store/modelPrefs';
import { useModelCatalog } from '../../chat/useModelCatalog';
import r from './research.module.css';

const MAX_LENGTH = 6000;
const ICON = { size: 16, strokeWidth: 1.75 } as const;

const SKILL_ICONS: Record<string, ReactNode> = {
  plan: <ClipboardList {...ICON} />,
  goal: <Target {...ICON} />,
  survey: <BookMarked {...ICON} />,
  idea: <Lightbulb {...ICON} />,
  analyze: <Database {...ICON} />,
  reproduce: <FlaskConical {...ICON} />,
  review: <ScanSearch {...ICON} />,
  write: <PenLine {...ICON} />,
  clear: <Eraser {...ICON} />,
};

export const PERMISSION_OPTIONS: { value: PermissionMode; label: string; short: string; hint: string; icon: ReactNode }[] = [
  { value: 'ask', label: '每步询问', short: '每步问', hint: '检索、读文献、写文件、运行代码前都先问你', icon: <ShieldQuestion {...ICON} /> },
  { value: 'risky', label: '仅高风险询问', short: '高风险问', hint: '覆盖或删除文件、运行 Python、首次访问某个文献来源时问你', icon: <Shield {...ICON} /> },
  { value: 'auto', label: '全自动', short: '全自动', hint: '不再逐步询问，过程仍完整记录在时间线里', icon: <Zap {...ICON} /> },
];

interface MentionItem {
  key: string;
  group: string;
  label: string;
  sub?: string;
  attachment: Attachment;
}

interface Props {
  owner: string | null;
  input: string;
  onInput: (text: string) => void;
  attachments: Attachment[];
  onAttachments: (attachments: Attachment[]) => void;
  files: FileMeta[];
  permission: PermissionMode;
  onPermission: (mode: PermissionMode) => void;
  /** 这一轮正在跑 */
  busy: boolean;
  /** 助手在等用户回答问题：发送即作答 */
  answering: boolean;
  /** 助手在等批准：先处理上面的卡片 */
  awaitingApproval: boolean;
  status: WorkbenchStatus | null;
  onSubmit: () => void;
  onStop: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

const attachmentKey = (item: Attachment) => (item.kind === 'file' ? `file:${item.path}` : item.kind === 'artifact' ? `artifact:${item.key}` : `library:${item.id}`);
const sameAttachment = (a: Attachment, b: Attachment) => attachmentKey(a) === attachmentKey(b);

/** 取光标前正在输入的「@xxx」 */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]{0,40})$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2].toLowerCase() } : null;
}

function StatusRow({ status }: { status: WorkbenchStatus | null }) {
  if (!status) return <span className={r.statusItem} data-tone="muted">正在检查可用的能力…</span>;
  const items: { key: string; ok: boolean; label: string; tip: string; warn?: boolean }[] = [
    {
      key: 'model', ok: status.model, label: status.model ? '模型可用' : '没有可用模型',
      tip: status.model ? '科研助手使用你在全局设置里选的模型线路。' : '需要登录后使用服务器线路，或在设置里填写自己的模型接口。此时助手无法工作，文件仍可查看和编辑。',
    },
    {
      key: 'connectors', ok: status.connectors, label: status.connectors ? '文献检索已连接' : '文献检索未连接',
      tip: status.connectors ? '经网关访问 OpenAlex、Crossref、arXiv、PubMed、Semantic Scholar、Europe PMC。' : '文献连接器需要登录并连接到服务器。未连接时助手查不了文献，也不会编造文献。',
    },
    {
      key: 'python', ok: status.python, label: status.python ? 'Python 可用' : 'Python 不可用',
      tip: status.python ? '代码在这台设备的浏览器里运行，带 numpy、pandas、scipy、matplotlib；代码和数据不离开浏览器。' : '这个浏览器里没有可用的 Python 环境。助手可以写脚本，但不会运行，也不会给出假想的运行结果。',
    },
    {
      key: 'storage', ok: status.storage === 'indexeddb', warn: true, label: status.storage === 'indexeddb' ? '文件存在本浏览器' : '文件只保留到刷新前',
      tip: status.storage === 'indexeddb' ? '课题、会话和文件按账号保存在这台设备的浏览器里，换设备不会带过去；需要带走请导出课题。' : '浏览器不允许使用本地数据库，文件只在这次打开的页面里，刷新后会丢失。请及时导出课题。',
    },
  ];
  return (
    <>
      {items.map((item) => (
        <Tip key={item.key} label={<span className={r.tipText}>{item.tip}</span>}>
          <span className={r.statusItem} data-tone={item.ok ? 'ok' : item.warn ? 'warn' : 'bad'} tabIndex={0}>
            <i aria-hidden="true" />{item.label}
          </span>
        </Tip>
      ))}
    </>
  );
}

export function ResearchComposer({
  owner, input, onInput, attachments, onAttachments, files, permission, onPermission, busy, answering, awaitingApproval, status,
  onSubmit, onStop, onClear, inputRef,
}: Props) {
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  /* ── 模型与思考强度：跟随全局设置 ── */
  const prefs = useModelPrefs();
  const catalog = useModelCatalog(true);
  const models: ModelOption[] = catalog?.available ? catalog.models : [];
  const modelId = prefs.model && models.some((item) => item.id === prefs.model) ? prefs.model : catalog?.defaultModel ?? null;
  const currentModel = models.find((item) => item.id === modelId) ?? models[0];
  const { effort, setEffort } = prefs;
  useEffect(() => {
    if (!currentModel || !currentModel.efforts.length || currentModel.efforts.includes(effort)) return;
    setEffort(currentModel.defaultEffort ?? currentModel.efforts[0]);
  }, [currentModel, effort, setEffort]);

  /* ── 文本域自动长高 ── */
  const resize = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const max = Math.max(120, Math.round((window.visualViewport?.height ?? window.innerHeight) * 0.34));
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  }, [inputRef]);
  useLayoutEffect(resize, [input, resize]);

  const focusInput = useCallback((position?: number) => {
    window.requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const at = position ?? node.value.length;
      node.setSelectionRange(at, at);
      setCaret(at);
    });
  }, [inputRef]);

  /* ── 可以附带的东西：课题文件、别的板块的成果、资料库文档 ── */
  const artifacts = useArtifacts(owner);
  const [library, setLibrary] = useState<{ id: string; name: string }[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const libraryAsked = useRef(false);
  const loadLibrary = useCallback(() => {
    if (libraryAsked.current) return;
    libraryAsked.current = true;
    listLibrary()
      .then((snapshot) => setLibrary(snapshot.entries.filter((entry) => entry.kind === 'file' && !entry.deletedAt).map((entry) => ({ id: entry.id, name: entry.name }))))
      .catch(() => { setLibraryError(true); setLibrary([]); });
  }, []);

  const mentionItems = useMemo((): MentionItem[] => [
    ...files.map((file): MentionItem => ({ key: `file:${file.path}`, group: '课题文件', label: file.path, attachment: { kind: 'file', path: file.path } })),
    ...artifacts.filter((item) => item.kind !== 'research-file').map((item): MentionItem => ({
      key: item.key, group: '学习成果', label: item.title, sub: ARTIFACT_LABELS[item.kind], attachment: { kind: 'artifact', key: item.key, title: item.title },
    })),
    ...(library ?? []).map((entry): MentionItem => ({ key: `library:${entry.id}`, group: '资料库', label: entry.name, attachment: { kind: 'library', id: entry.id, name: entry.name } })),
  ], [files, artifacts, library]);

  const addAttachment = (attachment: Attachment) => {
    if (attachments.some((item) => sameAttachment(item, attachment))) return;
    onAttachments([...attachments, attachment].slice(0, 8));
  };

  /* ── 「/」与「@」浮层 ── */
  const slash = slashQuery(input);
  const mention = slash === null ? mentionAt(input, caret) : null;
  const skillMatches = slash === null ? [] : matchSkills(slash);
  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const picked: MentionItem[] = [];
    const perGroup = new Map<string, number>();
    for (const item of mentionItems) {
      if (mention.query && !item.label.toLowerCase().includes(mention.query)) continue;
      if (attachments.some((attached) => sameAttachment(attached, item.attachment))) continue;
      const count = perGroup.get(item.group) ?? 0;
      if (count >= 6) continue;
      perGroup.set(item.group, count + 1);
      picked.push(item);
    }
    return picked;
  }, [mention, mentionItems, attachments]);
  useEffect(() => { if (mention) loadLibrary(); }, [mention, loadLibrary]);

  const menu: 'slash' | 'mention' | null = dismissed ? null : skillMatches.length ? 'slash' : mention ? 'mention' : null;
  const menuSize = menu === 'slash' ? skillMatches.length : menu === 'mention' ? mentionMatches.length : 0;
  const activeIndex = Math.min(active, Math.max(0, menuSize - 1));
  const menuKey = `${slash ?? ''}|${mention?.query ?? ''}|${menu ?? ''}`;
  useEffect(() => { setActive(0); }, [menuKey]);
  useEffect(() => { setDismissed(false); }, [slash, mention?.query]);

  const pickSkill = (skill: ResearchSkill) => {
    if (skill.mode === 'clear') {
      onInput('');
      onClear();
      return;
    }
    // 从菜单按钮选时保留已经写的内容
    const rest = slashQuery(input) === null ? parseInput(input).arg : '';
    const next = `/${skill.name} ${rest}`;
    onInput(next);
    focusInput(next.length);
  };

  const pickMention = (item: MentionItem) => {
    addAttachment(item.attachment);
    if (!mention) return;
    const next = `${input.slice(0, mention.start)}${input.slice(caret)}`;
    onInput(next);
    focusInput(mention.start);
  };

  /* ── 发送 ── */
  const parsed = parseInput(input);
  const hasText = input.trim().length > 0;
  const canSend = hasText && !awaitingApproval && (!busy || answering);
  const sendHint = awaitingApproval ? '先处理上面等待批准的卡片' : !hasText ? (answering ? '写下你的回答' : '写下研究任务后发送') : answering ? '回答助手' : '发送';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (menu && menuSize > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + menuSize) % menuSize);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        if (menu === 'slash') pickSkill(skillMatches[activeIndex]);
        else pickMention(mentionMatches[activeIndex]);
        return;
      }
    }
    if (menu && event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? input.length);
  const currentPermission = PERMISSION_OPTIONS.find((option) => option.value === permission) ?? PERMISSION_OPTIONS[1];
  const placeholder = awaitingApproval
    ? '助手在等你批准上面的操作…'
    : answering
      ? '回答助手的问题…'
      : busy
        ? '助手正在工作，可以随时停止'
        : '描述一个研究任务；输入 / 用技能，@ 附带文件';

  let lastGroup = '';

  return (
    <div className={r.composer}>
      {menu === 'slash' && (
        <div className={r.float} role="listbox" id={listId} aria-label="技能指令">
          <p className={r.floatTitle}>技能指令</p>
          {skillMatches.map((skill, index) => (
            <button
              key={skill.name}
              type="button"
              role="option"
              id={`${listId}-${index}`}
              aria-selected={index === activeIndex}
              className={r.floatItem}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (index !== activeIndex) setActive(index); }}
              onClick={() => pickSkill(skill)}
            >
              <span className={r.floatIcon}>{SKILL_ICONS[skill.name]}</span>
              <span className={r.floatText}><strong>/{skill.name}<em>{skill.label}</em></strong><small>{skill.hint}</small></span>
              {index === activeIndex && <Kbd>↵</Kbd>}
            </button>
          ))}
        </div>
      )}
      {menu === 'mention' && (
        <div className={r.float} role="listbox" id={listId} aria-label="附带文件">
          <p className={r.floatTitle}>附带到这一轮</p>
          {mentionMatches.length === 0 && (
            <p className={r.floatEmpty}>
              {mentionItems.length ? '没有匹配的文件。' : '课题里还没有文件，也没有可以附带的学习成果。'}
              {libraryError && ' 资料库没有连接上。'}
            </p>
          )}
          {mentionMatches.map((item, index) => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.key} role="presentation">
                {head && <p className={r.floatGroup}>{head}</p>}
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${index}`}
                  aria-selected={index === activeIndex}
                  className={r.floatItem}
                  data-dense
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => { if (index !== activeIndex) setActive(index); }}
                  onClick={() => pickMention(item)}
                >
                  <span className={r.floatIcon}>{item.attachment.kind === 'library' ? <FolderOpen {...ICON} /> : <FileText {...ICON} />}</span>
                  <span className={r.floatText}><strong>{item.label}</strong>{item.sub && <small>{item.sub}</small>}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form className={r.box} onSubmit={submit} onClick={(event) => { if (event.target === event.currentTarget) inputRef.current?.focus(); }}>
        {parsed.skill && parsed.skill.mode !== 'clear' && (
          <p className={r.skillHint}>
            <span className={r.skillTag}>{SKILL_ICONS[parsed.skill.name]}/{parsed.skill.name} {parsed.skill.label}</span>
            <span>{parsed.arg ? parsed.skill.hint : `接着写：${parsed.skill.argHint}`}</span>
          </p>
        )}
        {attachments.length > 0 && (
          <ul className={r.attachments} aria-label="附带的文件">
            {attachments.map((item) => (
              <li key={attachmentKey(item)} className={r.attachment}>
                {item.kind === 'library' ? <FolderOpen size={14} strokeWidth={1.75} /> : <FileText size={14} strokeWidth={1.75} />}
                <span title={attachmentLabel(item)}>{attachmentLabel(item)}</span>
                <button type="button" aria-label={`移除 ${attachmentLabel(item)}`} onClick={() => onAttachments(attachments.filter((other) => !sameAttachment(other, item)))}>
                  <X size={13} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={inputRef}
          className={r.input}
          rows={1}
          value={input}
          maxLength={MAX_LENGTH}
          aria-label="向科研助手描述任务"
          aria-autocomplete="list"
          aria-controls={menu ? listId : undefined}
          aria-activedescendant={menu && menuSize ? `${listId}-${activeIndex}` : undefined}
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={(event) => { onInput(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); }}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onFocus={() => setDismissed(false)}
        />

        <div className={r.toolbar}>
          <div className={r.tools}>
            <Menu onOpenChange={(open) => { if (open) loadLibrary(); }}>
              <MenuTrigger asChild>
                <IconButton label="附带文件（也可以输入 @）" round><Paperclip size={17} strokeWidth={1.75} /></IconButton>
              </MenuTrigger>
              <MenuContent side="top" align="start" className={r.attachMenu}>
                {mentionItems.length === 0 && <MenuLabel>{libraryError ? '课题里还没有文件；资料库没有连接上' : '还没有可以附带的文件'}</MenuLabel>}
                {(['课题文件', '学习成果', '资料库'] as const).map((group) => {
                  const items = mentionItems.filter((item) => item.group === group).slice(0, 12);
                  if (!items.length) return null;
                  return (
                    <div key={group} role="presentation">
                      <MenuLabel>{group}</MenuLabel>
                      {items.map((item) => (
                        <MenuItem
                          key={item.key}
                          icon={item.attachment.kind === 'library' ? <FolderOpen {...ICON} /> : <FileText {...ICON} />}
                          hint={item.sub}
                          checked={attachments.some((attached) => sameAttachment(attached, item.attachment))}
                          onSelect={() => addAttachment(item.attachment)}
                        >
                          {item.label}
                        </MenuItem>
                      ))}
                    </div>
                  );
                })}
              </MenuContent>
            </Menu>

            <Menu>
              <MenuTrigger asChild>
                <IconButton label="技能指令（也可以输入 /）" round><SquareSlash size={17} strokeWidth={1.75} /></IconButton>
              </MenuTrigger>
              <MenuContent side="top" align="start">
                <MenuLabel>技能指令</MenuLabel>
                {SKILLS.filter((skill) => skill.mode !== 'clear').map((skill) => (
                  <MenuItem key={skill.name} icon={SKILL_ICONS[skill.name]} hint={skill.hint} onSelect={() => pickSkill(skill)}>
                    /{skill.name} {skill.label}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem icon={SKILL_ICONS.clear} onSelect={onClear}>/clear 开始新会话</MenuItem>
              </MenuContent>
            </Menu>

            <Segmented
              className={r.permissionSeg}
              size="sm"
              label="权限模式"
              value={permission}
              onChange={onPermission}
              options={PERMISSION_OPTIONS.map((option) => ({ value: option.value, label: option.label, title: option.hint }))}
            />
            <Menu>
              <MenuTrigger asChild>
                <button type="button" className={r.permissionPill} data-mode={permission} aria-label={`权限模式：${currentPermission.label}`}>
                  {permission === 'auto' ? <Zap {...ICON} /> : permission === 'ask' ? <ShieldQuestion {...ICON} /> : <ShieldCheck {...ICON} />}
                  <span>{currentPermission.short}</span>
                  <ChevronDown size={13} strokeWidth={2} />
                </button>
              </MenuTrigger>
              <MenuContent side="top" align="start">
                <MenuLabel>权限模式</MenuLabel>
                {PERMISSION_OPTIONS.map((option) => (
                  <MenuItem key={option.value} icon={option.icon} hint={option.hint} checked={option.value === permission} onSelect={() => onPermission(option.value)}>
                    {option.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </div>

          <div className={r.sendGroup}>
            {models.length > 0 ? (
              <div className={r.modelSlot}>
                <ModelPicker models={models} model={modelId} effort={prefs.effort} onModel={prefs.setModel} onEffort={prefs.setEffort} onReset={prefs.reset} />
              </div>
            ) : catalog && (
              <span className={r.noModel}>没有可用模型</span>
            )}
            {busy && !answering ? (
              <Tip label="停止这一轮">
                <button type="button" className={r.send} data-stop aria-label="停止" onClick={onStop}>
                  <Square size={12} strokeWidth={0} fill="currentColor" />
                </button>
              </Tip>
            ) : (
              <Tip label={sendHint}>
                <button type="submit" className={r.send} aria-label={answering ? '回答' : '发送'} aria-disabled={!canSend}>
                  <ArrowUp size={18} strokeWidth={2.25} />
                </button>
              </Tip>
            )}
          </div>
        </div>
      </form>

      <p className={r.statusRow} aria-label="当前可用的能力">
        <StatusRow status={status} />
      </p>
    </div>
  );
}
