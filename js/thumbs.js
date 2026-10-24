/* =========================================================
   thumbs.js — 좌측 페이지 썸네일 패널
   쪽이 많아도 버벅이지 않게, 패널에서 보이는 썸네일만 그려요.
   ========================================================= */

const THUMBS = {
  els: [],
  observer: null,
  token: 0,

  async build() {
    const wrap = $("thumbs"), token = ++this.token;
    wrap.innerHTML = "";
    this.els = [];
    if (this.observer) this.observer.disconnect();
    $("thumbCount").textContent = STATE.numPages;
    let sizes = null;
    try { sizes = await CONTVIEW.baseSizes(); } catch (e) { /* 크기를 몰라도 그릴 땐 알게 돼요 */ }
    if (token !== this.token) return;

    for (let i = 1; i <= STATE.numPages; i++) {
      const div = document.createElement("div");
      div.className = "thumb";
      div.dataset.page = i;
      const canvas = document.createElement("canvas");
      // 그리기 전에도 자리를 잡아 두어야 스크롤 위치가 흔들리지 않아요
      if (sizes && sizes[i]) {
        const turned = getPageRotation(i) % 180 !== 0, w = turned ? sizes[i].h : sizes[i].w, h = turned ? sizes[i].w : sizes[i].h;
        canvas.style.aspectRatio = `${w} / ${h}`;
      }
      div.appendChild(canvas);
      const num = document.createElement("div");
      num.className = "num";
      num.textContent = i;
      div.appendChild(num);
      div.addEventListener("click", () => { goToPage(i); if (isMobile()) setLeftPanel(false); });
      wrap.appendChild(div);
      this.els.push(div);
    }
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const div = e.target;
        if (div.dataset.drawn) return;
        div.dataset.drawn = "1";
        this._renderOne(Number(div.dataset.page), div.querySelector("canvas"), token);
      });
    }, { root: $("leftPanel"), rootMargin: "300px 0px" });
    this.els.forEach((el) => this.observer.observe(el));
    this.setActive(STATE.currentPage);
  },

  async _renderOne(pageNum, canvas, token) {
    try {
      const page = await STATE.pdfDoc.getPage(pageNum);
      if (token !== undefined && token !== this.token) return;
      const rotation = getPageRotation(pageNum);
      const base = page.getViewport({ scale: 1, rotation });
      const k = Math.min(2, window.devicePixelRatio || 1);
      const scale = (150 * k) / base.width;
      const viewport = page.getViewport({ scale, rotation });
      const off = document.createElement("canvas");
      off.width = Math.round(viewport.width); off.height = Math.round(viewport.height);
      await page.render({ canvasContext: off.getContext("2d"), viewport }).promise;
      // 썸네일에도 주석이 보이게 (한PDF처럼)
      if (typeof ANNOTATE !== "undefined" && ANNOTATE.visible) (ANNOTATE.byPage[pageNum] || []).forEach((s) => ANNOTATE.drawShape(off.getContext("2d"), s, viewport));
      canvas.width = off.width; canvas.height = off.height;
      canvas.style.aspectRatio = `${off.width} / ${off.height}`;
      canvas.getContext("2d").drawImage(off, 0, 0);
    } catch (e) { /* 무시 — 썸네일 실패해도 본문 보기는 정상 동작 */ }
  },

  rerenderOne(pageNum) {
    const el = this.els[pageNum - 1];
    const canvas = el && el.querySelector("canvas");
    if (canvas) { el.dataset.drawn = "1"; this._renderOne(pageNum, canvas); }
  },

  // 주석이 바뀐 쪽의 썸네일만 잠시 뒤에 다시 그려요
  refreshLater(pageNum) {
    clearTimeout(this._tm && this._tm[pageNum]);
    this._tm = this._tm || {};
    this._tm[pageNum] = setTimeout(() => this.rerenderOne(pageNum), 400);
  },

  setActive(pageNum) {
    this.els.forEach((el) => el.classList.toggle("active", Number(el.dataset.page) === pageNum));
    const active = this.els[pageNum - 1], panel = $("leftPanel");
    if (!active || !leftPanelShown()) return;
    // 패널 안에서만 스크롤 (scrollIntoView는 휴대폰에서 화면 전체를 움직일 수 있어요)
    const pr = panel.getBoundingClientRect(), ar = active.getBoundingClientRect();
    if (ar.top < pr.top + 30) panel.scrollTop += ar.top - pr.top - 30;
    else if (ar.bottom > pr.bottom - 6) panel.scrollTop += ar.bottom - pr.bottom + 10;
  },
};
