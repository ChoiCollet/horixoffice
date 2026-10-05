// 전환 효과를 진짜 캔버스(node-canvas)에서 한 프레임씩 그려 보고, 부드러운지 숫자로 확인한다
const fs = require("fs"), path = require("path");
const { createCanvas } = require("canvas");
const code = fs.readFileSync(path.join(__dirname, "..", "js", "transitions.js"), "utf8");
const T = new Function("document", code + "\nTRANS_ENV.createCanvas=(w,h)=>__cc(w,h);\nreturn { drawTransition, TRANS_TYPES, TRANS_DIRS, TRANS_ENV, mosaicOrder, easeCubic };".replace("__cc", "globalThis.__cc"))({});
globalThis.__cc = (w, h) => createCanvas(w, h);
const W = 640, H = 360, FRAMES = 60;
const solid = (c) => { const cv = createCanvas(W, H); const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, W, H); return cv; };
const A = solid("#ff0000"), B = solid("#0000ff");
const out = createCanvas(W, H), ctx = out.getContext("2d");
const results = []; const ok = (n, c, d) => results.push({ n, pass: !!c, d });

// 한 프레임을 그리고: 파랑 비율, 불투명 여부, 붉은기/푸른기 이외의 색(검정·흰색) 비율을 센다
function frame(type, p, from) {
  ctx.clearRect(0, 0, W, H);
  T.drawTransition(ctx, A, B, p, type, { from });
  const d = ctx.getImageData(0, 0, W, H).data; let blue = 0, opaque = 0, other = 0, n = W * H;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 255) opaque++;
    if (d[i + 2] > d[i]) blue++;
    if ((d[i] > 200 && d[i + 2] > 200) || (d[i] < 30 && d[i + 2] < 30)) other++;
  }
  return { blue: blue / n, opaque: opaque / n, other: other / n, d };
}
const px = (f, x, y) => { const i = (y * W + x) * 4; return [f.d[i], f.d[i + 1], f.d[i + 2]]; };

const SMOOTH = ["wipe", "push", "stairs", "mosaic", "comb", "stripes"];
const timing = {};
for (const type of SMOOTH) for (const from of ["left", "right", "top", "bottom"]) {
  const series = [], t0 = process.hrtime.bigint();
  for (let k = 0; k <= FRAMES; k++) series.push(frame(type, k / FRAMES, from));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / (FRAMES + 1);
  timing[type] = Math.max(timing[type] || 0, ms);
  const b = series.map((s) => s.blue);
  let mono = true, maxJump = 0;
  for (let k = 1; k < b.length; k++) { if (b[k] < b[k - 1] - 0.004) mono = false; maxJump = Math.max(maxJump, b[k] - b[k - 1]); }
  const name = `${type}/${from}`;
  ok(`${name}: 시작은 이전 쪽, 끝은 다음 쪽이다`, b[0] < 0.001 && b[FRAMES] > 0.999, `${b[0]} → ${b[FRAMES]}`);
  ok(`${name}: 진행하는 동안 새 쪽이 줄어들지 않고 늘기만 한다`, mono);
  ok(`${name}: 한 프레임에 갑자기 많이 바뀌지 않는다 (최대 ${(maxJump * 100).toFixed(1)}%/프레임)`, maxJump < (type === "stairs" ? 0.10 : 0.075), maxJump);
  ok(`${name}: 모든 프레임이 완전히 불투명하다 (구멍·깜빡임 없음)`, series.every((s) => s.opaque > 0.9999));
  ok(`${name}: 중간에 엉뚱한 색(검정·흰색 번쩍임)이 끼지 않는다`, series.every((s) => s.other < 0.02), Math.max(...series.map((s) => s.other)));
}
// 방향 검증
let f = frame("push", 0.5, "left"); ok("밀어내기(왼쪽에서): 절반 지점에서 왼쪽은 새 쪽, 오른쪽은 이전 쪽", px(f, 100, 100)[2] > 200 && px(f, 540, 100)[0] > 200, JSON.stringify([px(f, 100, 100), px(f, 540, 100)]));
f = frame("push", 0.5, "top"); ok("밀어내기(위에서): 위쪽이 새 쪽", px(f, 300, 50)[2] > 200 && px(f, 300, 310)[0] > 200);
f = frame("wipe", 0.5, "right"); ok("닦아내기(오른쪽에서): 오른쪽 끝이 새 쪽, 왼쪽 끝이 이전 쪽", px(f, 620, 100)[2] > 200 && px(f, 20, 100)[0] > 200);
f = frame("wipe", 0.5, "left"); const edgeCols = []; for (let x = 0; x < W; x += 8) edgeCols.push(px(f, x, 50)[2]);
ok("닦아내기: 경계가 부드럽게 번진다 (붉은색→보라→푸른색 중간 단계가 있다)", edgeCols.some((v) => v > 60 && v < 200), edgeCols.join(","));
f = frame("comb", 0.5, "left"); ok("빗질하기: 한 프레임 안에서 줄마다 방향이 엇갈려 새 쪽이 들어온다 (위 줄/아래 줄이 다르다)", px(f, 40, 15)[2] !== px(f, 40, 45)[2] || px(f, 600, 15)[2] !== px(f, 600, 45)[2]);
f = frame("mosaic", 0.5, "left"); ok("모자이크: 절반쯤에서 새 쪽 칸이 흩어져 있다 (왼쪽·오른쪽 모두 섞임)", (() => { let l = 0, r = 0; for (let y = 0; y < H; y += 6) { if (px(f, 100, y)[2] > 128) l++; if (px(f, 540, y)[2] > 128) r++; } return l > 3 && r > 3; })());
ok("모자이크: 칸 순서가 매번 똑같다 (재생할 때마다 모양이 같음)", JSON.stringify(T.mosaicOrder(24 * 14).slice(0, 10)) === JSON.stringify(T.mosaicOrder(24 * 14).slice(0, 10)));

// 이산 효과
const midCut = frame("cut", 0.5, "left"), cutEarly = frame("cut", 0.2, "left"), cutLate = frame("cut", 0.8, "left");
ok("자르기: 처음엔 이전 쪽 → 가운데에서 검은 화면 → 새 쪽", px(cutEarly, 10, 10)[0] > 200 && px(midCut, 10, 10).every((v) => v < 10) && px(cutLate, 10, 10)[2] > 200);
const bPeak = frame("bright", 0.5, "left"), bEarly = frame("bright", 0.15, "left"), bLate = frame("bright", 0.85, "left");
ok("밝기 변화: 가운데에서 가장 밝고(거의 흰색), 양끝은 원래 색에 가깝다", px(bPeak, 5, 5).every((v) => v > 245) && px(bEarly, 5, 5)[0] > 200 && px(bLate, 5, 5)[2] > 200, JSON.stringify([px(bEarly, 5, 5), px(bPeak, 5, 5), px(bLate, 5, 5)]));
const bs = []; for (let k = 0; k <= FRAMES; k++) { const fr = frame("bright", k / FRAMES, "left"); bs.push(px(fr, 5, 5).reduce((a, c) => a + c, 0)); }
let maxStep = 0; for (let k = 1; k < bs.length; k++) maxStep = Math.max(maxStep, Math.abs(bs[k] - bs[k - 1]));
ok("밝기 변화: 밝기가 프레임마다 서서히 변한다 (색이 튀지 않음)", maxStep < 150, maxStep);
ok("없음: 바로 새 쪽이다", frame("none", 0.3, "left").blue > 0.999);

// 성능 (이 컴퓨터의 CPU 소프트웨어 렌더링 기준 — 브라우저의 GPU 캔버스는 대개 더 빠름)
const big = { w: 1920, h: 1080 }; const BA = createCanvas(big.w, big.h), BB = createCanvas(big.w, big.h);
BA.getContext("2d").fillStyle = "#f00"; BA.getContext("2d").fillRect(0, 0, big.w, big.h); BB.getContext("2d").fillStyle = "#00f"; BB.getContext("2d").fillRect(0, 0, big.w, big.h);
const bo = createCanvas(big.w, big.h).getContext("2d"); const perf = {};
for (const type of SMOOTH) { const t0 = process.hrtime.bigint(); for (let k = 0; k < 12; k++) T.drawTransition(bo, BA, BB, (k + 1) / 13, type, { from: "left" }); perf[type] = Number(process.hrtime.bigint() - t0) / 1e6 / 12; }
const worst = Math.max(...Object.values(perf));
ok(`1920×1080 한 프레임 그리는 시간이 16.7ms(60fps) 안이다 — 가장 느린 효과 ${worst.toFixed(1)}ms`, worst < 40, JSON.stringify(perf));

console.log("\n=== 전환 효과 검증 (64개 장면 조합) ===");
let fail = 0; for (const r of results) if (!r.pass) { console.log("❌ " + r.n + (r.d !== undefined ? "  → " + String(r.d).slice(0, 220) : "")); fail++; }
console.log(`총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`);
console.log("1920×1080 프레임당 ms:", Object.entries(perf).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" | "));
process.exit(fail ? 1 : 0);
