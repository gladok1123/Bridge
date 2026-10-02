'use client';

import { useEffect, useRef } from 'react';

/**
 * Звук участников. Играть чужой голос нужно через отдельный элемент:
 * видео-плитки могут быть скрыты или переключены, а звук обязан звучать всегда.
 */
export function PeerAudio({ stream, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      const p = el.play && el.play();
      if (p && p.catch) p.catch(() => {});
    }
    if (!stream && el.srcObject) el.srcObject = null;
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.muted = !!muted;
  }, [muted]);
  return <audio ref={ref} autoPlay playsInline />;
}

/** Все участники: по элементу на каждого, спрятаны от глаз, но слышны. */
export function AudioSinks({ peers, remoteStream, muted, trackRev = 0 }) {
  return (
    <div style={{ display: 'none' }} aria-hidden="true" data-rev={trackRev}>
      {(peers || []).map((p) => (
        <PeerAudio key={p.av + ':' + trackRev} stream={remoteStream(p.av, 'audio')} muted={muted} />
      ))}
    </div>
  );
}
