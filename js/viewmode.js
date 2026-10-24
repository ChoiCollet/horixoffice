/* =========================================================
   viewmode.js — 쪽 보기: 한 쪽 / 연속 / 두 쪽 / 두 쪽 연속
   - 한 쪽 보기는 core.js의 #pageWrap 하나로 그려요.
   - 나머지는 여기서 쪽마다 자리(틀)를 먼저 만들고, 화면 근처에 온 쪽만 그려요.
     (수십~수백 쪽짜리 문서도 메모리를 아끼고, 휴대폰에서도 하얗게 비지 않게)
   - 쪽마다 주석 층·글자 층·캡처 층이 따로 있어서 주석과 캡처가 그대로 돼요.
   ========================================================= */

function isMultiView() { return STATE.viewMode !== "single"; }
function isSpreadView() { return STATE.viewMode === "two" || STATE.viewMode === "twoCont"; }

const CONTVIEW = {
  lazy: null, watch: null,
  pageEls: [], views: [],
  token: 0,
  sizes: null, // { doc, list[쪽] = { w, h } } — 회전 0일 때의 쪽 크기(점)

  async baseSizes() {
    if (this.sizes && this.sizes.doc === STATE.pdfDoc) return this.sizes.list;
    const doc = STATE.pdfDoc, list = [];
    const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
    pages.forEach((pg, i) => { const v = pg.getViewport({ scale: 1 }); list[i + 1] = { w: v.width, h: v.height }; });
    this.sizes = { doc, list };
    return list;
  },

  // 화면에 놓을 쪽 번호들
  pagesShown() {
    const n = STATE.numPages;
    if (STATE.viewMode === "two") {
      const a = STATE.currentPage % 2 ? STATE.currentPage : STATE.currentPage - 1;
      return [a, a + 1].filter((p) => p >= 1 && p <= n);
    }
    return Array.from({ length: n }, (_, i) => i + 1);
  },

  async renderAll() {
    if (!STATE.pdfDoc) return;
    const token = ++this.token;
    const list = await this.baseSizes();
    if (token !== this.token || !STATE.pdfDoc) return;
    this._teardown();
    const wrap = $("continuousWrap"), viewer = $("viewer");
    const spread = isSpreadView();
    wrap.classList.toggle("spread", spread);
    wrap.classList.toggle("single-spread", STATE.viewMode === "two");
    const pad = viewer.clientWidth < 500 ? 16 : 48, gap = spread ? 12 : 0, cols = spread ? 2 : 1;
    const availW = Math.max(80, (viewer.clientWidth - pad - gap * (cols - 1)) / cols);
    const availH = Math.max(80, viewer.clientHeight - pad);

    for (const p of this.pagesShown()) {
      const b = list[p], turned = getPageRotation(p) % 180 !== 0;
      const w0 = turned ? b.h : b.w, h0 = turned ? b.w : b.h;
      let scale = STATE.scale;
      if (STATE.fitMode === "width") scale = availW / w0;
      else if (STATE.fitMode === "page") scale = Math.min(availW / w0, availH / h0);
      scale = Math.max(0.1, scale);
      const div = document.createElement("div");
      div.className = "contPage"; div.dataset.page = p;
      div.style.width = Math.floor(w0 * scale) + "px"; div.style.height = Math.floor(h0 * scale) + "px";
      const num = document.createElement("div"); num.className = "contNum"; num.textContent = p;
      div.appendChild(num);
      wrap.appendChild(div);
      const view = { page: p, scale, el: div, vp: null, canvas: null, pdfCanvas: null, gen: 0, rendered: false };
      ANNOTATE.bindContainer(div, () => view);
      this.pageEls.push(div); this.views.push(view);
    }
    if (STATE.fitMode !== "custom" && this.views.length) STATE.scale = this.views[0].scale;
    updateZoomUi();

    // 화면 근처(위아래로 한두 화면)에 들어온 쪽만 그리고, 멀어지면 비워요
    this.lazy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const v = this.views[this.pageEls.indexOf(e.target)];
        if (!v) return;
        if (e.isIntersecting) this.renderPage(v, token); else this.release(v);
      });
    }, { root: viewer, rootMargin: isMobile() ? "60% 0px" : "100% 0px" });
    // 지금 보고 있는 쪽 번호 (가장 많이 보이는 쪽)
    const ratios = new Map();
    this.watch = new IntersectionObserver((entries) => {
      entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
      let best = null, br = 0;
      ratios.forEach((r, el) => { if (r > br) { br = r; best = el; } });
      if (best && STATE.viewMode !== "two") {
        const p = Number(best.dataset.page);
        if (p !== STATE.currentPage) { STATE.currentPage = p; updatePageUi(); }
      }
    }, { root: viewer, threshold: [0, 0.25, 0.5, 0.75, 1] });
    this.pageEls.forEach((el) => { this.lazy.observe(el); this.watch.observe(el); });
    updatePageUi();
  },

  async renderPage(view, token) {
    if (view.rendered || view.busy) return;
    view.busy = true;
    const gen = ++view.gen;
    try {
      const page = await STATE.pdfDoc.getPage(view.page);
      if (token !== this.token || gen !== view.gen) return;
      const vp = page.getViewport({ scale: view.scale, rotation: getPageRotation(view.page) });
      const k = canvasDpr(vp.width, vp.height, isMobile() ? 3e6 : 7e6);
      const div = view.el;
      const pdfC = document.createElement("canvas"); pdfC.className = "pdfC";
      sizeCanvasTo(pdfC, vp.width, vp.height, k);
      const annoC = document.createElement("canvas"); annoC.className = "annoC";
      sizeCanvasTo(annoC, vp.width, vp.height, k);
      const textL = document.createElement("div"); textL.className = "textL";
      const capC = document.createElement("canvas"); capC.className = "capC";
      sizeCanvasTo(capC, vp.width, vp.height, k);
      div.prepend(pdfC, annoC, textL, capC);
      view.vp = vp; view.canvas = annoC; view.pdfCanvas = pdfC; view.textL = textL;
      CAPTURE.bind(capC, pdfC, annoC, () => view);
      ANNOTATE.redrawView(view);
      const ctx = pdfC.getContext("2d");
      ctx.setTransform(k, 0, 0, k, 0, 0);
      view.task = page.render({ canvasContext: ctx, viewport: vp });
      view.rendered = true;
      await view.task.promise;
      if (token === this.token && gen === view.gen) {
        TEXTLAYER.render(page, vp, textL);
        if (typeof FINDHL !== "undefined" && FINDHL.query) FINDHL.paint();
      }
    } catch (e) {
      /* 그리는 도중 취소(멀어짐·확대 변경)되면 여기로 와요 */
    } finally { view.busy = false; }
  },

  release(view) {
    view.gen++;
    if (view.task) { try { view.task.cancel(); } catch (e) { /* 무시 */ } view.task = null; }
    if (!view.rendered && !view.busy) return;
    view.el.querySelectorAll("canvas,.textL").forEach((c) => { if (c.tagName === "CANVAS") { c.width = 0; c.height = 0; } c.remove(); });
    view.rendered = false; view.canvas = null; view.pdfCanvas = null; view.textL = null;
    // vp는 남겨 둬요: 쪽 좌표 계산(찾기 표시 등)에 쓰여요
  },

  _teardown() {
    if (this.lazy) this.lazy.disconnect();
    if (this.watch) this.watch.disconnect();
    this.lazy = this.watch = null;
    this.views.forEach((v) => this.release(v));
    $("continuousWrap").innerHTML = "";
    this.pageEls = []; this.views = [];
  },

  viewOf(p) { return this.views.find((v) => v.page === p) || null; },

  scrollToPage(p) {
    if (STATE.viewMode === "two") return;
    const el = this.pageEls.find((e) => Number(e.dataset.page) === p);
    if (el) $("viewer").scrollTop = el.offsetTop - 8;
  },

  destroy() {
    this.token++;
    this._teardown();
    $("continuousWrap").classList.remove("spread", "single-spread");
  },
};
