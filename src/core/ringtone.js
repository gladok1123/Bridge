/**
 * Звуки Bridge — синтезируются на месте, ни одного файла и ни одной ссылки.
 * Всё тихое и короткое: вход, выход, сообщение, поднятая рука, старт записи.
 */
import { audioContext } from './media.js';

let muted = false;

export function setSoundMuted(v) {
  muted = !!v;
}

export function isSoundMuted() {
  return muted;
}

function tone(ctx, { freq = 660, dur = 0.12, gain = 0.05, type = 'sine', at = 0, sweep = 0 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + at);
  if (sweep) osc.frequency.linearRampToValueAtTime(freq + sweep, ctx.currentTime + at + dur);
  g.gain.setValueAtTime(0, ctx.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + at);
  osc.stop(ctx.currentTime + at + dur + 0.02);
}

const PATTERNS = {
  join: [{ freq: 523, dur: 0.1 }, { freq: 784, dur: 0.14, at: 0.1, gain: 0.045 }],
  leave: [{ freq: 523, dur: 0.12 }, { freq: 349, dur: 0.16, at: 0.11, gain: 0.045 }],
  message: [{ freq: 880, dur: 0.07, gain: 0.03, type: 'triangle' }],
  hand: [{ freq: 740, dur: 0.09, gain: 0.04 }, { freq: 988, dur: 0.12, at: 0.09, gain: 0.04 }],
  recStart: [{ freq: 440, dur: 0.12, gain: 0.05 }, { freq: 660, dur: 0.18, at: 0.12, gain: 0.05 }],
  recStop: [{ freq: 660, dur: 0.12, gain: 0.05 }, { freq: 440, dur: 0.2, at: 0.12, gain: 0.05 }],
  mute: [{ freq: 300, dur: 0.08, gain: 0.035, type: 'square' }],
  error: [{ freq: 220, dur: 0.22, gain: 0.05, type: 'sawtooth' }],
};

/** Проиграть звук. Без разрешения на звук браузер просто промолчит — это нормально. */
export function blip(kind) {
  if (muted) return;
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const pattern = PATTERNS[kind] || PATTERNS.message;
  pattern.forEach((p) => {
    try {
      tone(ctx, p);
    } catch {
      /* не вышло — не страшно */
    }
  });
}
