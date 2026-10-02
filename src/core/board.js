/**
 * Общая доска Bridge.
 *
 * Штрихи живут в нормализованных координатах (0..1), поэтому у всех участников
 * картинка одна и та же независимо от размера окна. Обмен — короткими пачками
 * точек (`pt`), а вошедшему позже уходит снимок (`snap`) по прямому каналу.
 * Логика чистая: ни DOM, ни React — поэтому её можно проверять тестами.
 */

export const BOARD_COLORS = ['#0f1115', '#5865f2', '#23a55a', '#f0b232', '#f23f43', '#eb459e', '#ffffff'];
export const BOARD_WIDTHS = [2, 4, 7, 12];

/** Сколько точек терпим в одном штрихе: защита от чужого мусора. */
export const MAX_POINTS = 4000;
const MAX_STROKES = 5000;

export class BoardStore {
  constructor() {
    this.strokes = [];
    this.version = 0;
    this.dirty = true;
  }

  touch() {
    this.version++;
    this.dirty = true;
  }

  /** Применить операцию. Возвращает true, если что-то изменилось. */
  apply(op) {
    if (!op || typeof op !== 'object') return false;
    switch (op.t) {
      case 'snap': {
        if (!Array.isArray(op.strokes)) return false;
        this.strokes = op.strokes.slice(-MAX_STROKES).map((s) => ({
          sid: String(s.sid || ''),
          color: String(s.color || BOARD_COLORS[0]),
          w: Number(s.w) || BOARD_WIDTHS[1],
          author: String(s.author || ''),
          pts: Array.isArray(s.pts) ? s.pts.slice(0, MAX_POINTS).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]) : [],
          done: true,
        }));
        this.touch();
        return true;
      }
      case 'pt': {
        const pts = Array.isArray(op.pts) ? op.pts : [];
        if (!pts.length || !op.sid) return false;
        let s = this.strokes[this.strokes.length - 1];
        if (!s || s.sid !== op.sid) {
          s = {
            sid: String(op.sid),
            color: String(op.color || BOARD_COLORS[0]),
            w: Number(op.w) || BOARD_WIDTHS[1],
            author: String(op.a || ''),
            pts: [],
            done: false,
          };
          this.strokes.push(s);
          if (this.strokes.length > MAX_STROKES) this.strokes.splice(0, this.strokes.length - MAX_STROKES);
        }
        for (const p of pts) {
          if (!Array.isArray(p) || p.length < 2) continue;
          const x = Number(p[0]);
          const y = Number(p[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (s.pts.length < MAX_POINTS) s.pts.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
        }
        this.touch();
        return true;
      }
      case 'end': {
        const s = this.strokes[this.strokes.length - 1];
        if (s && s.sid === op.sid) s.done = true;
        this.touch();
        return true;
      }
      case 'undo': {
        if (!this.strokes.length) return false;
        this.strokes.pop();
        this.touch();
        return true;
      }
      case 'clear': {
        if (!this.strokes.length) return false;
        this.strokes = [];
        this.touch();
        return true;
      }
      default:
        return false;
    }
  }

  /** Снимок для того, кто вошёл позже. */
  snapshot() {
    return {
      t: 'snap',
      strokes: this.strokes.map((s) => ({ sid: s.sid, color: s.color, w: s.w, author: s.author, pts: s.pts })),
    };
  }

  get size() {
    return this.strokes.length;
  }

  /** Сколько всего точек — показываем в подсказке. */
  get points() {
    return this.strokes.reduce((n, s) => n + s.pts.length, 0);
  }
}

/** Нарисовать все штрихи. ctx — любой объект с canvas-интерфейсом (в тестах — заглушка). */
export function renderBoard(ctx, strokes, { width, height } = {}) {
  if (!ctx || !width || !height) return 0;
  ctx.clearRect(0, 0, width, height);
  let drawn = 0;
  for (const s of strokes || []) {
    const pts = s.pts || [];
    if (!pts.length) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, s.w * (Math.min(width, height) / 720));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * width, pts[0][1] * height, Math.max(1.2, ctx.lineWidth / 2), 0, Math.PI * 2);
      ctx.fill();
      drawn++;
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * width, pts[0][1] * height);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * width, pts[i][1] * height);
    ctx.stroke();
    drawn++;
  }
  return drawn;
}

/** Номер штриха: у каждого свой, чтобы чужие точки не приклеивались к нашему. */
export function strokeId(av, seq) {
  return String(av || 'x') + '-' + String(seq || 0).toString(36);
}
