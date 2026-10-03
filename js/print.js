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
    let drawScale = Math.min(canvas.width / base.width, canvas.height / base.height);
    if (!$("fitToPage").checked) drawScale = Math.min(drawScale, canvas.width / base.width);
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

  async execute() {
    const pages = getSelectedPages();
    if (!pages.length) { showToast("인쇄할 쪽을 선택해 주세요."); return; }

    showLoading("인쇄용 PDF를 만드는 중…");
    try {
      const [paperW, paperH] = PAPER_SIZES_MM[$("paperSize").value];
      let orientSetting = getOrient();
      const fitToPage = $("fitToPage").checked;
      const copies = Math.max(1, Math.min(99, parseInt($("copies").value, 10) || 1));
      const collate = $("collate").checked;

      // 매수/한 부씩 인쇄 여부에 따른 최종 페이지 순서 구성
      let sequence = [];
      if (collate) {
        for (let c = 0; c < copies; c++) sequence.push(...pages);
      } else {
        pages.forEach((p) => { for (let c = 0; c < copies; c++) sequence.push(p); });
      }

      const outDoc = await PDFLib.PDFDocument.create();

      for (const pageNum of sequence) {
        const page = await STATE.pdfDoc.getPage(pageNum);
        const rotation = getPageRotation(pageNum);
        const base = page.getViewport({ scale: 1, rotation });

        let orient = orientSetting;
        if (orient === "auto") orient = base.width > base.height ? "landscape" : "portrait";
        const [pwMM, phMM] = orient === "landscape" ? [paperH, paperW] : [paperW, paperH];
        const pwPt = pwMM * MM_TO_PT, phPt = phMM * MM_TO_PT;

        // 고해상도로 래스터화 (인쇄 품질 확보)
        const scale = fitToPage
          ? Math.min((pwPt) / base.width, (phPt) / base.height) * 2
          : 2;
        const vp = page.getViewport({ scale, rotation });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        if (ANNOTATE.visible) (ANNOTATE.byPage[pageNum] || []).forEach((sh) => ANNOTATE.drawShape(canvas.getContext("2d"), sh, vp));

        const pngBytes = await new Promise((res) =>
          canvas.toBlob((b) => b.arrayBuffer().then(res), "image/png")
        );
        const png = await outDoc.embedPng(pngBytes);

        const outPage = outDoc.addPage([pwPt, phPt]);
        let drawW = pwPt, drawH = phPt;
        if (fitToPage) {
          const s = Math.min(pwPt / png.width, phPt / png.height);
          drawW = png.width * s; drawH = png.height * s;
        } else {
          const s = Math.min(pwPt / png.width, phPt / png.height, 1);
          drawW = png.width * s; drawH = png.height * s;
        }
        outPage.drawImage(png, {
          x: (pwPt - drawW) / 2,
          y: (phPt - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }

      const bytes = await outDoc.save();
      downloadBytes(bytes, replaceExt(STATE.fileName, "_인쇄용.pdf"), "application/pdf");
      showToast("인쇄용 PDF를 만들었어요.");
      closeModal("printWin");
    } catch (err) {
      console.error(err);
      showToast("인쇄용 PDF 생성 중 문제가 발생했어요.");
    } finally {
      hideLoading();
    }
  },
};

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
