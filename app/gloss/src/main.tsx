import { initializeBridge, loadModels, nativeIdbOpen } from './compat/bridge';
import './globals.css';
import './library.css';
import './local.css';
import { routePath } from './compat/navigation';

async function start() {
  const owner = await initializeBridge();
  const [{ createRoot }, React, { Landing }, { Library }, { Reader }, { sampleById }, { Tooltips }, { SyncAgent }, { BOOT_SCRIPT }, modelLib, { useStore }] = await Promise.all([
    import('react-dom/client'), import('react'), import('./components/landing/Landing'), import('./components/library/Library'), import('./components/reader/Reader'), import('./lib/samples'), import('./components/ui/Tooltips'), import('./components/account/SyncAgent'), import('./lib/settings'), import('./lib/models'), import('./lib/store'),
  ]);
  try {
    const catalog = await loadModels(); modelLib.configureModels(catalog.chat.models, catalog.model);
    useStore.getState().hydrate(); useStore.getState().setSettings({ model: modelLib.modelOf(catalog.model) });
    const { applySettings } = await import('./lib/settings'); applySettings(useStore.getState().settings);
  } catch { /* The reader still opens when the model catalog is unavailable. */ }
  useStore.getState().hydrate();
  await import('./compat/legacy').then(({ migrateLegacy }) => migrateLegacy(nativeIdbOpen, owner)).catch(() => {});
  // The original first-paint script runs only after the account-scoped storage is ready.
  void BOOT_SCRIPT;
  function App() {
    const [path, setPath] = React.useState(routePath);
    React.useEffect(() => { const on = () => setPath(routePath()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
    React.useEffect(() => { const on = (event: Event) => useStore.getState().setSettings({ model: modelLib.modelOf((event as CustomEvent).detail.model) }); window.addEventListener('gloss:default-model-change', on); return () => window.removeEventListener('gloss:default-model-change', on); }, []);
    const id = path.startsWith('/read/') ? decodeURIComponent(path.slice(6)) : '';
    return <>{id ? <Reader key={id} id={id} initial={sampleById(id)} /> : path === '/library' ? <Library /> : <Landing signedIn />}<SyncAgent /><Tooltips /></>;
  }
  createRoot(document.getElementById('root')!).render(<App />);
}
void start().catch((error) => { document.getElementById('root')!.textContent = error.message || '阅读暂时无法打开，请刷新重试。'; });
