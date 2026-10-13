import './lib/disableOpenUIDevtools';
import './lib/scopedStorage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import 'lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css';
/* 票据风三声部西文(自托管,国内生产可用):
   加拉蒙衬线=题头/斜体点睛;Courier Prime=打字机小签;DM Sans=现代小字 */
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import './index.css';
import './store/themeStore';
import './store/skinStore';
import App from './App';
import { ModuleRecovery } from './components/shell/ModuleRecovery';
import { TipProvider, Toaster } from './components/ui';
import 'katex/dist/katex.min.css';

const router = createHashRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModuleRecovery><TipProvider><RouterProvider router={router} /><Toaster /></TipProvider></ModuleRecovery>
  </StrictMode>,
);
