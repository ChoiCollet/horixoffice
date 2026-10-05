/* =========================================================
   viewmode.js — 한 쪽씩 보기 / 연속 보기
   연속 보기에서도 쪽마다 주석 층·글자 층·캡처 층이 따로 있어서 주석과 캡처가 그대로 돼요.
   ========================================================= */

const CONTVIEW = {
  observer: null,
  pageEls: [],
  views: [],
  token: 0,

  async renderAll() {
    if (!STATE.pdfDoc) return;
    const token = ++this.token;
    const wrap = $("continuousWrap");
    wrap.innerHTML = "";
    this.pageEls = []; this.views = [];
    if (this.observer) this.observer.disconnect();

    const availW = $("viewer").clientWidth - ($("viewer").clientWidth < 500 ? 16 : 48);
    const dpr = window.devicePixelRatio || 1;
    for (let p = 1; p <= STATE.numPages; p++) {
      const page = await STATE.pdfDoc.getPage(p);
      if (token !== this.token) return;
      const rotation = getPageRotation(p);
      let scale = STATE.scale;
      if (STATE.fitMode === "width" || STATE.fitMode === "page") {
        scale = availW / page.getViewport({ scale: 1, rotation }).width;
      }
      const vp = page.getViewport({ scale, rotation });

      const div = document.createElement("div");
      div.className = "contPage"; div.dataset.page = p;
      div.style.width = vp.width + "px"; div.style.height = vp.height + "px";
      const pdfC = document.createElement("canvas"); pdfC.className = "pdfC";
      pdfC.width = Math.floor(vp.width * dpr); pdfC.height = Math.floor(vp.height * dpr);
      pdfC.style.width = vp.width + "px"; pdfC.style.height = vp.height + "px";
      const annoC = document.createElement("canvas"); annoC.className = "annoC";
      ANNOTATE.sizeCanvas(annoC, vp.width, vp.height);
      const textL = document.createElement("div"); textL.className = "textL";
      const capC = document.createElement("canvas"); capC.className = "capC";
      CAPTURE.sizeCanvas(capC, vp.width, vp.height);
      div.append(pdfC, annoC, textL, capC);
      wrap.appendChild(div);
      this.pageEls.push(div);

      const view = { page: p, vp, canvas: annoC, el: div, pdfCanvas: pdfC };
      this.views.push(view);
      ANNOTATE.bindContainer(div, () => view);
      CAPTURE.bind(capC, pdfC, annoC);

      const ctx = pdfC.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      page.render({ canvasContext: ctx, viewport: vp }).promise
        .then(() => { if (token === this.token) TEXTLAYER.render(page, vp, textL); }).catch(() => {});
      ANNOTATE.redrawView(view);
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
    this.token++;
    if (this.observer) this.observer.disconnect();
    $("continuousWrap").innerHTML = "";
    this.pageEls = []; this.views = [];
  },
};
