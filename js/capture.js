/* =========================================================
   capture.js — 화면 캡처 (현재 쪽에서 영역을 드래그해 이미지로 저장)
   ========================================================= */

const CAPTURE = {
  active: false,
  dragging: false,
  start: null,

  onPageRendered(w, h) {
    const c = $("captureCanvas");
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
  },

  toggle() {
    this.active = !this.active;
    const c = $("captureCanvas");
    c.style.display = this.active ? "block" : "none";
    $("t_capture").classList.toggle("active", this.active);
    if (this.active) showToast("캡처할 영역을 마우스로 드래그하세요.");
  },

  initPointerEvents() {
    const c = $("captureCanvas");
    c.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      this.dragging = true;
      const rect = c.getBoundingClientRect();
      this.start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const rect = c.getBoundingClientRect();
      const cur = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const ctx = c.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(47,111,237,.15)";
      ctx.strokeStyle = "#2f6fed";
      ctx.lineWidth = 1.5;
      const x = Math.min(this.start.x, cur.x), y = Math.min(this.start.y, cur.y);
      const w = Math.abs(cur.x - this.start.x), h = Math.abs(cur.y - this.start.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      this._rect = { x, y, w, h };
    });
    c.addEventListener("pointerup", () => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this._rect && this._rect.w > 4 && this._rect.h > 4) this.finish(this._rect);
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      this.toggle();
    });
  },

  finish(rect) {
    const dpr = window.devicePixelRatio || 1;
    const merged = document.createElement("canvas");
    merged.width = rect.w * dpr; merged.height = rect.h * dpr;
    const ctx = merged.getContext("2d");
    ctx.drawImage($("pdfCanvas"), rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr, 0, 0, rect.w * dpr, rect.h * dpr);
    if (ANNOTATE.visible) {
      ctx.drawImage($("annoCanvas"), rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr, 0, 0, rect.w * dpr, rect.h * dpr);
    }
    const url = merged.toDataURL("image/png");
    $("captureResultImg").src = url;
    $("captureDownload").href = url;
    $("captureDownload").download = replaceExt(STATE.fileName, `_캡처_p${STATE.currentPage}.png`);
    openModal("captureOverlay");
  },
};
