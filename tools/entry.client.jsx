/**
 * Точка входа для проверки интерфейса в поддельном браузере (tools/smoke.mjs).
 * Собирается esbuild’ом вместе со всем приложением и запускается внутри jsdom.
 */
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import BridgeClient from '@/components/BridgeClient.jsx';

globalThis.__bridgeMount = (node, props) => {
  const root = createRoot(node);
  root.render(createElement(BridgeClient, props || {}));
  return root;
};
