/* =========================================================
   tools.js — 도구 탭: 쪽 추출하기 · 선택 영역 내보내기(이미지 / 잘라낸 PDF / 글자)
   ========================================================= */

/* ---------- 순수 함수 (노드에서 검증) ---------- */

// rect = [x0, y0, x1, y1] (PDF 좌표) 안에 들어 있는 글자를 줄 단위 글로
function regionText(content, rect) {
  const [x0, y0, x1, y1] = rect;
  const items = (content.items || []).filter((it) => {
    if (!it.transform || !it.str) return false;
    const cx = it.transform[4] + (it.width || 0) / 2, cy = it.transform[5] + Math.abs(it.height || it.transform[3]) * 0.3;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
  return extractLines({ items }).map(lineText).join("\n");
}

// 한 쪽을 영역 크기로 잘라낸 새 PDF (글자·그림은 그대로 벡터로 남아요)
async function buildCroppedPDF(PL, bytes, pageIndex, rect) {
  const src = await PL.PDFDocument.load(bytes);
  const out = await PL.PDFDocument.create();
  const [pg] = await out.copyPages(src, [pageIndex]);
  out.addPage(pg);
  const [x0, y0, x1, y1] = rect;
  pg.setCropBox(x0, y0, x1 - x0, y1 - y0);
  return out.save();
}

// 원본에서 고른 쪽만 모아 새 PDF로 (한 파일)
async function buildExtractedPDF(PL, bytes, pageNums) {
  const src = await PL.PDFDocument.load(bytes);
  const out = await PL.PDFDocument.create();
  (await out.copyPages(src, pageNums.map((n) => n - 1))).forEach((p) => out.addPage(p));
  return out.save();
}

/* ---------- 쪽 추출하기 ---------- */
const EXTRACT = {
  open() {
    if (!STATE.pdfDoc) return showToast("먼저 PDF를 열어주세요.");
    openModal("extractWin"); centerWin($("extractWin"));
  },
  pages() {
    const mode = document.querySelector('input[name="exRange"]:checked').value;
    if (mode === "current") return [STATE.currentPage];
    if (mode === "custom") return parsePageRange($("exCustom").value, STATE.numPages);
    return Array.from({ length: STATE.numPages }, (_, i) => i + 1);
  },
  async run() {
    const pages = this.pages();
    if (!pages.length) return showToast("추출할 쪽을 골라 주세요. (예: 1,3,5-7)");
    const each = document.querySelector('input[name="exMode"]:checked').value === "each";
    const reflect = $("exAnno").checked;
    const base = STATE.fileName.replace(/\.pdf$/i, "");
    showLoading("쪽을 추출하는 중…");
    try {
      let src = STATE.fileBytes, raster = false;
      const edited = ANNOTATE.hasAny() || Object.keys(STATE.pageRotations).some((k) => STATE.pageRotations[k]);
      try {
        if (reflect && edited) src = await buildAnnotatedPDF(PDFLib, STATE.fileBytes, ANNOTATE.byPage, STATE.pageRotations, {});
        let out, name, mime = "application/pdf";
        if (each) {
          const files = [];
          for (const n of pages) files.push({ name: `${base}_${n}쪽.pdf`, data: await buildExtractedPDF(PDFLib, src, [n]) });
          out = files.length === 1 ? files[0].data : ZIP.build(files);
          name = files.length === 1 ? files[0].name : `${base}_쪽별.zip`; if (files.length > 1) mime = "application/zip";
        } else { out = await buildExtractedPDF(PDFLib, src, pages); name = `${base}_추출.pdf`; }
        downloadBytes(out, name, mime); showToast(`${name} 파일을 만들었어요.`);
      } catch (e) {
        // 권한 제한(암호화)된 PDF: pdf-lib로는 쪽을 복사할 수 없어서 이미지로 만들어요
        console.warn("쪽 추출: 이미지 방식으로 전환", e); raster = true;
        if (each) {
          const files = [];
          for (const n of pages) files.push({ name: `${base}_${n}쪽.pdf`, data: await ANNOTATE.buildBytesRaster([n]) });
          downloadBytes(files.length === 1 ? files[0].data : ZIP.build(files), files.length === 1 ? files[0].name : `${base}_쪽별.zip`, files.length === 1 ? "application/pdf" : "application/zip");
        } else downloadBytes(await ANNOTATE.buildBytesRaster(pages), `${base}_추출.pdf`, "application/pdf");
        showToast("암호·권한 제한이 걸린 PDF라 쪽을 이미지로 만들었어요. (글자 선택은 안 돼요)");
      }
      closeModal("extractWin");
    } catch (e) { console.error(e); showToast("쪽 추출 중 문제가 발생했어요."); }
    finally { hideLoading(); }
  },
};

/* ---------- 선택 영역 내보내기 ---------- */
const REGION = {
  data: null, // { view, rect, pdfRect, text, png(url) }

  start() {
    if (!STATE.pdfDoc) return showToast("먼저 PDF를 열어주세요.");
    CAPTURE.mode = "export";
    if (!CAPTURE.active) CAPTURE.toggle();
    showToast("내보낼 영역을 드래그하세요.");
  },

  async open(rect, pdfC, annoC, view) {
    const a = view.vp.convertToPdfPoint(rect.x, rect.y), b = view.vp.convertToPdfPoint(rect.x + rect.w, rect.y + rect.h);
    const pdfRect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const dpr = canvasK(pdfC), m = document.createElement("canvas");
    m.width = Math.round(rect.w * dpr); m.height = Math.round(rect.h * dpr);
    const mc = m.getContext("2d"), sx = rect.x * dpr, sy = rect.y * dpr, sw = rect.w * dpr, sh = rect.h * dpr;
    mc.drawImage(pdfC, sx, sy, sw, sh, 0, 0, sw, sh);
    if (ANNOTATE.visible) mc.drawImage(annoC, sx, sy, sw, sh, 0, 0, sw, sh);
    let text = "";
    try { text = regionText(await (await STATE.pdfDoc.getPage(view.page)).getTextContent(), pdfRect); } catch (e) { /* 글자 없음 */ }
    this.data = { view, rect, pdfRect, text, preview: m.toDataURL("image/png") };
    $("exportPreview").src = this.data.preview;
    $("exportText").value = text || "";
    $("exportTextNote").textContent = text ? `글자 ${text.replace(/\s/g, "").length}자를 찾았어요.` : "이 영역에는 선택할 수 있는 글자가 없어요. (그림이거나 스캔한 문서일 수 있어요)";
    document.querySelector('input[name="exFmt"][value="png"]').checked = true;
    openModal("exportWin"); centerWin($("exportWin"));
  },

  // 화면보다 선명하게 다시 그려서 PNG로 (확대 안 한 문서도 글자가 또렷하게)
  async renderPNG() {
    const { view, rect } = this.data;
    const k = Math.min(4, Math.max(1, 2 / view.vp.scale));
    const page = await STATE.pdfDoc.getPage(view.page);
    const vp2 = page.getViewport({ scale: view.vp.scale * k, rotation: getPageRotation(view.page) });
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(rect.w * k)); c.height = Math.max(1, Math.round(rect.h * k));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp2, transform: [1, 0, 0, 1, -rect.x * k, -rect.y * k] }).promise;
    if (ANNOTATE.visible) { ctx.save(); ctx.translate(-rect.x * k, -rect.y * k); (ANNOTATE.byPage[view.page] || []).forEach((s) => ANNOTATE.drawShape(ctx, s, vp2)); ctx.restore(); }
    return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
  },

  fmt() { return document.querySelector('input[name="exFmt"]:checked').value; },
  baseName() { return STATE.fileName.replace(/\.pdf$/i, "") + `_영역_${STATE.currentPage}쪽`; },

  async save() {
    if (!this.data) return;
    const f = this.fmt();
    showLoading("내보내는 중…");
    try {
      if (f === "png") { const blob = await this.renderPNG(); downloadBytes(new Uint8Array(await blob.arrayBuffer()), this.baseName() + ".png", "image/png"); }
      else if (f === "txt") {
        const t = $("exportText").value;
        if (!t.trim()) { showToast("내보낼 글자가 없어요."); return; }
        downloadBytes(new TextEncoder().encode("\uFEFF" + t), this.baseName() + ".txt", "text/plain;charset=utf-8");
      } else {
        let src = STATE.fileBytes;
        const edited = ANNOTATE.hasAny() || Object.keys(STATE.pageRotations).some((k) => STATE.pageRotations[k]);
        try {
          if (edited) src = await buildAnnotatedPDF(PDFLib, STATE.fileBytes, ANNOTATE.byPage, STATE.pageRotations, {});
          downloadBytes(await buildCroppedPDF(PDFLib, src, this.data.view.page - 1, this.data.pdfRect), this.baseName() + ".pdf", "application/pdf");
        } catch (e) { showToast("암호·권한 제한이 걸린 PDF는 PDF로 잘라낼 수 없어요. 이미지나 글자로 내보내 주세요."); return; }
      }
      showToast("내보냈어요."); closeModal("exportWin");
    } catch (e) { console.error(e); showToast("내보내는 중 문제가 발생했어요."); }
    finally { hideLoading(); }
  },

  async copy() {
    if (!this.data) return;
    const f = this.fmt();
    try {
      if (f === "png") { const blob = await this.renderPNG(); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); showToast("이미지를 복사했어요."); }
      else if (f === "txt") { await navigator.clipboard.writeText($("exportText").value); showToast("글자를 복사했어요."); }
      else showToast("PDF는 복사할 수 없어요. '저장'을 눌러 주세요.");
    } catch (e) { showToast("복사하지 못했어요. 이 브라우저에서는 '저장'을 써 주세요."); }
  },
};
