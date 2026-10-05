// 실제 캔버스(node-canvas)로 슬라이드쇼를 끝까지 돌려서, 시간이 흐르는 동안 화면이 정말 조금씩 바뀌는지 확인
const fs = require("fs"), path = require("path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
html = html.replace(/<script src="https:\/\/cdnjs[^>]*><\/script>\s*/g, "").replace(/<script>\s*pdfjsLib\.GlobalWorkerOptions[\s\S]*?<\/script>\s*/, "");
const names = [...html.matchAll(/<script src="js\/([a-zA-Z_]+\.js)"><\/script>/g)].map((m) => m[1]);
html = html.replace(/<script src="js\/[a-zA-Z_]+\.js"><\/script>\s*/g, "");
html = html.replace("</body>", names.map((f) => `<script>\n${fs.readFileSync(path.join(ROOT, "js", f), "utf8")}\n</script>`).join("\n") + "\n<script>window.__t={STATE,PRESENT,PREFS,TRANS_TYPES,ANNOTATE};</script></body>");
const COLORS = ["#ff0000", "#0000ff", "#00aa00"];
const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously", beforeParse(w) {
  w.Element.prototype.scrollIntoView = () => {}; w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.pdfjsLib = { GlobalWorkerOptions: {}, Util: { transform: () => [1, 0, 0, 1, 0, 0] }, getDocument: () => ({ promise: Promise.resolve({
    numPages: 3, getAttachments: async () => null,
    getPage: async (n) => ({ getViewport: ({ scale = 1 } = {}) => ({ width: 595 * scale, height: 842 * scale, scale, transform: [scale, 0, 0, -scale, 0, 842 * scale], convertToPdfPoint: (x, y) => [x, y], convertToViewportPoint: (x, y) => [x, y] }),
      render: ({ canvasContext: c, viewport: v }) => ({ promise: Promise.resolve().then(() => { c.fillStyle = COLORS[n - 1]; c.fillRect(0, 0, v.width, v.height); }) }),
      getTextContent: async () => ({ items: [], styles: {} }) }) }) }) };
  w.PDFLib = {};
} });
const w = dom.window, T = () => w.__t, $ = (id) => w.document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (n, c, d) => results.push({ n, pass: !!c, d });

(async () => {
  await sleep(50);
  T().STATE.pdfDoc = await w.pdfjsLib.getDocument().promise; T().STATE.numPages = 3; T().STATE.currentPage = 1; T().STATE.pageViewport = null;
  const canvas = $("presentCanvas"), ctx = canvas.getContext("2d");
  const stat = () => { const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let r = 0, b = 0, g = 0, black = 0, n = 0, lum = 0; for (let i = 0; i < d.length; i += 4 * 7) { n++; lum += (d[i] + d[i + 1] + d[i + 2]) / 765; if (d[i] > 200 && d[i + 2] < 60) r++; else if (d[i + 2] > 200 && d[i] < 60) b++; else if (d[i + 1] > 140 && d[i] < 60 && d[i + 2] < 60) g++; else if (d[i] < 25 && d[i + 1] < 25 && d[i + 2] < 25) black++; } return { r: r / n, b: b / n, g: g / n, black: black / n, lum: lum / n }; };

  for (const type of ["push", "wipe", "mosaic", "stairs", "comb", "stripes", "bright", "cut"]) {
    T().PREFS.data.pres = { type, from: "left", dur: 0.8, monitor: "default" };
    await T().PRESENT.open(1); await sleep(80);
    const first = stat();
    ok(`${type}: 시작 화면은 1쪽(빨강)이다`, first.r > 0.4, JSON.stringify(first));
    const frames = []; const timer = setInterval(() => frames.push(stat()), 40);
    await T().PRESENT.next(); clearInterval(timer); await sleep(20);
    const last = stat();
    const blues = frames.map((f) => f.b);
    const distinct = new Set(blues.map((v) => Math.round(v * 40))).size;
    let mono = true; for (let k = 1; k < blues.length; k++) if (blues[k] < blues[k - 1] - 0.02) mono = false;
    if (type === "bright") { const lums = frames.map((f) => f.lum), peak = Math.max(...lums), dl = new Set(lums.map((v) => Math.round(v * 20))).size;
      ok(`${type}: 가운데에서 거의 하얗게 밝아졌다가(최대 밝기 ${peak.toFixed(2)}) 새 쪽으로 돌아온다, 밝기가 ${dl}단계로 서서히 변한다`, peak > 0.9 && dl >= 5 && last.b > 0.4, JSON.stringify(lums.map((v) => +v.toFixed(2)))); }
    else if (type === "cut") ok(`${type}: 중간에 검은 화면이 한 번 끼었다가 새 쪽이 나온다`, frames.some((f) => f.black > 0.9) && last.b > 0.4);
    else {
      ok(`${type}: 시간이 흐르는 동안 새 쪽(파랑)이 점점 늘어난다 (서로 다른 장면 ${distinct}가지, 프레임 ${frames.length}장)`, distinct >= 4 && mono, JSON.stringify(blues.map((v) => +v.toFixed(2))));
      ok(`${type}: 중간에 1쪽(빨강)과 2쪽(파랑)이 함께 보이는 장면이 있다`, frames.some((f) => f.r > 0.03 && f.b > 0.03));
    }
    ok(`${type}: 끝나면 2쪽(파랑)만 남는다`, last.b > 0.4 && last.r < 0.01, JSON.stringify(last));
    T().PRESENT.close(); await sleep(20);
  }
  console.log("\n=== 슬라이드쇼 실제 재생 검증 (진짜 캔버스) ===");
  let fail = 0; for (const r of results) { if (!r.pass) { console.log("❌ " + r.n + (r.d !== undefined ? "  → " + String(r.d).slice(0, 260) : "")); fail++; } }
  console.log(`총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
