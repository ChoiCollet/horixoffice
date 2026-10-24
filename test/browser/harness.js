// 실제 Chromium으로 사이트를 띄워서 확인하는 도우미 (cdnjs는 로컬 node_modules로 대신 연결)
const path = require("path"), fs = require("fs");
const { chromium, devices } = require("/opt/npm-tools/node_modules/playwright");
const ROOT = path.resolve(__dirname, "../..");
const NM = path.join(ROOT, "node_modules");
const MAP = {
  "pdf.js/3.11.174/pdf.min.js": path.join(NM, "pdfjs-dist/build/pdf.min.js"),
  "pdf.js/3.11.174/pdf.worker.min.js": path.join(NM, "pdfjs-dist/build/pdf.worker.min.js"),
  "pdf-lib/1.17.1/pdf-lib.min.js": path.join(NM, "pdf-lib/dist/pdf-lib.min.js"),
};
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".pdf": "application/pdf", ".xml": "application/xml", ".txt": "text/plain" };
async function setup(ctx) {
  await ctx.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "cdnjs.cloudflare.com") {
      const key = Object.keys(MAP).find((k) => url.pathname.endsWith(k));
      if (key) return route.fulfill({ path: MAP[key], contentType: "application/javascript" });
      return route.abort();
    }
    if (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/pdfjs-dist@3.11.174/")) {
      const f = path.join(NM, "pdfjs-dist", url.pathname.slice("/npm/pdfjs-dist@3.11.174/".length));
      if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: "application/octet-stream", headers: { "access-control-allow-origin": "*" } });
      return route.fulfill({ status: 404, body: "nf" });
    }
    if (url.hostname === "horix.test") {
      let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
      const f = path.join(ROOT, p);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f, contentType: TYPES[path.extname(f)] || "application/octet-stream" });
      return route.fulfill({ status: 404, body: "nf" });
    }
    return route.abort();
  });
}
async function launch(opts = {}) {
  const browser = await chromium.launch({ env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--font-render-hinting=none"] });
  const ctxOpts = opts.mobile ? { ...devices["Pixel 7"], locale: "ko-KR" } : { viewport: { width: opts.w || 1366, height: opts.h || 820 }, locale: "ko-KR" };
  const ctx = await browser.newContext({ ...ctxOpts, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  await setup(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", (d) => { (page._dialogs = page._dialogs || []).push(d.message()); d.accept(page._dialogAnswer || "").catch(() => {}); });
  await page.goto("http://horix.test/index.html");
  await page.waitForFunction(() => window.pdfjsLib && window.PDFLib && typeof ACT !== "undefined");
  return { browser, ctx, page, errors };
}
async function openPdf(page, name) {
  await page.setInputFiles("#fileInput", path.join(ROOT, "test/fixtures", name));
  await page.waitForFunction(() => STATE.pdfDoc && !document.getElementById("loading").classList.contains("show"), null, { timeout: 15000 });
  await page.waitForTimeout(300);
}
module.exports = { launch, openPdf, ROOT };
