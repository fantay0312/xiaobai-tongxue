/**
 * 设置抽屉 —— 右侧滑出(非弹窗)。
 * LlmSettings 表单:mock/api 模式切换 + 小白台词温度。
 * 评估与状态机永远本地规则运行,LLM 只负责理解与台词。
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { llmCall } from '../../engine';
import styles from './SettingsDrawer.module.css';

type TestState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string };

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={open ? `${styles.scrim} ${styles.scrimOpen}` : styles.scrim}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={open ? `${styles.panel} ${styles.panelOpen}` : styles.panel}
        aria-label="设置"
        inert={!open}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>设置</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭设置">
            ×
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
                  placeholder="如 deepseek-chat"
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

        <footer className={styles.foot}>
          导演状态机永远本地纯代码运行;LLM 负责理解讲解与生成台词,失败自动降级本地规则。
        </footer>
      </aside>
    </>
  );
}
