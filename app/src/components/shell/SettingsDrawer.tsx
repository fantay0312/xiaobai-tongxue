/**
 * 设置抽屉 —— 右侧滑出(非弹窗)。
 * LlmSettings 表单:mock/api 模式切换 + 小白台词温度。
 * 评估与状态机永远本地规则运行,LLM 只负责理解与台词。
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { llmCall } from '../../engine';
import { Icon } from '../ui/Icon';
import { resetTours } from '../tour/tourState';
import styles from './SettingsDrawer.module.css';

type TestState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string };

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const asr = useAppStore((s) => s.asrSettings);
  const setAsrSettings = useAppStore((s) => s.setAsrSettings);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const panelRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnTarget?.focus();
    };
  }, [open, onClose]);

  // 抽屉打开时锁定背后页面滚动;补上滚动条宽度,经典滚动条系统(Windows)不横跳
  useEffect(() => {
    if (!open) return;
    const { style } = document.body;
    const prev = { overflow: style.overflow, paddingRight: style.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    style.overflow = 'hidden';
    if (gutter > 0) style.paddingRight = `${gutter}px`;
    return () => {
      style.overflow = prev.overflow;
      style.paddingRight = prev.paddingRight;
    };
  }, [open]);

  return (
    <>
      <div
        className={open ? `${styles.scrim} ${styles.scrimOpen}` : styles.scrim}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={open ? `${styles.panel} ${styles.panelOpen}` : styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        aria-hidden={!open}
        tabIndex={-1}
        inert={!open}
      >
        <header className={styles.head}>
          <h2 id="settings-title" className={styles.title}>设置</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭设置">
            <Icon name="x" size={19} />
          </button>
        </header>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>台词引擎</h3>
          <div className={styles.modeGroup} role="radiogroup" aria-label="台词引擎模式">
            <button
              type="button"
              role="radio"
              aria-checked={settings.mode === 'proxy'}
              className={settings.mode === 'proxy' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => { setSettings({ mode: 'proxy' }); setTest({ status: 'idle' }); }}
            >
              <span className={styles.modeName}>服务器模式</span>
              <span className={styles.modeDesc}>走服务器网关调大模型,密钥不出服务器(需登录)</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.mode === 'mock'}
              className={settings.mode === 'mock' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => { setSettings({ mode: 'mock' }); setTest({ status: 'idle' }); }}
            >
              <span className={styles.modeName}>演示模式</span>
              <span className={styles.modeDesc}>零依赖,内置教学引擎,断网也能完整跑通</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.mode === 'api'}
              className={settings.mode === 'api' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => { setSettings({ mode: 'api' }); setTest({ status: 'idle' }); }}
            >
              <span className={styles.modeName}>自定义 API</span>
              <span className={styles.modeDesc}>浏览器直连自己的 OpenAI 兼容端点(密钥存本机)</span>
            </button>
          </div>

          {settings.mode === 'proxy' && (
            <div className={styles.fields}>
              <div className={styles.testRow}>
                <button
                  type="button"
                  className={styles.testBtn}
                  onClick={runTest}
                  disabled={test.status === 'busy'}
                >
                  {test.status === 'busy' ? '测试中…' : '测试连接'}
                </button>
                {test.status === 'ok' && <span className={`${styles.testStatus} ${styles.testOk}`}>{test.detail}</span>}
                {test.status === 'fail' && <span className={`${styles.testStatus} ${styles.testFail}`}>{test.detail}</span>}
              </div>
              <p className={styles.hint}>密钥与模型由服务器代管,浏览器只传对话内容;需登录后才可调用(llm-auth 表示未登录)。</p>
            </div>
          )}

          {settings.mode === 'api' && (
            <div className={styles.fields}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Base URL</span>
                <input
                  className={styles.input}
                  type="url"
                  value={settings.baseUrl}
                  placeholder="https://api.deepseek.com/v1"
                  spellCheck={false}
                  onChange={(e) => { setSettings({ baseUrl: e.target.value }); setTest({ status: 'idle' }); }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>API Key</span>
                <input
                  className={styles.input}
                  type="password"
                  value={settings.apiKey}
                  placeholder="sk-…"
                  autoComplete="off"
                  onChange={(e) => { setSettings({ apiKey: e.target.value }); setTest({ status: 'idle' }); }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>模型</span>
                <input
                  className={styles.input}
                  type="text"
                  value={settings.model}
                  placeholder="如 deepseek-v4-flash"
                  spellCheck={false}
                  onChange={(e) => { setSettings({ model: e.target.value }); setTest({ status: 'idle' }); }}
                />
              </label>
              <div className={styles.testRow}>
                <button
                  type="button"
                  className={styles.testBtn}
                  onClick={runTest}
                  disabled={test.status === 'busy' || !settings.baseUrl || !settings.apiKey || !settings.model}
                >
                  {test.status === 'busy' ? '测试中…' : '测试连接'}
                </button>
                {test.status === 'ok' && <span className={`${styles.testStatus} ${styles.testOk}`}>{test.detail}</span>}
                {test.status === 'fail' && <span className={`${styles.testStatus} ${styles.testFail}`}>{test.detail}</span>}
              </div>
              <p className={styles.hint}>任何 OpenAI 兼容端点(/chat/completions)均可;密钥只存在本机浏览器,不上传。</p>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>语音输入(课堂口述转文字)</h3>
          <div className={styles.modeGroup} role="radiogroup" aria-label="语音转写引擎模式">
            <button
              type="button"
              role="radio"
              aria-checked={asr.mode === 'proxy'}
              className={asr.mode === 'proxy' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => setAsrSettings({ mode: 'proxy' })}
            >
              <span className={styles.modeName}>服务器模式</span>
              <span className={styles.modeDesc}>走服务器网关转写,密钥不出服务器(需登录)</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={asr.mode === 'api'}
              className={asr.mode === 'api' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => setAsrSettings({ mode: 'api' })}
            >
              <span className={styles.modeName}>自定义 API</span>
              <span className={styles.modeDesc}>浏览器直连自己的转写端点(密钥存本机)</span>
            </button>
          </div>
          {asr.mode === 'api' && (
            <div className={styles.fields}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Base URL</span>
                <input
                  className={styles.input}
                  type="url"
                  value={asr.baseUrl}
                  placeholder="https://openrouter.ai/api/v1"
                  spellCheck={false}
                  onChange={(e) => setAsrSettings({ baseUrl: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>API Key</span>
                <input
                  className={styles.input}
                  type="password"
                  value={asr.apiKey}
                  placeholder="sk-…"
                  autoComplete="off"
                  onChange={(e) => setAsrSettings({ apiKey: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>模型</span>
                <input
                  className={styles.input}
                  type="text"
                  value={asr.model}
                  placeholder="如 qwen/qwen3-asr-flash-2026-02-10"
                  spellCheck={false}
                  onChange={(e) => setAsrSettings({ model: e.target.value })}
                />
              </label>
              <p className={styles.hint}>任何 OpenAI 兼容转写端点(/audio/transcriptions)均可;密钥只存在本机浏览器,不上传、也不随学习存档同步。</p>
            </div>
          )}
          {asr.mode === 'proxy' && (
            <p className={styles.hint}>讲课页输入框旁的麦克风即语音输入;转写密钥由服务器代管,需登录后使用。</p>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>小白台词温度</h3>
          <div className={styles.sliderRow}>
            <span className={styles.sliderEnd}>沉稳</span>
            <input
              className={styles.slider}
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
          <p className={styles.hint}>只影响小白说话的活泼程度;讲解评估恒用 temperature 0,保证判定一致。</p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>新手引路</h3>
          <p className={styles.hint}>
            小白带你把门厅、备课桌、讲解舱各认一遍路;每处只自动引一次。重新引路只清引路痕迹,不动学习记录。
          </p>
          {/* 清痕后立即关抽屉:当前页若有引路会随即上前,也避免抽屉与引路的 Esc 抢按键 */}
          <button
            type="button"
            className={styles.testBtn}
            onClick={() => {
              resetTours();
              onClose();
            }}
          >
            重新引路
          </button>
        </section>

        <footer className={styles.foot}>
          导演状态机永远本地纯代码运行;LLM 负责理解讲解与生成台词,失败自动降级本地规则。
        </footer>
      </aside>
    </>
  );
}
