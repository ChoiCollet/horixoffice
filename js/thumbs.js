/* =========================================================
   thumbs.js — 좌측 페이지 썸네일 패널
   ========================================================= */

const THUMBS = {
  els: [],

  async build() {
    const wrap = $("thumbs");
    wrap.innerHTML = "";
    this.els = [];
    $("thumbCount").textContent = STATE.numPages;

    for (let i = 1; i <= STATE.numPages; i++) {
      const div = document.createElement("div");
      div.className = "thumb";
      div.dataset.page = i;

      const canvas = document.createElement("canvas");
      div.appendChild(canvas);

      const num = document.createElement("div");
      num.className = "num";
      num.textContent = i;
      div.appendChild(num);

      div.addEventListener("click", () => { goToPage(i); if (isMobile()) setLeftPanel(false); });
      wrap.appendChild(div);
      this.els.push(div);

      // 렌더는 비동기로 순차 처리 (너무 많은 페이지에서도 버벅이지 않도록)
      this._renderOne(i, canvas);
    }
  },

  async _renderOne(pageNum, canvas) {
    try {
      const page = await STATE.pdfDoc.getPage(pageNum);
      const rotation = getPageRotation(pageNum);
      const base = page.getViewport({ scale: 1, rotation });
      const scale = 150 / base.width;
      const viewport = page.getViewport({ scale, rotation });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    } catch (e) { /* 무시 — 썸네일 실패해도 본문 보기는 정상 동작 */ }
  },

  rerenderOne(pageNum) {
    const el = this.els[pageNum - 1];
    const canvas = el && el.querySelector("canvas");
    if (canvas) this._renderOne(pageNum, canvas);
  },

  setActive(pageNum) {
    this.els.forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.page) === pageNum);
    });
    const active = this.els[pageNum - 1];
    if (active) active.scrollIntoView({ block: "nearest" });
  },
};
