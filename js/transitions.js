/* =========================================================
   transitions.js — 프레젠테이션 화면 전환 효과 엔진
   drawTransition(ctx, 이전쪽, 다음쪽, 진행(0~1), 효과, { from })
   두 쪽을 같은 크기의 캔버스로 받아서, 진행 정도에 맞는 한 장면을 그려요.
   (DOM에 의존하지 않아서 노드에서 한 프레임씩 검증할 수 있어요.)
   ========================================================= */

const TRANS_TYPES = [
  { id: "none",    name: "없음",        dir: false },
  { id: "wipe",    name: "닦아내기",    dir: true },
  { id: "push",    name: "밀어내기",    dir: true },
  { id: "stairs",  name: "계단 모양",   dir: true },
  { id: "mosaic",  name: "모자이크",    dir: false },
  { id: "comb",    name: "빗질하기",    dir: true },
  { id: "stripes", name: "실선 무늬",   dir: true },
  { id: "cut",     name: "자르기",      dir: false },
  { id: "bright",  name: "밝기 변화",   dir: false },
];
const TRANS_DIRS = [
  { id: "left", name: "왼쪽에서" }, { id: "right", name: "오른쪽에서" },
  { id: "top", name: "위에서" }, { id: "bottom", name: "아래에서" },
];
const TRANS_ENV = { createCanvas: (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; } };

const easeCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function seededOrder(n, seed) {
  let a = seed | 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
const _orderCache = {};
const mosaicOrder = (n) => _orderCache[n] || (_orderCache[n] = seededOrder(n, 20261004));

const _tmp = { w: 0, h: 0, c: null };
function tmpCanvas(w, h) {
  if (!_tmp.c || _tmp.w !== w || _tmp.h !== h) { _tmp.c = TRANS_ENV.createCanvas(w, h); _tmp.w = w; _tmp.h = h; }
  return _tmp.c;
}

// 칸이 조금씩 자라며 나타나는 효과(계단/모자이크/실선)에서 칸 하나를 그려요 (이음새가 안 생기게 정수 좌표로)
function blitRect(ctx, B, x, y, w, h) {
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.ceil(x + w), y1 = Math.ceil(y + h);
  if (x1 > x0 && y1 > y0) ctx.drawImage(B, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
}

function drawTransition(ctx, A, B, p, type, opts) {
  const W = A.width, H = A.height, from = (opts && opts.from) || "left";
  p = clamp01(p);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  if (type === "none" || p >= 1) { ctx.drawImage(B, 0, 0); ctx.restore(); return; }
  if (p <= 0) { ctx.drawImage(A, 0, 0); ctx.restore(); return; }
  const horiz = from === "left" || from === "right";
  const e = type === "cut" || type === "bright" || type === "stripes" ? easeSine(p) : easeCubic(p);

  if (type === "push") {
    // 소수점 위치에 그리면 두 쪽이 만나는 줄에 반투명 틈(깜빡이는 가는 선)이 생겨서 정수로 맞춰요
    const dx = Math.round(from === "left" ? e * W : from === "right" ? -e * W : 0);
    const dy = Math.round(from === "top" ? e * H : from === "bottom" ? -e * H : 0);
    ctx.drawImage(A, dx, dy);
    ctx.drawImage(B, dx + (from === "left" ? -W : from === "right" ? W : 0), dy + (from === "top" ? -H : from === "bottom" ? H : 0));
  } else if (type === "wipe") {
    const L = horiz ? W : H, feather = Math.max(24, L * 0.14), edge = e * (L + feather);
    const t = tmpCanvas(W, H).getContext("2d");
    t.save(); t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = "source-over"; t.globalAlpha = 1;
    t.clearRect(0, 0, W, H); t.drawImage(B, 0, 0);
    t.globalCompositeOperation = "destination-in";
    const g = from === "left" ? t.createLinearGradient(edge - feather, 0, edge, 0)
      : from === "right" ? t.createLinearGradient(W - (edge - feather), 0, W - edge, 0)
      : from === "top" ? t.createLinearGradient(0, edge - feather, 0, edge)
      : t.createLinearGradient(0, H - (edge - feather), 0, H - edge);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    t.fillStyle = g; t.fillRect(0, 0, W, H); t.restore();
    ctx.drawImage(A, 0, 0); ctx.drawImage(tmpCanvas(W, H), 0, 0);
  } else if (type === "stairs") {
    const cols = 18, rows = Math.max(6, Math.round(cols * H / W)), cw = W / cols, ch = H / rows, band = 0.35, span = cols + rows - 2;
    ctx.drawImage(A, 0, 0);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = from === "left" ? i + j : from === "right" ? (cols - 1 - i) + j : from === "top" ? j + i : (rows - 1 - j) + i;
      const s = clamp01((e * (1 + band) - k / span) / band);
      if (s <= 0) continue;
      let x = i * cw, y = j * ch, w = cw, h = ch;
      if (s < 1) {
        if (horiz) { w = cw * s; if (from === "right") x = (i + 1) * cw - w; }
        else { h = ch * s; if (from === "bottom") y = (j + 1) * ch - h; }
      }
      blitRect(ctx, B, x, y, w, h);
    }
  } else if (type === "mosaic") {
    const cols = 24, rows = Math.max(8, Math.round(cols * H / W)), n = cols * rows, cw = W / cols, ch = H / rows, band = 0.3, order = mosaicOrder(n);
    ctx.drawImage(A, 0, 0);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const s = clamp01((e * (1 + band) - order[j * cols + i] / (n - 1)) / band);
      if (s <= 0) continue;
      const w = cw * s, h = ch * s;
      blitRect(ctx, B, i * cw + (cw - w) / 2, j * ch + (ch - h) / 2, w, h);
    }
  } else if (type === "comb") {
    const n = 12, sign = from === "left" || from === "top" ? 1 : -1;
    ctx.drawImage(A, 0, 0);
    for (let i = 0; i < n; i++) {
      const dir = (i % 2 === 0 ? -1 : 1) * sign, off = Math.round((1 - e) * (horiz ? W : H) * dir);
      ctx.save(); ctx.beginPath();
      if (horiz) {
        const y0 = Math.floor(i * H / n), y1 = Math.ceil((i + 1) * H / n);
        ctx.rect(0, y0, W, y1 - y0); ctx.clip(); ctx.drawImage(B, 0, y0, W, y1 - y0, off, y0, W, y1 - y0);
      } else {
        const x0 = Math.floor(i * W / n), x1 = Math.ceil((i + 1) * W / n);
        ctx.rect(x0, 0, x1 - x0, H); ctx.clip(); ctx.drawImage(B, x0, 0, x1 - x0, H, x0, off, x1 - x0, H);
      }
      ctx.restore();
    }
  } else if (type === "stripes") {
    const n = horiz ? 32 : 18;
    ctx.drawImage(A, 0, 0);
    for (let i = 0; i < n; i++) {
      const order = from === "left" || from === "top" ? i : n - 1 - i;
      const s = clamp01(e * 1.6 - 0.6 * (order / (n - 1)));
      if (s <= 0) continue;
      if (horiz) {
        const sw = W / n, w = sw * s;
        blitRect(ctx, B, from === "right" ? (i + 1) * sw - w : i * sw, 0, w, H);
      } else {
        const sh = H / n, h = sh * s;
        blitRect(ctx, B, 0, from === "bottom" ? (i + 1) * sh - h : i * sh, W, h);
      }
    }
  } else if (type === "cut") {
    if (p < 0.4) ctx.drawImage(A, 0, 0);
    else if (p < 0.6) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    else ctx.drawImage(B, 0, 0);
  } else if (type === "bright") {
    ctx.drawImage(e < 0.5 ? A : B, 0, 0);
    const a = e < 0.5 ? e * 2 : (1 - e) * 2;
    ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.drawImage(B, 0, 0);
  }
  ctx.restore();
}
