/**
 * 设置抽屉 —— 右侧滑出(非弹窗)。
 * LlmSettings 表单:mock/api 模式切换 + 小白台词温度。
 * 评估与状态机永远本地规则运行,LLM 只负责理解与台词。
 */
import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import styles from './SettingsDrawer.module.css';

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

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
              aria-checked={settings.mode === 'mock'}
              className={settings.mode === 'mock' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => setSettings({ mode: 'mock' })}
            >
              <span className={styles.modeName}>演示模式</span>
              <span className={styles.modeDesc}>零依赖,内置教学引擎,断网也能完整跑通</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.mode === 'api'}
              className={settings.mode === 'api' ? `${styles.modeBtn} ${styles.modeBtnActive}` : styles.modeBtn}
              onClick={() => setSettings({ mode: 'api' })}
            >
              <span className={styles.modeName}>API 模式</span>
              <span className={styles.modeDesc}>接入 OpenAI 兼容端点,小白台词更鲜活</span>
            </button>
          </div>

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
                  onChange={(e) => setSettings({ baseUrl: e.target.value })}
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
                  onChange={(e) => setSettings({ apiKey: e.target.value })}
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
                  onChange={(e) => setSettings({ model: e.target.value })}
                />
              </label>
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
          评估与状态机永远本地规则运行,LLM 只负责理解与台词。
        </footer>
      </aside>
    </>
  );
}
