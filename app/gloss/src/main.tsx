import { initializeBridge, loadChatModels, loadMediaModels, nativeIdbOpen } from './compat/bridge';
import './globals.css';
import './library.css';
import './local.css';
import { routePath } from './compat/navigation';

async function start() {
  // Account-scoped storage must be installed before any stateful reader module loads.
  const owner = await initializeBridge();
  const [{ createRoot }, React, { useStore }, { applySettings }, modelLib] = await Promise.all([
    import('react-dom/client'), import('react'), import('./lib/store'), import('./lib/settings'), import('./lib/models'),
  ]);
  useStore.getState().hydrate();
  applySettings(useStore.getState().settings);
  const Library = React.lazy(() => import('./components/library/Library').then((m) => ({ default: m.Library })));
  const Landing = React.lazy(() => import('./components/landing/Landing').then((m) => ({ default: m.Landing })));
  const Reader = React.lazy(async () => {
    const [m, samples] = await Promise.all([import('./components/reader/Reader'), import('./lib/samples')]);
    return { default: ({ id }: { id: string }) => <m.Reader id={id} initial={samples.sampleById(id)} /> };
  });
  const Tooltips = React.lazy(() => import('./components/ui/Tooltips').then((m) => ({ default: m.Tooltips })));
  const SyncAgent = React.lazy(() => import('./components/account/SyncAgent').then((m) => ({ default: m.SyncAgent })));
  function App() {
    const [path, setPath] = React.useState(routePath);
    React.useEffect(() => { const on = () => setPath(routePath()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
    React.useEffect(() => { const on = (event: Event) => useStore.getState().setSettings({ model: modelLib.modelOf((event as CustomEvent).detail.model) }); window.addEventListener('gloss:default-model-change', on); return () => window.removeEventListener('gloss:default-model-change', on); }, []);
    const id = path.startsWith('/read/') ? decodeURIComponent(path.slice(6)) : '';
    return <><React.Suspense fallback={<p role="status" className="p-6">正在打开阅读…</p>}>
      {id ? <Reader key={id} id={id} /> : path === '/library' ? <Library /> : <Landing signedIn />}
    </React.Suspense><React.Suspense fallback={null}><SyncAgent /><Tooltips /></React.Suspense></>;
  }
  createRoot(document.getElementById('root')!).render(<App />);
  // Model/media discovery and migration must never delay the first usable page.
  void loadChatModels().then(({ chat, model }) => {
    modelLib.configureModels(chat.models, model);
    useStore.getState().setSettings({ model: modelLib.modelOf(model) });
  }).catch(() => {});
  void loadMediaModels().catch(() => {});
  void import('./compat/legacy').then(({ migrateLegacy }) => migrateLegacy(nativeIdbOpen, owner)).catch(() => {
    window.dispatchEvent(new CustomEvent('gloss:sync-error', { detail: '旧版笔记迁移暂未完成，原数据仍保留。关闭旧版阅读页面后可重试。' }));
  });
}
void start().catch((error) => { document.getElementById('root')!.textContent = error.message || '阅读暂时无法打开，请刷新重试。'; });
