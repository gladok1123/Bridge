import BridgeClient from '@/components/BridgeClient.jsx';

/**
 * Комната по прямой ссылке: /r/код#k=ключ
 * Ключ живёт после «#» — такая часть адреса на сервер не уходит никогда,
 * поэтому расшифровать комнату некому, кроме участников.
 */
export default async function RoomPage({ params }) {
  const { code } = await params;
  return <BridgeClient initialRoom={decodeURIComponent(code)} />;
}
