/**
 * 输入框：附件小签 + 自动长高的文本域 + 一行工具（资料、回答方式、互动回答、模型与思考强度、听写、发送/停止）。
 * 不可用的入口不渲染，不留灰掉的按钮。
 */
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import {
  ArrowUp, AtSign, BookOpen, ChevronDown, FileText, FolderOpen, LayoutGrid,
  MessageCircleQuestion, Mic, Plus, Sparkles, Square, SquareSlash, Telescope, X,
} from 'lucide-react';
import { IconChat, IconFlashcard, IconGuide, IconMindmap, IconQuiz, IconRead } from '../../../components/ui/icons';
import {
  IconButton, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, ModelPicker, Tip, toast,
  type ModelOption,
} from '../../../components/ui';
import type { StudyMode } from '../../../engine/studyWorkspace';
import { useModelPrefs } from '../../../store/modelPrefs';
import { useDictation } from './speech';
import { DICTATION_MESSAGES } from '../../../lib/realtimeAsr';
import type { ComposerProps } from './types';
import { useModelCatalog } from './useModelCatalog';
import { useMediaQuery } from '../shell/views';
import s from './composer.module.css';

const MAX_LENGTH = 3000;
const ICON = { size: 16, strokeWidth: 1.75 } as const;

const MODES: { value: StudyMode; label: string; hint: string; icon: ReactNode }[] = [
  { value: 'ask', label: '直接答疑', hint: '先把疑点讲清，再给例子和自检题', icon: <IconChat size={16} /> },
  { value: 'socratic', label: '引导思考', hint: '给一点提示，每次只问一个问题', icon: <MessageCircleQuestion {...ICON} /> },
  { value: 'deep', label: '深入答疑', hint: 'DeepTutor 多轮核对资料，耗时更长', icon: <Telescope {...ICON} /> },
];

interface SlashCommand { name: string; keys: string[]; hint: string; icon: ReactNode; prompt: string }
/** keys 是拼音与英文别名，输入法还没上屏时也能筛到 */
const COMMANDS: SlashCommand[] = [
  {
    name: '导图', keys: ['daotu', 'dt', 'mindmap'], hint: '把所选资料整理成思维导图', icon: <IconMindmap size={16} />,
    prompt: '请把所选资料整理成一张思维导图：先给出中心主题，再分出 3 到 5 个分支，每个分支列出关键概念和它们之间的关系。',
  },
  {
    name: '出题', keys: ['chuti', 'ct', 'quiz'], hint: '出一组自测题，答完再看讲解', icon: <IconQuiz size={16} />,
    prompt: '请根据所选资料出 5 道自测题，选择题和简答题都要有。先只给题目，等我作答后再逐题讲解。',
  },
  {
    name: '闪卡', keys: ['shanka', 'sk', 'cards'], hint: '把重点概念做成问答卡片', icon: <IconFlashcard size={16} />,
    prompt: '请把所选资料里最重要的概念做成 8 张闪卡，每张包含正面的问题和背面的答案。',
  },
  {
    name: '带我学', keys: ['daiwoxue', 'dwx', 'guide'], hint: '一步一步讲，每步确认理解', icon: <IconGuide size={16} />,
    prompt: '请带我一步步学习所选资料：先说明学习路线，然后每次只讲一小步，并用一个问题确认我是否理解，再继续下一步。',
  },
  {
    name: '总结', keys: ['zongjie', 'zj', 'summary'], hint: '分点概括核心内容并标注来源', icon: <IconRead size={16} />,
    prompt: '请总结所选资料的核心内容：分点列出要点，说明它们之间的联系，并标注来源。',
  },
];

const DICTATION_ERRORS: Record<string, string> = {
  'not-allowed': '没有麦克风权限，请在浏览器地址栏里允许使用麦克风',
  'service-not-allowed': '当前浏览器不允许语音输入',
  'audio-capture': '没有找到可用的麦克风',
  network: '语音识别需要联网，当前连接不上',
};

/** 输入只有「/xxx」时取出 xxx 作为指令筛选词 */
function slashQuery(input: string): string | null {
  const match = /^\/(\S*)$/.exec(input);
  return match ? match[1].replace(/'/g, '').toLowerCase() : null;
}

export function Composer({
  input, onInput, mode, onMode, answerFormat, onAnswerFormat, busy, onStop, onSubmit, inputRef,
  deepAvailable, intelligentAvailable, demo, sourceCount, freeChat, attachments, onRemoveAttachment, onAttach, onAttachContent, onOpenSources, placeholder,
}: ComposerProps) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLFormElement>(null);
  /** 手机：次要控件收进「+」菜单；阅读页里的输入框平时缩成一行，点进去才展开 */
  const phone = useMediaQuery('(max-width: 760px)');
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!engaged) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || wrapRef.current?.contains(target)) return;
      // 菜单、弹层开着时点外面是在关它们，输入框先不收
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      setEngaged(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [engaged]);
  const inputValue = useRef(input);
  inputValue.current = input;

  /* ── 模型与思考强度 ── */
  const prefs = useModelPrefs();
  const catalog = useModelCatalog(!demo);
  const models: ModelOption[] = catalog?.available ? catalog.models : [];
  const modelId = prefs.model && models.some((item) => item.id === prefs.model) ? prefs.model : catalog?.defaultModel ?? null;
  const currentModel = models.find((item) => item.id === modelId) ?? models[0];
  // 换到不支持当前强度的模型时，把偏好落到它支持的档位，避免请求带上无效强度
  const { effort, setEffort } = prefs;
  useEffect(() => {
    if (!currentModel || !currentModel.efforts.length || currentModel.efforts.includes(effort)) return;
    setEffort(currentModel.defaultEffort ?? currentModel.efforts[0]);
  }, [currentModel, effort, setEffort]);

  /* ── 文本域自动长高：1 行到约 40vh ── */
  const resize = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    // 软键盘弹出时按剩下的可视高度算上限，免得输入框把对话挤没
    const max = Math.max(120, Math.round((window.visualViewport?.height ?? window.innerHeight) * 0.4));
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  }, [inputRef]);
  useLayoutEffect(resize, [input, resize, engaged, phone]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      resize();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [resize]);

  const focusInput = useCallback((caretToEnd = false) => {
    window.requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      if (caretToEnd) node.setSelectionRange(node.value.length, node.value.length);
    });
  }, [inputRef]);
  /** 菜单关闭后把焦点还给输入框；触屏上只在确实要打字（快捷指令）时这样做，免得软键盘无故弹出 */
  const wantsInput = useRef(false);
  const returnFocus = (event: Event) => {
    const wanted = wantsInput.current;
    wantsInput.current = false;
    if (!wanted && !window.matchMedia?.('(pointer: fine)').matches) return;
    event.preventDefault();
    focusInput(wanted);
  };

  /* ── 听写 ── */
  const dictation = useDictation({
    getValue: () => inputValue.current,
    onChange: onInput,
    onError: (code) => toast.error(DICTATION_ERRORS[code] ?? (DICTATION_MESSAGES as Record<string, string>)[code] ?? '语音输入没有成功，请再试一次'),
    maxLength: MAX_LENGTH,
  });
  const { cancel: cancelDictation } = dictation;

  /* ── 斜杠指令 ── */
  const query = slashQuery(input);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const matches = query === null
    ? []
    : COMMANDS.filter((command) => !query || command.name.includes(query) || command.keys.some((key) => key.startsWith(query)));
  const commandsOpen = matches.length > 0 && !dismissed;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  // 筛选词一变就回到第一项，并重新打开被 Esc / 失焦收起的列表
  useEffect(() => { setActive(0); setDismissed(false); }, [query]);

  /** 在词首敲 @：打开「我的内容」挑一份带进对话，@ 本身不留在输入里 */
  const onType = (value: string) => {
    if (onAttachContent && value.length === input.length + 1 && value.endsWith('@') && value.startsWith(input) && /(^|\s)@$/.test(value)) {
      onAttachContent();
      return;
    }
    onInput(value);
  };

  const runCommand = (command: SlashCommand) => {
    onInput(command.prompt);
    focusInput(true);
  };
  const openCommands = () => {
    wantsInput.current = true;
    setDismissed(false);
    onInput('/');
    focusInput(true);
  };

  /* ── 发送 ── */
  const hasText = input.trim().length > 0;
  // 有资料可选却一份没勾才需要先选；完全没有资料时可以直接问模型
  const needsSources = sourceCount === 0 && !freeChat;
  const canSend = !busy && hasText && !needsSources;
  const sendHint = !hasText ? '输入问题后发送' : needsSources ? '先选择学习资料' : '发送';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !hasText) return;
    if (needsSources) {
      toast('先选择要学习的资料，再向小砚提问', { id: 'composer-no-sources' });
      return;
    }
    cancelDictation();
    onSubmit(event);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组字期间的回车、方向键都交给输入法
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (commandsOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        runCommand(matches[activeIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!busy) event.currentTarget.form?.requestSubmit();
    }
  };

  /** 点在输入框的留白上也进入输入 */
  const focusFromBlank = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) inputRef.current?.focus();
  };

  const currentMode = MODES.find((item) => item.value === mode) ?? MODES[0];
  const modes = MODES.filter((item) => item.value !== 'deep' || deepAvailable);
  const interactive = answerFormat === 'auto';
  const remaining = MAX_LENGTH - input.length;

  return (
    <div ref={wrapRef} className={s.wrap} data-expanded={engaged || hasText || attachments.length > 0 || dictation.listening || busy || undefined}>
      {commandsOpen && (
        <div className={s.commands} role="listbox" id={listId} aria-label="快捷指令">
          <p className={s.commandsTitle}>快捷指令</p>
          {matches.map((command, index) => (
            <button
              key={command.name}
              type="button"
              role="option"
              id={`${listId}-${index}`}
              aria-selected={index === activeIndex}
              className={s.command}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (index !== activeIndex) setActive(index); }}
              onClick={() => runCommand(command)}
            >
              <span className={s.commandIcon}>{command.icon}</span>
              <span className={s.commandText}><strong>/{command.name}</strong><small>{command.hint}</small></span>
              {index === activeIndex && <Kbd>↵</Kbd>}
            </button>
          ))}
        </div>
      )}

      <form ref={boxRef} className={s.box} data-listening={dictation.listening || undefined} onSubmit={submit} onClick={focusFromBlank}>
        {attachments.length > 0 && (
          <ul className={s.attachments} aria-label="已附加的文件与内容">
            {attachments.map((file) => (
              <li key={file.id} className={s.attachment} data-kind={file.kind ?? 'file'}>
                {file.kind === 'artifact' ? <Sparkles size={14} strokeWidth={1.75} /> : <FileText size={14} strokeWidth={1.75} />}
                <span title={file.title}>{file.title}</span>
                <button type="button" aria-label={`移除 ${file.title}`} onClick={() => onRemoveAttachment(file.id)}>
                  <X size={13} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={inputRef}
          className={s.input}
          rows={1}
          value={input}
          maxLength={MAX_LENGTH}
          aria-label="向小砚提问"
          aria-autocomplete="list"
          aria-controls={commandsOpen ? listId : undefined}
          aria-activedescendant={commandsOpen ? `${listId}-${activeIndex}` : undefined}
          placeholder={placeholder ?? (needsSources ? '先选好资料，再向小砚提问' : '向小砚提问，/ 用快捷指令，@ 引用我的内容')}
          enterKeyHint="send"
          onChange={(event) => onType(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { setDismissed(false); setEngaged(true); }}
          onBlur={() => { if (query !== null) setDismissed(true); }}
        />

        {intelligentAvailable && (
          <div className={s.formatBar}>
            <button
              type="button"
              className={s.formatSwitch}
              role="switch"
              aria-checked={interactive}
              aria-label="互动回答"
              onClick={() => onAnswerFormat(interactive ? 'text' : 'auto')}
            >
              <LayoutGrid {...ICON} />
              <span>互动回答</span>
              <span className={s.switchTrack} aria-hidden="true"><span /></span>
              <strong>{interactive ? '已开启' : '已关闭'}</strong>
            </button>
            <span className={s.formatHint}>{interactive ? '下次回答按需生成卡片、图表或自测' : '下次回答只用文字'}</span>
          </div>
        )}

        <div className={s.toolbar} onClick={focusFromBlank}>
          <div className={s.tools}>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={phone ? '资料、回答方式与指令' : '添加资料与指令'} round className={s.plus}><Plus size={18} strokeWidth={1.75} /></IconButton>
              </MenuTrigger>
              <MenuContent side="top" align="start" onCloseAutoFocus={returnFocus}>
                <MenuItem icon={<FolderOpen {...ICON} />} hint="把资料库里的文件加入这次对话" onSelect={onAttach}>从资料库选择文件</MenuItem>
                {onAttachContent && (
                  <MenuItem icon={<AtSign {...ICON} />} hint="笔记、导图、题目、AI 课、助理成果…" shortcut="@" onSelect={onAttachContent}>引用我的内容</MenuItem>
                )}
                <MenuItem icon={<BookOpen {...ICON} />} hint={sourceCount ? `已选 ${sourceCount} 份` : '还没有选资料'} onSelect={onOpenSources}>查看本课资料</MenuItem>
                {phone && (
                  <>
                    <MenuSeparator />
                    <MenuLabel>回答方式</MenuLabel>
                    {modes.map((item) => (
                      <MenuItem key={item.value} icon={item.icon} hint={item.hint} checked={item.value === mode} onSelect={() => onMode(item.value)}>
                        {item.label}
                      </MenuItem>
                    ))}
                  </>
                )}
                {/* 已经写了内容时不提供：它会把输入换成「/」 */}
                {!hasText && <MenuSeparator />}
                {!hasText && <MenuItem icon={<SquareSlash {...ICON} />} shortcut="/" onSelect={openCommands}>快捷指令</MenuItem>}
              </MenuContent>
            </Menu>

            <Menu>
              <MenuTrigger asChild>
                <button type="button" className={s.pill} data-kind="mode" data-default={mode === 'ask' || undefined} aria-label={`回答方式：${currentMode.label}`}>
                  {currentMode.icon}
                  <span className={s.pillText}>{currentMode.label}</span>
                  <ChevronDown size={13} strokeWidth={2} className={s.pillChevron} />
                </button>
              </MenuTrigger>
              <MenuContent side="top" align="start" onCloseAutoFocus={returnFocus}>
                <MenuLabel>回答方式</MenuLabel>
                {modes.map((item) => (
                  <MenuItem key={item.value} icon={item.icon} hint={item.hint} checked={item.value === mode} onSelect={() => onMode(item.value)}>
                    {item.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>

            <Tip label={sourceCount ? '查看本课资料' : freeChat ? '现在不带资料直接问；点这里可以添加资料' : '还没有选资料，点这里去选'}>
              <button
                type="button"
                className={s.pill}
                data-kind="sources"
                data-tone={needsSources ? 'warn' : undefined}
                aria-label={sourceCount ? `已选 ${sourceCount} 份资料` : freeChat ? '不带资料，直接问' : '先选资料'}
                onClick={onOpenSources}
              >
                <BookOpen {...ICON} />
                <span className={s.pillText}>{sourceCount ? `${sourceCount} 份资料` : freeChat ? '不带资料' : '先选资料'}</span>
              </button>
            </Tip>
          </div>

          <div className={s.sendGroup}>
            {demo ? (
              <span className={s.demoTag}>本地演示</span>
            ) : models.length > 0 ? (
              <div className={s.modelSlot}>
                <ModelPicker
                  models={models}
                  model={modelId}
                  effort={prefs.effort}
                  onModel={prefs.setModel}
                  onEffort={prefs.setEffort}
                  onReset={prefs.reset}
                />
              </div>
            ) : null}

            {dictation.supported && (
              <IconButton
                label={dictation.listening ? '结束语音输入' : '语音输入'}
                round
                className={s.mic}
                data-listening={dictation.listening || undefined}
                aria-pressed={dictation.listening}
                onClick={dictation.toggle}
              >
                <Mic size={17} strokeWidth={1.75} />
              </IconButton>
            )}

            {busy ? (
              <Tip label="停止生成">
                <button type="button" className={s.send} data-stop aria-label="停止生成" onClick={onStop}>
                  <Square size={12} strokeWidth={0} fill="currentColor" />
                </button>
              </Tip>
            ) : (
              <Tip label={sendHint}>
                <button type="submit" className={s.send} aria-label="发送" aria-disabled={!canSend}>
                  <ArrowUp size={18} strokeWidth={2.25} />
                </button>
              </Tip>
            )}
          </div>
        </div>
      </form>

      <p className={s.foot}>
        <span>{freeChat && !sourceCount ? '当前未选择资料，回答基于通用知识，重要结论请核实' : '回答基于所选资料，重要结论请核对原文'}</span>
        {dictation.listening ? (
          <span className={s.footLive} role="status">正在听写，再点一次麦克风结束</span>
        ) : remaining <= 300 ? (
          <span className={s.footCount} data-full={remaining <= 0 || undefined}>还可输入 {Math.max(0, remaining)} 字</span>
        ) : (
          <span className={s.footKeys}>Enter 发送 · Shift + Enter 换行</span>
        )}
      </p>
    </div>
  );
}
