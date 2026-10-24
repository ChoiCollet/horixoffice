/* =========================================================
   print.js — 인쇄 설정 모달과 인쇄용 PDF 생성
   실제 프린터로 보내지 않고, 설정을 반영한 새 PDF 파일을 만들어 다운로드합니다.
   ========================================================= */

const MM_TO_PT = 2.83465;

const PAPER_SIZES_MM = {
  A4: [210, 297],
  A3: [297, 420],
  Letter: [215.9, 279.4],
  B5: [176, 250],
};

function parsePageRange(text, max) {
  const out = new Set();
  text.split(",").forEach((part) => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= max) out.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= max) out.add(n);
    }
  });
  return Array.from(out).sort((a, b) => a - b);
}

function getOrient() { return document.querySelector("input[name=orient]:checked").value; }

function getSelectedPages() {
  const mode = document.querySelector("input[name=prange]:checked").value;
  const all = Array.from({ length: STATE.numPages }, (_, i) => i + 1);
  let pages;
  if (mode === "all") pages = all;
  else if (mode === "current") pages = [STATE.currentPage];
  else if (mode === "from") pages = all.filter((n) => n >= STATE.currentPage);
  else if (mode === "to") pages = all.filter((n) => n <= STATE.currentPage);
  else pages = parsePageRange($("customRange").value, STATE.numPages);
  if ($("reversePrint").checked) pages = pages.slice().reverse();
  return pages;
}

const PRINTMOD = {
  previewPage: 1,

  open() {
    if (!STATE.pdfDoc) return;
    $("customRange").value = "";
    document.querySelector("input[name=prange][value=all]").checked = true;
    this.previewPage = STATE.currentPage;
    $("previewSlider").max = STATE.numPages;
    $("previewSlider").value = this.previewPage;
    this.setTarget(this.target());
    openModal("printWin"); centerWin($("printWin"));
    this.updatePreview();
  },

  setPreviewPage(n) {
    this.previewPage = Math.max(1, Math.min(STATE.numPages, n));
    $("previewSlider").value = this.previewPage;
    this.updatePreview();
  },

  async updatePreview() {
    const pages = getSelectedPages();
    const canvas = $("previewCanvas");
    const ctx = canvas.getContext("2d");
    $("previewPageLabel").textContent = `${this.previewPage} / ${STATE.numPages}`;

    const [paperW, paperH] = PAPER_SIZES_MM[$("paperSize").value];
    let orient = getOrient();
    if (orient === "auto") {
      const page = await STATE.pdfDoc.getPage(this.previewPage);
      const vp = page.getViewport({ scale: 1, rotation: getPageRotation(this.previewPage) });
      orient = vp.width > vp.height ? "landscape" : "portrait";
    }
    const [pw, ph] = orient === "landscape" ? [paperH, paperW] : [paperW, paperH];

    const maxBox = 240;
    const scale = Math.min(maxBox / pw, maxBox / ph);
    canvas.width = pw * scale;
    canvas.height = ph * scale;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const page = await STATE.pdfDoc.getPage(this.previewPage);
    const rotation = getPageRotation(this.previewPage);
    const base = page.getViewport({ scale: 1, rotation });
    // 용지에 맞게 크기 조정을 끄면 실제 크기(100%)로 — 용지보다 크면 넘친 부분은 잘려요
    let drawScale = Math.min(canvas.width / base.width, canvas.height / base.height);
    if (!$("fitToPage").checked) drawScale = canvas.width / (pw * MM_TO_PT);
    const vp = page.getViewport({ scale: drawScale, rotation });
    const off = document.createElement("canvas");
    off.width = vp.width; off.height = vp.height;
    await page.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
    if (ANNOTATE.visible) (ANNOTATE.byPage[this.previewPage] || []).forEach((sh) => ANNOTATE.drawShape(off.getContext("2d"), sh, vp));

    const dx = (canvas.width - vp.width) / 2;
    const dy = (canvas.height - vp.height) / 2;
    ctx.drawImage(off, dx, dy);

    $("previewText").textContent = `${Math.round(pw)} mm X ${Math.round(ph)} mm` +
      (pages.length ? ` · 인쇄 시 ${pages.length}쪽` : " · 선택된 인쇄 범위가 없어요");
  },

  // 인쇄할 곳: 'printer'(시스템 인쇄 창) | 'pdf'(인쇄용 PDF 파일로 저장)
  target() { return $("printWin").dataset.target || "printer"; },
  setTarget(t) {
    $("printWin").dataset.target = t;
    document.querySelectorAll("#printWin .prn[data-target]").forEach((el) => el.classList.toggle("on", el.dataset.target === t));
    $("printToFile").checked = t === "pdf";
    $("executePrint").textContent = t === "pdf" ? "저장(D)" : "인쇄(D)";
    $("printStatus").value = t === "pdf" ? "준비됨 · 인쇄용 PDF 파일로 저장해요" : "준비됨 · 이 기기에 연결된 프린터";
  },

  options() {
    const [paperW, paperH] = PAPER_SIZES_MM[$("paperSize").value];
    const copies = Math.max(1, Math.min(99, parseInt($("copies").value, 10) || 1));
    const pages = getSelectedPages(), seq = [];
    if ($("collate").checked) for (let c = 0; c < copies; c++) seq.push(...pages);
    else pages.forEach((p) => { for (let c = 0; c < copies; c++) seq.push(p); });
    return { paperW, paperH, orient: getOrient(), fit: $("fitToPage").checked, seq, pages };
  },

  async execute() {
    const o = this.options();
    if (!o.pages.length) { showToast("인쇄할 쪽을 선택해 주세요."); return; }
    const t = this.target();
    showLoading(t === "pdf" ? "인쇄용 PDF를 만드는 중…" : "인쇄를 준비하는 중…");
    try {
      if (t === "pdf") {
        const { bytes } = await buildPrintPdf(o);
        downloadBytes(bytes, replaceExt(STATE.fileName, "_인쇄용.pdf"), "application/pdf");
        showToast("인쇄용 PDF를 저장했어요.");
      } else if (canPrintPdfInFrame()) {
        const { bytes } = await buildPrintPdf(o);
        hideLoading();
        await printPdfInFrame(bytes);
      } else {
        await printAsImages(o);
      }
      closeModal("printWin");
    } catch (err) {
      console.error(err);
      showToast("인쇄를 준비하는 중 문제가 발생했어요.");
    } finally {
      hideLoading();
    }
  },
};

/* ---------- 인쇄용 PDF 만들기 ----------
   쪽을 그림으로 바꾸지 않고 원래 내용(글자·벡터)을 그대로 새 용지 위에 올려요 → 선명하고 가벼워요.
   주석이 보이는 상태면 주석도, 쪽 회전도 반영해요. 암호·권한 제한 PDF는 그림 방식으로 대신 만들어요. */
async function buildPrintPdf(o) {
  const PL = PDFLib, MM = MM_TO_PT;
  let srcBytes = STATE.fileBytes;
  const rotated = Object.keys(STATE.pageRotations).some((k) => STATE.pageRotations[k]);
  try {
    if ((ANNOTATE.visible && ANNOTATE.hasAny()) || rotated) srcBytes = await buildAnnotatedPDF(PL, STATE.fileBytes, ANNOTATE.visible ? ANNOTATE.byPage : {}, STATE.pageRotations, {});
    const src = await PL.PDFDocument.load(srcBytes);
    const out = await PL.PDFDocument.create();
    const uniq = [...new Set(o.seq)];
    const boxes = uniq.map((n) => { const b = src.getPage(n - 1).getCropBox(); return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }; });
    const emb = await out.embedPages(uniq.map((n) => src.getPage(n - 1)), boxes);
    const byNum = new Map(uniq.map((n, i) => [n, emb[i]]));
    for (const n of o.seq) {
      const ep = byNum.get(n), rot = ((src.getPage(n - 1).getRotation().angle % 360) + 360) % 360;
      const side = rot === 90 || rot === 270;
      const vw = side ? ep.height : ep.width, vh = side ? ep.width : ep.height; // 화면에 보이는 크기
      let orient = o.orient;
      if (orient === "auto") orient = vw > vh ? "landscape" : "portrait";
      const [pw, ph] = (orient === "landscape" ? [o.paperH, o.paperW] : [o.paperW, o.paperH]).map((mm) => mm * MM);
      const s = o.fit ? Math.min(pw / vw, ph / vh) : 1;
      const W = ep.width * s, H = ep.height * s;           // 회전 전 크기
      const bw = vw * s, bh = vh * s;                        // 회전 후 크기
      const ox = (pw - bw) / 2, oy = (ph - bh) / 2;          // 용지 가운데에 놓을 왼쪽 아래
      // 쪽의 /Rotate(시계 방향)만큼 돌려서 놓기
      const at = { 0: [ox, oy], 90: [ox, oy + W], 180: [ox + W, oy + H], 270: [ox + H, oy] }[rot] || [ox, oy];
      out.addPage([pw, ph]).drawPage(ep, { x: at[0], y: at[1], xScale: s, yScale: s, rotate: PL.degrees(-rot) });
    }
    return { bytes: await out.save(), vector: true };
  } catch (e) {
    console.warn("인쇄: 그림 방식으로 대신 만들어요", e);
    return { bytes: await buildPrintPdfRaster(o), vector: false };
  }
}

// 예비 방식: 쪽을 그림으로 그려서 용지에 올리기
async function buildPrintPdfRaster(o) {
  const outDoc = await PDFLib.PDFDocument.create(), cache = new Map();
  for (const pageNum of o.seq) {
    const page = await STATE.pdfDoc.getPage(pageNum), rotation = getPageRotation(pageNum);
    const base = page.getViewport({ scale: 1, rotation });
    let orient = o.orient;
    if (orient === "auto") orient = base.width > base.height ? "landscape" : "portrait";
    const [pw, ph] = (orient === "landscape" ? [o.paperH, o.paperW] : [o.paperW, o.paperH]).map((mm) => mm * MM_TO_PT);
    if (!cache.has(pageNum)) cache.set(pageNum, await outDoc.embedPng(await renderPageImage(pageNum, 2, "image/png")));
    const png = cache.get(pageNum);
    const s = o.fit ? Math.min(pw / base.width, ph / base.height) : 1;
    const w = base.width * s, h = base.height * s;
    outDoc.addPage([pw, ph]).drawImage(png, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return outDoc.save();
}

// 한 쪽을 그림 파일 바이트로 (주석이 보이면 주석 포함)
async function renderPageImage(pageNum, scale, mime, quality) {
  const page = await STATE.pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale, rotation: getPageRotation(pageNum) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (ANNOTATE.visible) (ANNOTATE.byPage[pageNum] || []).forEach((sh) => ANNOTATE.drawShape(ctx, sh, vp));
  const bytes = await new Promise((res) => canvas.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), mime || "image/png", quality));
  canvas.width = canvas.height = 0;
  return bytes;
}

/* ---------- 실제로 인쇄하기 ---------- */
// 컴퓨터의 크롬·엣지·파이어폭스·사파리는 PDF를 바로 인쇄할 수 있어요. 휴대폰은 그림 방식으로 인쇄해요.
function canPrintPdfInFrame() {
  return !isMobile() && navigator.pdfViewerEnabled !== false && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function printPdfInFrame(bytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const ifr = document.createElement("iframe");
    ifr.className = "printFrame"; ifr.src = url;
    const cleanup = () => setTimeout(() => { ifr.remove(); URL.revokeObjectURL(url); }, 60000);
    ifr.onload = () => {
      setTimeout(() => {
        try { ifr.contentWindow.focus(); ifr.contentWindow.print(); }
        catch (e) { window.open(url, "_blank"); showToast("새 탭에서 연 PDF의 인쇄 버튼을 눌러 주세요."); }
        cleanup(); resolve();
      }, 300);
    };
    document.body.appendChild(ifr);
  });
}
// 휴대폰 등: 쪽 그림을 인쇄 전용 영역에 깔고 브라우저 인쇄 창을 열어요 (가로·세로 용지도 쪽마다 맞춰요)
async function printAsImages(o) {
  const area = document.createElement("div"); area.id = "printArea";
  const style = document.createElement("style"); style.id = "printPageStyle";
  const size = $("paperSize").value;
  style.textContent = `@page{size:${size} portrait;margin:0}@page land{size:${size} landscape;margin:0}`;
  const urls = [], cache = new Map();
  for (let i = 0; i < o.seq.length; i++) {
    const n = o.seq[i];
    $("loadingText").textContent = `인쇄를 준비하는 중… ${i + 1}/${o.seq.length}`;
    if (!cache.has(n)) {
      const url = URL.createObjectURL(new Blob([await renderPageImage(n, 2, "image/jpeg", 0.92)], { type: "image/jpeg" }));
      urls.push(url); cache.set(n, url);
    }
    const page = await STATE.pdfDoc.getPage(n), v = page.getViewport({ scale: 1, rotation: getPageRotation(n) });
    let orient = o.orient; if (orient === "auto") orient = v.width > v.height ? "landscape" : "portrait";
    const sheet = document.createElement("div"); sheet.className = "printSheet" + (orient === "landscape" ? " land" : "");
    const img = document.createElement("img"); img.src = cache.get(n);
    if (!o.fit) { img.className = "actual"; img.style.width = (v.width / MM_TO_PT).toFixed(1) + "mm"; }
    sheet.appendChild(img); area.appendChild(sheet);
  }
  document.head.appendChild(style); document.body.appendChild(area);
  await Promise.all([...area.querySelectorAll("img")].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
  hideLoading();
  const done = () => { area.remove(); style.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
  setTimeout(() => { if (document.getElementById("printArea")) done(); }, 120000);
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function replaceExt(name, suffix) {
  const base = name.replace(/\.pdf$/i, "");
  return base + suffix;
}
