/* =========================================================
   capture.js — 화면 캡처 (쪽 위에서 영역을 드래그해 이미지로 저장)
   한 쪽씩 보기·연속 보기 모두에서 쓸 수 있어요.
   ========================================================= */

const CAPTURE = {
  active: false,
  mode: "capture", // 'capture'(바로 이미지) | 'export'(내보내기 창)
  rect: null,

  sizeCanvas(c, w, h) { sizeCanvasTo(c, w, h, canvasDpr(w, h)); },

  onPageRendered(w, h) { this.sizeCanvas($("captureCanvas"), w, h); },

  toggle() {
    this.active = !this.active;
    $("viewer").classList.toggle("capturing", this.active);
    const key = this.mode === "export" ? "exportRegion" : "capture";
    document.querySelectorAll(`[data-a="${key}"]`).forEach((b) => b.classList.toggle("on", this.active));
    if (!this.active) { document.querySelectorAll('[data-a="capture"],[data-a="exportRegion"]').forEach((b) => b.classList.remove("on")); this.mode = "capture"; }
    else if (this.mode === "capture") showToast("캡처할 영역을 드래그하세요.");
  },

  // 캡처 층(c)에 드래그 동작을 연결 — 아래에 있는 pdf 캔버스와 주석 캔버스를 잘라서 이미지로 만들어요
  bind(c, pdfC, annoC, getView) {
    let start = null, dragging = false, rect = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      dragging = true; rect = null; start = pos(e);
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const cur = pos(e), ctx = c.getContext("2d"), dpr = canvasK(c);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(47,111,237,.15)"; ctx.strokeStyle = "#2f6fed"; ctx.lineWidth = 1.5;
      const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
      const w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
      rect = { x, y, w, h };
    });
    c.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
      const mode = this.mode, view = getView ? getView() : null;
      this.toggle();
      if (rect && rect.w > 4 && rect.h > 4) {
        if (mode === "export" && view) REGION.open(rect, pdfC, annoC, view); else this.finish(rect, pdfC, annoC);
      }
    });
  },

  finish(rect, pdfC, annoC) {
    const dpr = canvasK(pdfC);
    const merged = document.createElement("canvas");
    merged.width = Math.round(rect.w * dpr); merged.height = Math.round(rect.h * dpr);
    const ctx = merged.getContext("2d"), sx = rect.x * dpr, sy = rect.y * dpr, sw = rect.w * dpr, sh = rect.h * dpr;
    ctx.drawImage(pdfC, sx, sy, sw, sh, 0, 0, sw, sh);
    if (ANNOTATE.visible) ctx.drawImage(annoC, sx, sy, sw, sh, 0, 0, sw, sh);
    const url = merged.toDataURL("image/png");
    $("captureResultImg").src = url;
    $("captureDownload").href = url;
    $("captureDownload").download = replaceExt(STATE.fileName, `_캡처_p${STATE.currentPage}.png`);
    openModal("captureOverlay");
  },

  initPointerEvents() { this.bind($("captureCanvas"), $("pdfCanvas"), $("annoCanvas"), () => ({ page: STATE.currentPage, vp: STATE.pageViewport })); },
};
