/**
 * Работа с камерой, микрофоном и демонстрацией экрана.
 *
 * Отдельный слой, потому что именно здесь обычно и «не работает»: браузер
 * разрешает устройства только на https или localhost, может отказать в доступе,
 * а на телефонах вообще нет демонстрации. Всё это возвращается наружу понятными
 * кодами ошибок, а не тишиной.
 */

/**
 * Разрешения — от мобильного до 4K. Для показа экрана берём «до», то есть
 * картинка никогда не растягивается: если монитор меньше — отдаём как есть.
 */
export const QUALITY = {
  360: { w: 640, h: 360, label: '360p' },
  480: { w: 854, h: 480, label: '480p' },
  720: { w: 1280, h: 720, label: '720p' },
  1080: { w: 1920, h: 1080, label: '1080p' },
  1440: { w: 2560, h: 1440, label: '1440p' },
  2160: { w: 3840, h: 2160, label: '4K' },
};

export const FPS_CHOICES = [15, 24, 30, 60];

/** Пределы битрейта: «Авто» считает по разрешению, кадрам и назначению потока. */
export const BITRATE_CHOICES = [
  { value: 0, label: 'Авто' },
  { value: 1_500_000, label: '1,5 Мбит/с' },
  { value: 4_000_000, label: '4 Мбит/с' },
  { value: 8_000_000, label: '8 Мбит/с' },
  { value: 15_000_000, label: '15 Мбит/с' },
  { value: 25_000_000, label: '25 Мбит/с' },
  { value: 40_000_000, label: '40 Мбит/с' },
];

/** Выше 40 Мбит/с браузеры и сети уже не держат — смысла выставлять больше нет. */
export const MAX_BITRATE = 40_000_000;
export const MIN_BITRATE = 150_000;

/**
 * Оптимизация потока (как «Stream quality» в Discord):
 *  • auto   — разумный баланс;
 *  • text   — резче картинка, для текста, кода и презентаций;
 *  • motion — плавнее, для видео и игр.
 */
export const HINT_CHOICES = [
  { value: 'auto', label: 'Авто' },
  { value: 'text', label: 'Резко (текст)' },
  { value: 'motion', label: 'Плавно (движение)' },
];

/**
 * Битрейт «на глаз»: пиксели в секунду × цена пикселя.
 * Значения подобраны так, чтобы 1080p60 укладывался в привычные 8–12 Мбит/с,
 * а 4K60 упирался в верхний предел, а не улетал в бесконечность.
 */
export function autoBitrate({ quality = 720, fps = 30, kind = 'cam', hint = 'auto' } = {}) {
  const q = QUALITY[quality] || QUALITY[720];
  const pixels = q.w * q.h * (Number(fps) || 30);
  const perPixel = kind === 'screen'
    ? hint === 'text' ? 0.12 : hint === 'motion' ? 0.06 : 0.085
    : 0.07;
  const value = Math.round(pixels * perPixel);
  return Math.max(MIN_BITRATE, Math.min(MAX_BITRATE, value));
}

/** Итоговый битрейт: с учётом ручного предела, если он выбран. */
export function preferredBitrate({ bitrate = 0, ...rest } = {}) {
  const manual = Number(bitrate) || 0;
  return manual > 0 ? Math.min(MAX_BITRATE, manual) : autoBitrate(rest);
}

/** Целевой размер кадра для выбранного разрешения. */
export function targetSize(quality) {
  const q = QUALITY[quality] || QUALITY[720];
  return { w: q.w, h: q.h };
}

/**
 * Во сколько раз уменьшать картинку перед отправкой: если монитор 4K, а выбрано
 * 1080p, отдавать четыре килопикселя впустую не нужно. Результат — целое ≥ 1.
 */
export function scaleFor(settings = {}, quality = 720) {
  const { w, h } = targetSize(quality);
  const sw = Number(settings.width) || 0;
  const sh = Number(settings.height) || 0;
  if (!sw || !sh) return 1;
  const ratio = Math.max(sw / w, sh / h);
  return ratio > 1.02 ? Math.min(8, Math.ceil(ratio)) : 1;
}

export const MEDIA_ERRORS = {
  insecure: 'Браузер не даёт камеру и микрофон на http — нужен https или localhost',
  denied: 'Доступ к устройству запрещён — разрешите его в значке замка в адресной строке',
  notfound: 'Устройство не найдено — проверьте, подключена ли камера или микрофон',
  busy: 'Устройство занято другой программой',
  unsupported: 'Браузер не умеет демонстрацию экрана',
  unknown: 'Не получилось получить устройство',
};

export function explainError(err) {
  const name = String((err && err.name) || '');
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notfound';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  if (String(err && err.message || '').includes('secure')) return 'insecure';
  return 'unknown';
}

export function isSecure() {
  if (typeof window === 'undefined') return true;
  if (window.isSecureContext) return true;
  const h = (window.location && window.location.hostname) || '';
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

export function canShareScreen() {
  if (typeof navigator === 'undefined') return false;
  return !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
}

/** Есть ли вообще устройства — до запроса разрешения. */
export async function listDevices() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return { cam: 0, mic: 0, ok: false };
  }
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return {
      cam: list.filter((d) => d.kind === 'videoinput').length,
      mic: list.filter((d) => d.kind === 'audioinput').length,
      ok: true,
    };
  } catch {
    return { cam: 0, mic: 0, ok: false };
  }
}

function videoConstraint(quality, fps) {
  const q = QUALITY[quality] || QUALITY[720];
  return {
    width: { ideal: q.w },
    height: { ideal: q.h },
    frameRate: { ideal: Number(fps) || 30, max: Number(fps) || 30 },
    facingMode: 'user',
  };
}

function audioConstraint({ noiseSuppress = true, echoCancel = true, autoGain = true } = {}) {
  return {
    echoCancellation: !!echoCancel,
    noiseSuppression: !!noiseSuppress,
    autoGainControl: !!autoGain,
  };
}

/**
 * Запросить камеру и/или микрофон.
 * Если с камерой не вышло, а звук нужен — честно пробуем ещё раз без видео.
 * @returns {Promise<{stream: MediaStream|null, error: string|null, code: string|null}>}
 */
export async function requestMedia({ video = false, audio = true, quality = 720, fps = 30, audioPrefs } = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { stream: null, error: MEDIA_ERRORS.insecure, code: 'insecure' };
  }
  if (!isSecure()) return { stream: null, error: MEDIA_ERRORS.insecure, code: 'insecure' };
  const constraints = {
    video: video ? videoConstraint(quality, fps) : false,
    audio: audio ? audioConstraint(audioPrefs) : false,
  };
  if (!constraints.video && !constraints.audio) return { stream: new MediaStream(), error: null, code: null };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { stream, error: null, code: null };
  } catch (err) {
    const code = explainError(err);
    if (video && audio) {
      // камера могла не даться, а микрофон — вполне: пробуем только звук
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint(audioPrefs) });
        return { stream, error: MEDIA_ERRORS[code] + ' · камера не включилась', code };
      } catch (err2) {
        const code2 = explainError(err2);
        return { stream: null, error: MEDIA_ERRORS[code2], code: code2 };
      }
    }
    return { stream: null, error: MEDIA_ERRORS[code] || String(err && err.message || err), code };
  }
}

/** Демонстрация экрана. Часто её нет на телефонах — так и говорим. */
export async function requestScreen({ quality = 1080, fps = 30, audio = false } = {}) {
  if (!canShareScreen()) return { stream: null, error: MEDIA_ERRORS.unsupported, code: 'unsupported' };
  if (!isSecure()) return { stream: null, error: MEDIA_ERRORS.insecure, code: 'insecure' };
  const q = targetSize(quality);
  const want = {
    width: { ideal: q.w, max: q.w },
    height: { ideal: q.h, max: q.h },
    frameRate: { ideal: Number(fps) || 30, max: Number(fps) || 30 },
  };
  const audioPart = audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: want, audio: audioPart });
    return { stream, error: null, code: null };
  } catch (err) {
    /* некоторые браузеры не любят «max» в показе экрана — пробуем ещё раз помягче */
    if (err && (err.name === 'OverconstrainedError' || err.name === 'TypeError')) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: Number(fps) || 30 } },
          audio: audioPart,
        });
        return { stream, error: null, code: null };
      } catch {
        /* ниже общее объяснение */
      }
    }
    const code = explainError(err);
    return { stream: null, error: err && err.name === 'NotAllowedError' ? 'Выбор экрана отменён' : MEDIA_ERRORS[code], code };
  }
}

export function stopStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* уже */
  }
}

export function hasLive(stream, kind) {
  if (!stream) return false;
  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  return tracks.some((t) => t.readyState === 'live');
}

/* ── уровень звука (кто говорит) ───────────────────────────────────────── */

let sharedCtx = null;
const analysers = new Map();

export function audioContext() {
  if (sharedCtx) return sharedCtx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

/** Повесить на поток анализатор и вернуть функцию чтения громкости (0..1). */
export function attachMeter(stream) {
  if (!stream || !stream.getAudioTracks().length) return null;
  const ctx = audioContext();
  if (!ctx) return null;
  if (analysers.has(stream.id)) return analysers.get(stream.id).read;
  let src;
  try {
    src = ctx.createMediaStreamSource(stream);
  } catch {
    return null;
  }
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  node.smoothingTimeConstant = 0.75;
  src.connect(node);
  const buf = new Float32Array(node.fftSize);
  const read = () => {
    try {
      node.getFloatTimeDomainData(buf);
    } catch {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    return Math.min(1, rms * 6);
  };
  analysers.set(stream.id, { src, node, read });
  return read;
}

export function detachMeter(stream) {
  if (!stream) return;
  const rec = analysers.get(stream.id);
  if (!rec) return;
  try {
    rec.src.disconnect();
    rec.node.disconnect();
  } catch {
    /* уже */
  }
  analysers.delete(stream.id);
}

export function resumeAudio() {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/* ── отправляемые параметры видео ──────────────────────────────────────── */

/** Что сказать кодировщику про картинку: резкий текст или плавное движение. */
export function hintFor(kind = 'cam', hint = 'auto') {
  if (kind !== 'screen') return 'motion';
  return hint === 'motion' ? 'motion' : hint === 'text' ? 'text' : 'detail';
}

/** Применить подсказку к дорожке (браузеры без поддержки просто промолчат). */
export function applyContentHint(track, { kind = 'cam', hint = 'auto' } = {}) {
  if (!track || !('contentHint' in track)) return false;
  try {
    track.contentHint = hintFor(kind, hint);
    return true;
  } catch {
    return false;
  }
}

/**
 * Настроить отправителя: битрейт, частоту кадров, уменьшение картинки и
 * подсказку кодировщику. Возвращает то, что реально применилось, — это видно
 * в интерфейсе, поэтому важно не врать.
 */
export async function tuneSender(sender, { kind = 'cam', quality = 720, fps = 30, bitrate = 0, hint = 'auto', track = null } = {}) {
  if (!sender || !sender.getParameters || !sender.setParameters) return null;
  let applied = null;
  try {
    /* подсказка кодировщику: текст — резче, движение — плавнее */
    applyContentHint(track, { kind, hint });
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    const enc = params.encodings[0];
    enc.maxBitrate = preferredBitrate({ bitrate, quality, fps, kind, hint });
    enc.maxFramerate = Number(fps) || 30;
    const scale = track ? scaleFor(typeof track.getSettings === 'function' ? track.getSettings() : track, quality) : 1;
    if (scale > 1) enc.scaleResolutionDownBy = scale;
    else delete enc.scaleResolutionDownBy;
    params.degradationPreference = kind === 'screen' && hint !== 'motion' ? 'detail' : 'balanced';
    await sender.setParameters(params);
    applied = { maxBitrate: enc.maxBitrate, maxFramerate: enc.maxFramerate, scaleResolutionDownBy: scale, degradationPreference: params.degradationPreference };
  } catch {
    applied = null;
  }
  return applied;
}

/** Попросить камеру или экран отдавать новое разрешение прямо на ходу. */
export async function retuneTrack(track, { quality = 720, fps = 30 } = {}) {
  if (!track || typeof track.applyConstraints !== 'function') return false;
  const q = targetSize(quality);
  try {
    await track.applyConstraints({
      width: { ideal: q.w },
      height: { ideal: q.h },
      frameRate: { ideal: Number(fps) || 30 },
    });
    return true;
  } catch {
    return false;
  }
}

export function chooseRecorderMime() {
  const list = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  const R = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
  if (!R) return '';
  for (const m of list) if (R.isTypeSupported && R.isTypeSupported(m)) return m;
  return '';
}
