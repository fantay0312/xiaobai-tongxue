/**
 * 设置弹窗 —— 居中双栏:左侧目录,右侧一列「标签 + 右侧控件」的设置行(2026-08-29 改为极简制式:
 * 不带眉批、编号、说明卡;每行一件事,细线分隔,控件靠右)。
 * LlmSettings 表单:proxy/mock/api 模式切换 + 小白台词温度。
 * 评估与状态机永远本地规则运行,LLM 只负责理解与台词。
 * 滚动锁与拜师帖(MentorLetter)逐行同款:doc+body 双锁 + 「别人持锁就不抢」守卫,改一处必对照另一处。
 */
import {
  useEffect, useId, useRef, useState,
  type ComponentProps, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../store/appStore';
import { UI_TONES, useThemeStore, type UiTheme, type UiTone } from '../../store/themeStore';
import { llmCall } from '../../engine';
import { relDay } from '../../lib/relDay';
import { Icon, type IconName } from '../ui/Icon';
import { isTourDone, resetTours, type TourKey } from '../tour/tourState';
import styles from './SettingsDialog.module.css';

type TestState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string };

type TabId = 'look' | 'engine' | 'voice' | 'temper' | 'memory' | 'tour';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'look', label: '外观', icon: 'lamp' },
  { id: 'engine', label: '台词引擎', icon: 'pen' },
  { id: 'voice', label: '语音输入', icon: 'mic' },
  { id: 'temper', label: '台词性情', icon: 'sprout' },
  { id: 'memory', label: '记忆', icon: 'book-open' },
  { id: 'tour', label: '新手引路', icon: 'route' },
];

/* 三套主题:全名进 title/读屏,分段钮只显短名;色点取该主题的主色 */
const THEME_OPTIONS: { id: UiTheme; name: string; short: string; dot: string }[] = [
  { id: 'paper', name: '老学堂 · 票据', short: '老学堂', dot: 'oklch(0.601 0.143 38.4)' },
  { id: 'anime', name: '日系动漫 · 赛璐珞', short: '日系动漫', dot: 'oklch(0.462 0.098 252.4)' },
  { id: 'tech', name: '科技 · 霓虹', short: '科技', dot: 'oklch(0.780 0.148 210.4)' },
];

const TONE_OPTIONS: { id: UiTone; name: string; short: string }[] = UI_TONES.map((option) => ({
  id: option,
  name: option === 'day' ? '日景板' : '夜景板',
  short: option === 'day' ? '日景' : '夜景',
}));

const ENGINE_MODES = [
  { id: 'proxy', short: '服务器', name: '服务器模式', desc: '走服务器网关调用模型，密钥不出服务器，需登录。' },
  { id: 'mock', short: '演示', name: '演示模式', desc: '内置教学引擎，零依赖，断网也能完整跑通。' },
  { id: 'api', short: '自定义', name: '自定义 API', desc: '浏览器直连自己的 OpenAI 兼容端点，密钥只存本机。' },
] as const;

const ASR_MODES = [
  { id: 'proxy', short: '服务器', name: '服务器模式', desc: '走服务器网关转写，密钥不出服务器，需登录。' },
  { id: 'api', short: '自定义', name: '自定义 API', desc: '浏览器直连自己的转写端点，密钥只存本机。' },
] as const;

/* 温度档位的口吻注解:描述倾向,不许诺具体行为(台词仍由引擎定) */
const TEMPER_BANDS: { max: number; name: string; line: string }[] = [
  { max: 0.35, name: '沉稳', line: '字斟句酌，句句落在点上，很少发散。' },
  { max: 0.95, name: '平和', line: '偶尔打个比方，大体跟着你的思路走。' },
  { max: Infinity, name: '活泼', line: '爱举例子也爱追问，时不时蹦出个新鲜联想。' },
];

const temperBand = (t: number) =>
  TEMPER_BANDS.find((b) => t < b.max) ?? TEMPER_BANDS[TEMPER_BANDS.length - 1];

/* 三处引路与站内叫法一致:门厅(/study)、备课桌(/prep)、讲解舱(/teach) */
const TOUR_STOPS: { key: TourKey; name: string }[] = [
  { key: 'home', name: '门厅' },
  { key: 'prep', name: '备课桌' },
  { key: 'teach', name: '讲解舱' },
];

/* 焦点圈成员:凡 tabindex=-1 的(未选中目录项)不入圈;
   末项 [tabindex] 兜底,将来窗里若添自定义可聚焦元素也不会漏出圈 */
const FOCUSABLE =
  'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** 退场余像时长:比 --t-fast(160ms) 略宽,给 cardOut 留完场 */
const EXIT_MS = 190;

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const asr = useAppStore((s) => s.asrSettings);
  const setAsrSettings = useAppStore((s) => s.setAsrSettings);
  const memory = useAppStore((s) => s.memory);
  const setMemoryPaused = useAppStore((s) => s.setMemoryPaused);
  const navigate = useNavigate();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const tone = useThemeStore((s) => s.tone);
  const setTone = useThemeStore((s) => s.setTone);
  const musicOn = useThemeStore((s) => s.musicOn);
  const setMusicOn = useThemeStore((s) => s.setMusicOn);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [active, setActive] = useState<TabId>(TABS[0].id);
  /* 退场余像:open 落下后窗多留 EXIT_MS 播退场动画,再真正卸载 */
  const [render, setRender] = useState(open);
  /* 窄屏目录横排时把 tablist 朝向如实报给读屏(断点须与 module.css 的 720 咬合) */
  const [narrow, setNarrow] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropArmed = useRef(false);

  const runTest = async () => {
    setTest({ status: 'busy' });
    const t0 = performance.now();
    try {
      const reply = await llmCall(
        'xiaobai',
        { system: '你是连接测试,收到任何消息都只回复两个字:在的', user: 'ping' },
        { ...settings, temperature: 0 },
      );
      const ms = Math.round(performance.now() - t0);
      setTest({ status: 'ok', detail: `连接成功 · ${ms}ms · ${reply.trim().slice(0, 24)}` });
    } catch (e) {
      setTest({ status: 'fail', detail: `连接失败：${e instanceof Error ? e.message : String(e)}` });
    }
  };

  /* 开:立即上场。关:留退场余像,谢幕后才翻回首章、清测试结果(余像期间不换面) */
  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    if (!dialogRef.current) return; // 从未开过:无需退场
    const settle = () => {
      setRender(false);
      setActive(TABS[0].id);
      setTest({ status: 'idle' });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle();
      return;
    }
    const id = window.setTimeout(settle, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  /* 打开即收焦点进弹窗;关闭当即归还焦点(不等退场余像) */
  useEffect(() => {
    if (!open) return;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      returnTarget?.focus();
    };
  }, [open]);

  /* 弹窗打开时锁定背后页面滚动;补上滚动条宽度,经典滚动条系统(Windows)不横跳。
     别人(拜师帖)已持锁就不抢:否则本效应把「hidden」记成原值,两层先后关闭会还原出永久锁 */
  useEffect(() => {
    if (!open) return;
    const docStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    if (docStyle.overflow === 'hidden' || bodyStyle.overflow === 'hidden') return;
    const prev = { doc: docStyle.overflow, body: bodyStyle.overflow, pad: bodyStyle.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    docStyle.overflow = 'hidden';
    bodyStyle.overflow = 'hidden';
    if (gutter > 0) bodyStyle.paddingRight = `${gutter}px`;
    return () => {
      docStyle.overflow = prev.doc;
      bodyStyle.overflow = prev.body;
      bodyStyle.paddingRight = prev.pad;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [open]);

  /** 罩上「按下」才算数:从输入框选中文字拖出窗外松手,click 会落在罩上——不能误关 */
  const onBackdropDown = (e: MouseEvent<HTMLDivElement>) => {
    backdropArmed.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (backdropArmed.current && e.target === e.currentTarget) onClose();
    backdropArmed.current = false;
  };

  /* Esc 关窗 + 最小 Tab 焦点圈:首尾相接,焦点出不了窗 */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /* 目录是标准 tablist:方向键换章,焦点随选中走 */
  const onTabsKey = (e: KeyboardEvent<HTMLElement>) => {
    const idx = TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next].id;
    setActive(id);
    document.getElementById(`settings-tab-${id}`)?.focus();
  };

  if (!render) return null;

  const band = temperBand(settings.temperature);
  const activeTab = TABS.find((tab) => tab.id === active) ?? TABS[0];
  const engineMode = ENGINE_MODES.find((m) => m.id === settings.mode) ?? ENGINE_MODES[0];
  const asrMode = ASR_MODES.find((m) => m.id === asr.mode) ?? ASR_MODES[0];
  const apiReady = Boolean(settings.baseUrl && settings.apiKey && settings.model);
  const memoryCount = memory.items.filter((it) => !it.muted).length;
  const memoryProfile = memory.profile;

  return (
    <div
      className={open ? styles.overlay : `${styles.overlay} ${styles.overlayOut}`}
      aria-hidden={open ? undefined : true}
      onMouseDown={onBackdropDown}
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <nav
          className={styles.rail}
          role="tablist"
          aria-label="设置目录"
          aria-orientation={narrow ? 'horizontal' : 'vertical'}
          onKeyDown={onTabsKey}
        >
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭设置">
            <Icon name="x" size={18} />
          </button>
          <div className={styles.railList}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`settings-tab-${t.id}`}
                aria-selected={active === t.id}
                aria-controls={`settings-pane-${t.id}`}
                tabIndex={active === t.id ? 0 : -1}
                className={styles.railBtn}
                onClick={() => setActive(t.id)}
              >
                <Icon name={t.icon} size={17} className={styles.railIcon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div
          className={styles.pane}
          role="tabpanel"
          id={`settings-pane-${active}`}
          aria-labelledby={`settings-tab-${active}`}
        >
          <h2 id="settings-title" className={styles.paneTitle}>{activeTab.label}</h2>

          {active === 'look' && (
            <div className={styles.rows}>
              <Row label="主题" note="只换视觉，不改课程与学习记录">
                <Segmented
                  label="主题"
                  options={THEME_OPTIONS}
                  value={theme}
                  onSelect={(option) => setTheme(option.id)}
                />
              </Row>
              {theme === 'anime' && (
                <Row label="景板">
                  <Segmented
                    label="日景板或夜景板"
                    options={TONE_OPTIONS}
                    value={tone}
                    onSelect={({ id: option }) => setTone(option)}
                  />
                </Row>
              )}
              <Row label="背景音乐" note="循环播放，随时可关">
                <Switch label="背景音乐" checked={musicOn} onChange={() => setMusicOn(!musicOn)} />
              </Row>
            </div>
          )}

          {active === 'engine' && (
            <div className={styles.rows}>
              <Row label="线路" note={engineMode.desc}>
                <Segmented
                  label="台词引擎模式"
                  options={ENGINE_MODES}
                  value={settings.mode}
                  onSelect={(option) => { setSettings({ mode: option.id }); setTest({ status: 'idle' }); }}
                />
              </Row>

              {settings.mode === 'proxy' && (
                <Row label="连接" note="线路失败时会降级为演示模式，课程不中断">
                  <ConnTest onTest={runTest} test={test} />
                </Row>
              )}

              {settings.mode === 'api' && (
                <>
                  <Row label="Base URL">
                    <input
                      className={styles.input}
                      type="url"
                      value={settings.baseUrl}
                      placeholder="https://api.deepseek.com/v1"
                      spellCheck={false}
                      aria-label="Base URL"
                      onChange={(e) => { setSettings({ baseUrl: e.target.value }); setTest({ status: 'idle' }); }}
                    />
                  </Row>
                  <Row label="API Key" note="只存本机浏览器，不上传">
                    <SecretInput
                      label="API Key"
                      value={settings.apiKey}
                      placeholder="sk-…"
                      autoComplete="off"
                      onChange={(e) => { setSettings({ apiKey: e.target.value }); setTest({ status: 'idle' }); }}
                    />
                  </Row>
                  <Row label="模型">
                    <input
                      className={styles.input}
                      type="text"
                      value={settings.model}
                      placeholder="如 deepseek-v4-flash"
                      spellCheck={false}
                      aria-label="模型"
                      onChange={(e) => { setSettings({ model: e.target.value }); setTest({ status: 'idle' }); }}
                    />
                  </Row>
                  <Row label="连接" note="任何 OpenAI 兼容端点（/chat/completions）均可">
                    <ConnTest disabled={!apiReady} onTest={runTest} test={test} />
                  </Row>
                </>
              )}
            </div>
          )}

          {active === 'voice' && (
            <div className={styles.rows}>
              <Row label="线路" note={asrMode.desc}>
                <Segmented
                  label="语音转写引擎模式"
                  options={ASR_MODES}
                  value={asr.mode}
                  onSelect={(option) => setAsrSettings({ mode: option.id })}
                />
              </Row>
              {asr.mode === 'api' && (
                <>
                  <Row label="Base URL">
                    <input
                      className={styles.input}
                      type="url"
                      value={asr.baseUrl}
                      placeholder="https://openrouter.ai/api/v1"
                      spellCheck={false}
                      aria-label="转写 Base URL"
                      onChange={(e) => setAsrSettings({ baseUrl: e.target.value })}
                    />
                  </Row>
                  <Row label="API Key" note="只存本机浏览器，不上传、不随学习存档同步">
                    <SecretInput
                      label="转写 API Key"
                      value={asr.apiKey}
                      placeholder="sk-…"
                      autoComplete="off"
                      onChange={(e) => setAsrSettings({ apiKey: e.target.value })}
                    />
                  </Row>
                  <Row label="模型" note="任何 OpenAI 兼容转写端点（/audio/transcriptions）均可">
                    <input
                      className={styles.input}
                      type="text"
                      value={asr.model}
                      placeholder="如 qwen/qwen3-asr-flash-2026-02-10"
                      spellCheck={false}
                      aria-label="转写模型"
                      onChange={(e) => setAsrSettings({ model: e.target.value })}
                    />
                  </Row>
                </>
              )}
              <p className={styles.foot}>讲课页输入框旁的麦克风，把课堂口述转成文字。</p>
            </div>
          )}

          {active === 'temper' && (
            <div className={styles.rows}>
              <Row label="活泼程度" note={`${band.name} · ${band.line}`}>
                <span className={styles.sliderWrap}>
                  <input
                    className={styles.slider}
                    style={{ '--fill': `${(settings.temperature / 1.5) * 100}%` } as CSSProperties}
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={settings.temperature}
                    onChange={(e) => setSettings({ temperature: Number(e.target.value) })}
                    aria-label="小白台词温度"
                    aria-valuetext={`${settings.temperature.toFixed(2)}，${band.name}`}
                  />
                  <span className={styles.sliderValue}>{settings.temperature.toFixed(2)}</span>
                </span>
              </Row>
              <p className={styles.foot}>只影响小白说话的活泼程度；讲解评估恒用 temperature 0，判定不受影响。</p>
            </div>
          )}

          {active === 'memory' && (
            <div className={styles.rows}>
              <Row label="记忆" note="关掉后上课不再记新的，已记的照旧">
                <Switch label="记忆" checked={!memory.paused} onChange={() => setMemoryPaused(!memory.paused)} />
              </Row>
              <Row label="已记住">
                <span className={styles.stateTodo}>{memoryCount > 0 ? `${memoryCount} 条` : '还没有'}</span>
              </Row>
              <Row
                label="画像"
                note={memoryProfile
                  ? `整理于 ${relDay(memoryProfile.updatedAt)} · 凭 ${memoryProfile.basis.sessionCount} 堂课`
                  : '讲完一课后自动整理'}
              >
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => { onClose(); navigate('/growth#memory-ledger'); }}
                >
                  去记忆匣整理
                </button>
              </Row>
              <p className={styles.foot}>只记先生的讲法与习惯，不记用户名、邮箱与手机号。</p>
            </div>
          )}

          {active === 'tour' && (
            <div className={styles.rows}>
              {/* 引路痕迹是 localStorage 快照:弹窗开着时引路无从推进,渲染时读一次即够新 */}
              {TOUR_STOPS.map((t) => {
                const done = isTourDone(t.key);
                return (
                  <Row key={t.key} label={t.name}>
                    <span className={done ? styles.stateDone : styles.stateTodo}>
                      {done && <Icon name="check" size={14} />}
                      {done ? '已走过' : '未走过'}
                    </span>
                  </Row>
                );
              })}
              {/* 清痕后立即关窗:当前页若有引路会随即上前,也避免弹窗与引路的 Esc 抢按键 */}
              <Row label="重新引路" note="只清引路痕迹，不动学习记录">
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    resetTours();
                    onClose();
                  }}
                >
                  重新引路
                </button>
              </Row>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 设置行:左标签(可带一行注),右控件;细线分隔 */
function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowCopy}>
        <span className={styles.rowLabel}>{label}</span>
        {note ? <span className={styles.rowNote}>{note}</span> : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** 分段单选:主题/景板/线路共用一套形制 */
function Segmented<O extends { id: string; short: string; name?: string; dot?: string }>({
  label, options, value, onSelect,
}: {
  label: string;
  options: readonly O[];
  value: O['id'];
  onSelect: (option: O) => void;
}) {
  return (
    <div className={styles.seg} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          aria-label={option.name ?? option.short}
          title={option.name}
          className={styles.segBtn}
          onClick={() => onSelect(option)}
        >
          {option.dot ? <i className={styles.segDot} style={{ background: option.dot }} aria-hidden="true" /> : null}
          {option.short}
        </button>
      ))}
    </div>
  );
}

/** 开关 */
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.switch}
      onClick={onChange}
    />
  );
}

function SecretInput({ label, ...input }: { label: string } & Omit<ComponentProps<'input'>, 'type'>) {
  const [revealed, setRevealed] = useState(false);
  const generatedId = useId();
  const inputId = input.id ?? generatedId;
  return (
    <span className={styles.secretInput}>
      <input
        className={styles.input}
        id={inputId}
        type={revealed ? 'text' : 'password'}
        aria-label={label}
        {...input}
      />
      <button
        type="button"
        className={styles.revealButton}
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? `隐藏 ${label}` : `显示 ${label}`}
        aria-pressed={revealed}
      >
        <Icon name={revealed ? 'eye-off' : 'eye'} size={16} />
      </button>
    </span>
  );
}

/** 连接测试:按钮 + 结果一行 */
function ConnTest({ disabled = false, onTest, test }: { disabled?: boolean; onTest: () => void; test: TestState }) {
  return (
    <span className={styles.testWrap}>
      {(test.status === 'ok' || test.status === 'fail') && (
        <span className={test.status === 'ok' ? `${styles.testStatus} ${styles.testOk}` : `${styles.testStatus} ${styles.testFail}`}>
          <Icon name={test.status === 'ok' ? 'circle-check' : 'circle-x'} size={14} className={styles.testIcon} />
          {test.detail}
        </span>
      )}
      <button
        type="button"
        className={styles.btn}
        onClick={onTest}
        disabled={disabled || test.status === 'busy'}
      >
        {test.status === 'busy' ? '测试中…' : '测试连接'}
      </button>
    </span>
  );
}
