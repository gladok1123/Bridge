'use client';

import { useBridge } from '@/hooks/useBridge.js';
import { BridgeApp } from './BridgeApp.jsx';

/** Мост между хуком-рантаймом и интерфейсом. */
export default function BridgeClient({ initialRoom = '' }) {
  const bridge = useBridge();
  return <BridgeApp bridge={bridge} initialRoom={initialRoom} />;
}
