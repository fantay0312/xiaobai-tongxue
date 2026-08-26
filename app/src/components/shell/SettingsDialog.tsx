/**
 * 设置弹窗 —— 居中双栏册页:左侧目录,右侧详情(2026-07-13 由右侧抽屉改制,DESIGN.md 弹层豁免已扩入)。
 * LlmSettings 表单:proxy/mock/api 模式切换 + 小白台词温度。
 * 评估与状态机永远本地规则运行,LLM 只负责理解与台词。
 * 滚动锁与拜师帖(MentorLetter)逐行同款:doc+body 双锁 + 「别人持锁就不抢」守卫,改一处必对照另一处。
 */
import {
  useEffect, useId, useRef, useState,
  type ComponentProps, type CSSProperties, type KeyboardEvent, type MouseEvent,
} from 'react';
import { useAppStore } from '../../store/appStore';
import { UI_THEMES, UI_TONES, useThemeStore, type UiTheme } from '../../store/themeStore';
import { llmCall } from '../../engine';
import { Icon, type IconName } from '../ui/Icon';
import { isTourDone, resetTours, type TourKey } from '../tour/tourState';
import styles from './SettingsDialog.module.css';

type TestState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string };

type TabId = 'look' | 'engine' | 'voice' | 'temper' | 'tour';

const TABS: { id: TabId; label: string; note: string; icon: IconName }[] = [
  { id: 'look', label: '外观主题', note: '昼夜与音乐', icon: 'sparkles' },
  { id: 'engine', label: '台词引擎', note: '模型与线路', icon: 'pen' },
  { id: 'voice', label: '语音输入', note: '口述转文字', icon: 'mic' },
  { id: 'temper', label: '台词性情', note: '沉稳或活泼', icon: 'sprout' },
  { id: 'tour', label: '新手引路', note: '重走学习路线', icon: 'route' },
];

const THEME_OPTIONS: {
  id: UiTheme;
  name: string;
  desc: string;
  swatches: readonly string[];
}[] = [
  {
    id: 'paper',
    name: '老学堂 · 票据',
    desc: '奶油纸、铅字小签与赭陶邮戳。现行默认视觉，功能与阅读气质不变。',
    swatches: [
      'oklch(0.959 0.010 87.5)',
      'oklch(0.601 0.143 38.4)',
      'oklch(0.847 0.161 83.4)',
      'oklch(0.247 0.004 90)',
    ],
  },
  {
    id: 'anime',
    name: '日系动漫 · 赛璐珞',
    desc: '取色自小白的立绘：奶油画板、藍衣冷影、朱色点睛。平涂硬边、網点上灰，不改课程与交互。',
    swatches: [
      'oklch(0.968 0.019 74)',
      'oklch(0.462 0.098 252.4)',
      'oklch(0.925 0.062 86)',
      'oklch(0.498 0.165 27.5)',
    ],
  },
  {
    id: 'tech',
    name: '科技 · 霓虹',
    desc: '近黑底、电青描边与像素题头。竖条波纹只作氛围，不改课程与交互。',
    swatches: [
      'oklch(0.168 0.026 260.4)',
      'oklch(0.780 0.148 210.4)',
      'oklch(0.712 0.214 328.6)',
      'oklch(0.938 0.018 228.4)',
    ],
  },
];

const ENGINE_MODES = [
  { mode: 'proxy', name: '服务器模式', desc: '走服务器网关调大模型,密钥不出服务器(需登录)' },
  { mode: 'mock', name: '演示模式', desc: '零依赖,内置教学引擎,断网也能完整跑通' },
  { mode: 'api', name: '自定义 API', desc: '浏览器直连自己的 OpenAI 兼容端点(密钥存本机)' },
] as const;

const ASR_MODES = [
  { mode: 'proxy', name: '服务器模式', desc: '走服务器网关转写,密钥不出服务器(需登录)' },
  { mode: 'api', name: '自定义 API', desc: '浏览器直连自己的转写端点(密钥存本机)' },
] as const;

/* 温度档位的口吻注解:描述倾向,不许诺具体行为(台词仍由引擎定) */
const TEMPER_BANDS: { max: number; name: string; line: string }[] = [
  { max: 0.35, name: '沉稳', line: '字斟句酌,句句落在点上,很少发散。' },
  { max: 0.95, name: '平和', line: '偶尔打个比方,大体跟着你的思路走。' },
  { max: Infinity, name: '活泼', line: '爱举例子也爱追问,时不时蹦出个新鲜联想。' },
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
      setTest({ status: 'fail', detail: `连接失败:${e instanceof Error ? e.message : String(e)}` });
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
  const activeIndex = TABS.findIndex((tab) => tab.id === active) + 1;

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
        <header className={styles.head}>
          <div className={styles.headCopy}>
            <p className={styles.eyebrow}>书斋偏好</p>
            <h2 id="settings-title" className={styles.title}>设置</h2>
          </div>
          <div className={styles.headActions}>
            <span className={styles.saveState}><Icon name="circle-check" size={14} />自动保存至本机</span>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭设置">
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <nav
            className={styles.rail}
            role="tablist"
            aria-label="设置目录"
            aria-orientation={narrow ? 'horizontal' : 'vertical'}
            onKeyDown={onTabsKey}
          >
            <div className={styles.railHead} aria-hidden="true">
              <span>设置目录</span><small>{String(TABS.length).padStart(2, '0')} 项</small>
            </div>
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
                <Icon name={t.icon} size={15} className={styles.railIcon} />
                <span className={styles.railCopy}><strong>{t.label}</strong><small>{t.note}</small></span>
              </button>
            ))}
            <p className={styles.railFoot} aria-hidden="true"><Icon name="check" size={13} />调整后即时生效</p>
          </nav>

          <div
            className={styles.pane}
            role="tabpanel"
            id={`settings-pane-${active}`}
            aria-labelledby={`settings-tab-${active}`}
          >
            {active === 'look' && (
              <>
                <div className={styles.paneHead}>
                  <p className={styles.paneEyebrow}>偏好 {String(activeIndex).padStart(2, '0')}</p>
                  <h3 className={styles.paneTitle}>外观主题</h3>
                  <p className={styles.paneDesc}>
                    只换视觉语言，不改课程、路由或学习记录。选择会记在本机，下次打开仍在。
                  </p>
                </div>

                <div className={styles.themeGroup} role="radiogroup" aria-label="外观主题">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={selected ? `${styles.themeCard} ${styles.themeCardActive}` : styles.themeCard}
                        onClick={() => setTheme(option.id)}
                      >
                        <span className={styles.themeSwatches} aria-hidden="true">
                          {option.swatches.map((color) => (
                            <i key={color} style={{ background: color }} />
                          ))}
                        </span>
                        <span className={styles.themeName}>{option.name}</span>
                        <span className={styles.themeDesc}>{option.desc}</span>
                      </button>
                    );
                  })}
                </div>
                {theme === 'anime' && (
                  <div className={styles.toneGroup} role="radiogroup" aria-label="日景板或夜景板">
                    {UI_TONES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={tone === option}
                        className={tone === option ? `${styles.toneBtn} ${styles.toneBtnActive}` : styles.toneBtn}
                        onClick={() => setTone(option)}
                      >
                        <Icon name={option === 'day' ? 'sun' : 'moon'} size={15} />
                        {option === 'day' ? '日景板' : '夜景板'}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className={musicOn ? `${styles.musicBtn} ${styles.musicBtnOn}` : styles.musicBtn}
                  onClick={() => setMusicOn(!musicOn)}
                  aria-pressed={musicOn}
                >
                  <Icon name={musicOn ? 'volume' : 'volume-off'} size={16} />
                  <span>
                    <strong>{musicOn ? '背景音乐开' : '背景音乐关'}</strong>
                    <small>使用 sharyap 同款循环曲，可随时关掉</small>
                  </span>
                </button>

                <p className={styles.hint}>
                  {UI_THEMES.length} 套主题可随时来回切换；动漫主题可再切日景板/夜景板。讲解舱黑板场景保持夜自习。
                </p>
              </>
            )}

            {active === 'engine' && (
              <>
                <div className={styles.paneHead}>
                  <p className={styles.paneEyebrow}>偏好 {String(activeIndex).padStart(2, '0')}</p>
                  <h3 className={styles.paneTitle}>台词引擎</h3>
                  <p className={styles.paneDesc}>选择小白台词的生成线路；线路失败时会降级为演示模式，课程不中断。</p>
                </div>

                <ModeGroup
                  label="台词引擎模式"
                  options={ENGINE_MODES}
                  value={settings.mode}
                  onSelect={(mode) => { setSettings({ mode }); setTest({ status: 'idle' }); }}
                />

                {settings.mode === 'proxy' && (
                  <div className={styles.fields}>
                    <hr className={styles.split} />
                    <ConnTest onTest={runTest} test={test} />
                    <p className={styles.hint}>密钥与模型由服务器代管,浏览器只传对话内容;需登录后才可调用(llm-auth 表示未登录)。</p>
                  </div>
                )}

                {settings.mode === 'api' && (
                  <div className={styles.fields}>
                    <hr className={styles.split} />
                    <Field
                      label="Base URL"
                      type="url"
                      value={settings.baseUrl}
                      placeholder="https://api.deepseek.com/v1"
                      spellCheck={false}
                      onChange={(e) => { setSettings({ baseUrl: e.target.value }); setTest({ status: 'idle' }); }}
                    />
                    <SecretField
                      label="API Key"
                      value={settings.apiKey}
                      placeholder="sk-…"
                      autoComplete="off"
                      onChange={(e) => { setSettings({ apiKey: e.target.value }); setTest({ status: 'idle' }); }}
                    />
                    <Field
                      label="模型"
                      type="text"
                      value={settings.model}
                      placeholder="如 deepseek-v4-flash"
                      spellCheck={false}
                      onChange={(e) => { setSettings({ model: e.target.value }); setTest({ status: 'idle' }); }}
                    />
                    <ConnTest
                      disabled={!settings.baseUrl || !settings.apiKey || !settings.model}
                      onTest={runTest}
                      test={test}
                    />
                    <p className={styles.hint}>任何 OpenAI 兼容端点(/chat/completions)均可;密钥只存在本机浏览器,不上传。</p>
                  </div>
                )}
              </>
            )}

            {active === 'voice' && (
              <>
                <div className={styles.paneHead}>
                  <p className={styles.paneEyebrow}>偏好 {String(activeIndex).padStart(2, '0')}</p>
                  <h3 className={styles.paneTitle}>语音输入</h3>
                  <p className={styles.paneDesc}>讲课页输入框旁的麦克风,把课堂口述转成文字。</p>
                </div>

                <ModeGroup
                  label="语音转写引擎模式"
                  options={ASR_MODES}
                  value={asr.mode}
                  onSelect={(mode) => setAsrSettings({ mode })}
                />

                <div className={styles.fields}>
                  <hr className={styles.split} />
                  {asr.mode === 'api' ? (
                    <>
                      <Field
                        label="Base URL"
                        type="url"
                        value={asr.baseUrl}
                        placeholder="https://openrouter.ai/api/v1"
                        spellCheck={false}
                        onChange={(e) => setAsrSettings({ baseUrl: e.target.value })}
                      />
                      <SecretField
                        label="API Key"
                        value={asr.apiKey}
                        placeholder="sk-…"
                        autoComplete="off"
                        onChange={(e) => setAsrSettings({ apiKey: e.target.value })}
                      />
                      <Field
                        label="模型"
                        type="text"
                        value={asr.model}
                        placeholder="如 qwen/qwen3-asr-flash-2026-02-10"
                        spellCheck={false}
                        onChange={(e) => setAsrSettings({ model: e.target.value })}
                      />
                      <p className={styles.hint}>任何 OpenAI 兼容转写端点(/audio/transcriptions)均可;密钥只存在本机浏览器,不上传、也不随学习存档同步。</p>
                    </>
                  ) : (
                    <p className={styles.hint}>转写密钥由服务器代管,需登录后使用。</p>
                  )}
                </div>
              </>
            )}

            {active === 'temper' && (
              <>
                <div className={styles.paneHead}>
                  <p className={styles.paneEyebrow}>偏好 {String(activeIndex).padStart(2, '0')}</p>
                  <h3 className={styles.paneTitle}>台词性情</h3>
                  <p className={styles.paneDesc}>只影响小白说话的活泼程度;讲解评估恒用 temperature 0,保证判定一致。</p>
                </div>

                <div className={styles.sliderRow}>
                  <span className={styles.sliderEnd}>沉稳</span>
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
                  />
                  <span className={styles.sliderEnd}>活泼</span>
                  <span className={styles.sliderValue}>{settings.temperature.toFixed(2)}</span>
                </div>

                <div className={styles.temperNote} aria-live="polite">
                  <span className={styles.temperName}>{band.name}</span>
                  <span className={styles.temperLine}>{band.line}</span>
                </div>
              </>
            )}

            {active === 'tour' && (
              <>
                <div className={styles.paneHead}>
                  <p className={styles.paneEyebrow}>偏好 {String(activeIndex).padStart(2, '0')}</p>
                  <h3 className={styles.paneTitle}>新手引路</h3>
                  <p className={styles.paneDesc}>
                    小白带你把门厅、备课桌、讲解舱各认一遍路;每处只自动引一次。重新引路只清引路痕迹,不动学习记录。
                  </p>
                </div>

                {/* 引路痕迹是 localStorage 快照:弹窗开着时引路无从推进,渲染时读一次即够新 */}
                <ul className={styles.tourList}>
                  {TOUR_STOPS.map((t) => {
                    const done = isTourDone(t.key);
                    return (
                      <li key={t.key} className={styles.tourRow}>
                        <span className={styles.tourName}>{t.name}</span>
                        {done ? (
                          <span className={styles.tourDone}>
                            <Icon name="check" size={13} className={styles.tourDoneIcon} />
                            已走过
                          </span>
                        ) : (
                          <span className={styles.tourTodo}>还没走</span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {/* 清痕后立即关窗:当前页若有引路会随即上前,也避免弹窗与引路的 Esc 抢按键 */}
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    resetTours();
                    onClose();
                  }}
                >
                  重新引路
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 单选卡组:台词引擎与语音转写共用一套形制,改样式/无障碍属性只改这一处 */
function ModeGroup<M extends string>({ label, options, value, onSelect }: {
  label: string;
  options: readonly { mode: M; name: string; desc: string }[];
  value: M;
  onSelect: (mode: M) => void;
}) {
  return (
    <div className={styles.modeGroup} role="radiogroup" aria-label={label}>
      {options.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={value === m.mode}
          className={value === m.mode ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
          onClick={() => onSelect(m.mode)}
        >
          <span className={styles.modeDot} aria-hidden="true" />
          <span className={styles.modeName}>{m.name}</span>
          <span className={styles.modeDesc}>{m.desc}</span>
        </button>
      ))}
    </div>
  );
}

/** 表单行:标签 + 输入框(六个凭据字段共用) */
function Field({ label, ...input }: { label: string } & ComponentProps<'input'>) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input className={styles.input} {...input} />
    </label>
  );
}

function SecretField({ label, ...input }: { label: string } & Omit<ComponentProps<'input'>, 'type'>) {
  const [revealed, setRevealed] = useState(false);
  const generatedId = useId();
  const inputId = input.id ?? generatedId;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={inputId}>{label}</label>
      <span className={styles.secretInput}>
        <input className={styles.input} id={inputId} type={revealed ? 'text' : 'password'} {...input} />
        <button
          type="button"
          className={styles.revealButton}
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? '隐藏 API Key' : '显示 API Key'}
          aria-pressed={revealed}
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} size={16} />
        </button>
      </span>
    </div>
  );
}

/** 连接测试行:按钮 + 结果(成功靛青对钩,失败朱砂警示) */
function ConnTest({ disabled = false, onTest, test }: { disabled?: boolean; onTest: () => void; test: TestState }) {
  return (
    <div className={styles.testRow}>
      <button
        type="button"
        className={styles.actionBtn}
        onClick={onTest}
        disabled={disabled || test.status === 'busy'}
      >
        {test.status === 'busy' ? '测试中…' : '测试连接'}
      </button>
      {(test.status === 'ok' || test.status === 'fail') && (
        <span className={test.status === 'ok' ? `${styles.testStatus} ${styles.testOk}` : `${styles.testStatus} ${styles.testFail}`}>
          <Icon name={test.status === 'ok' ? 'circle-check' : 'circle-x'} size={14} className={styles.testIcon} />
          {test.detail}
        </span>
      )}
    </div>
  );
}
