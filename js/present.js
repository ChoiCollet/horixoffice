/* =========================================================
   present.js — 프레젠테이션 모드 (전체화면 슬라이드쇼)
   ========================================================= */

const PRESENT = {
  page: 1,
  open(fromPage) {
    if (!STATE.pdfDoc) return;
    this.page = fromPage || 1;
    $("presentOverlay").classList.add("open");
    this.render(false);
    document.addEventListener("keydown", this._onKey);
  },
  close() {
    $("presentOverlay").classList.remove("open");
    document.removeEventListener("keydown", this._onKey);
  },
  _onKey: (e) => {
    if (e.key === "Escape") PRESENT.close();
    else if (e.key === "ArrowRight" || e.key === " ") PRESENT.next();
    else if (e.key === "ArrowLeft") PRESENT.prev();
  },
  next() { if (this.page < STATE.numPages) { this.page++; this.render(true); } },
  prev() { if (this.page > 1) { this.page--; this.render(true, true); } },

  async render(animate, reverse) {
    const page = await STATE.pdfDoc.getPage(this.page);
    const canvas = $("presentCanvas");
    const trans = $("transitionSelect").value;

    const vw = window.innerWidth, vh = window.innerHeight;
    const rotation = getPageRotation(this.page);
    const base = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(vw / base.width, vh / base.height) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale, rotation });

    const draw = async () => {
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = (vp.width / (window.devicePixelRatio || 1)) + "px";
      canvas.style.height = (vp.height / (window.devicePixelRatio || 1)) + "px";
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    };

    canvas.className = "";
    if (!animate || trans === "none") { await draw(); return; }

    if (trans === "fade") {
      canvas.className = "trans-fade";
      canvas.style.opacity = 0;
      await draw();
      requestAnimationFrame(() => { canvas.style.opacity = 1; });
    } else if (trans === "slide") {
      canvas.className = "trans-slide";
      canvas.style.transform = `translateX(${reverse ? "-40px" : "40px"})`;
      canvas.style.opacity = 0.2;
      await draw();
      requestAnimationFrame(() => {
        canvas.style.transform = "translateX(0)";
        canvas.style.opacity = 1;
      });
    }
  },
};

$("presentCanvasWrap").addEventListener("click", () => PRESENT.next());
