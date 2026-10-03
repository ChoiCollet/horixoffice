/* =========================================================
   viewmode.js — 한 쪽씩 보기 / 연속 보기 전환
   연속 보기는 보기 전용이에요: 주석 그리기와 화면 캡처는
   한 쪽씩 보기로 돌아가야 쓸 수 있어요 (각 도구가 단일 캔버스를 전제로 만들어져 있어서).
   ========================================================= */

const CONTVIEW = {
  observer: null,
  pageEls: [],

  async renderAll() {
    if (!STATE.pdfDoc) return;
    const wrap = $("continuousWrap");
    wrap.innerHTML = "";
    this.pageEls = [];
    if (this.observer) this.observer.disconnect();

    const availW = $("viewer").clientWidth - 48;
    for (let p = 1; p <= STATE.numPages; p++) {
      const page = await STATE.pdfDoc.getPage(p);
      const rotation = getPageRotation(p);
      let scale = STATE.scale;
      if (STATE.fitMode === "width" || STATE.fitMode === "page") {
        const base = page.getViewport({ scale: 1, rotation });
        scale = availW / base.width;
      }
      const vp = page.getViewport({ scale, rotation });

      const div = document.createElement("div");
      div.className = "contPage";
      div.dataset.page = p;
      div.style.width = vp.width + "px";
      div.style.height = vp.height + "px";
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      div.appendChild(canvas);
      wrap.appendChild(div);
      this.pageEls.push(div);

      page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.catch(() => {});
    }

    this.observer = new IntersectionObserver((entries) => {
      let best = null;
      entries.forEach((e) => { if (e.isIntersecting && (!best || e.intersectionRatio > best.intersectionRatio)) best = e; });
      if (best) {
        const p = Number(best.target.dataset.page);
        STATE.currentPage = p;
        $("pageInput").value = p;
        $("statusPage").textContent = `페이지 ${p} / ${STATE.numPages}`;
        THUMBS.setActive(p);
      }
    }, { root: $("viewer"), threshold: [0.5] });
    this.pageEls.forEach((el) => this.observer.observe(el));
  },

  scrollToPage(p) {
    const el = this.pageEls[p - 1];
    if (el) el.scrollIntoView({ block: "start" });
  },

  destroy() {
    if (this.observer) this.observer.disconnect();
    $("continuousWrap").innerHTML = "";
    this.pageEls = [];
  },
};
