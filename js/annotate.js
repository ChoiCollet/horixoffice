/* =========================================================
   annotate.js — 주석 도구 (선/화살표/도형/자유형/강조/밑줄/취소선/스티커노트)
   각 페이지마다 도형을 PDF 좌표계로 저장해 두었다가,
   내보낼 때 페이지를 이미지로 렌더링한 뒤 그 위에 그려서 새 PDF로 합칩니다.
   ========================================================= */

const ANNOTATE = {
  tool: "select",
  color: "#e2231a",
  width: 4,
  byPage: {},      // { pageNum: [shape, ...] }
  visible: true,
  drawing: false,
  cur: null,       // 현재 그리고 있는 도형
  history: [],      // undo 스택: {page, index}

  reset(numPages) {
    this.byPage = {};
    for (let i = 1; i <= numPages; i++) this.byPage[i] = [];
    this.history = [];
  },

  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll(".atool").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === tool));
    $("annoCanvas").style.pointerEvents = (tool === "select") ? "none" : "auto";
  },

  onPageRendered(w, h) {
    const c = $("annoCanvas");
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  },

  redraw() {
    const c = $("annoCanvas");
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.visible) {
      const shapes = this.byPage[STATE.currentPage] || [];
      shapes.forEach((s) => this.drawShape(ctx, s, STATE.pageViewport));
      if (this.cur) this.drawShape(ctx, this.cur, STATE.pageViewport);
    }
    ctx.restore();
  },

  toViewport(pt, vp) { return vp.convertToViewportPoint(pt[0], pt[1]); },

  drawShape(ctx, s, vp) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.globalAlpha = 1;

    if (s.type === "line" || s.type === "arrow" || s.type === "underline" || s.type === "strike") {
      const [x1, y1] = this.toViewport(s.p1, vp);
      const [x2, y2] = this.toViewport(s.p2, vp);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (s.type === "arrow") {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const len = 10 + s.width;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(ang - Math.PI / 7), y2 - len * Math.sin(ang - Math.PI / 7));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 7), y2 - len * Math.sin(ang + Math.PI / 7));
        ctx.stroke();
      }
    } else if (s.type === "rect") {
      const [x1, y1] = this.toViewport(s.p1, vp);
      const [x2, y2] = this.toViewport(s.p2, vp);
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === "ellipse") {
      const [x1, y1] = this.toViewport(s.p1, vp);
      const [x2, y2] = this.toViewport(s.p2, vp);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (s.type === "free") {
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const [x, y] = this.toViewport(p, vp);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (s.type === "highlight") {
      const [x1, y1] = this.toViewport(s.p1, vp);
      const [x2, y2] = this.toViewport(s.p2, vp);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.globalAlpha = 1;
    } else if (s.type === "note") {
      const [x, y] = this.toViewport(s.p1, vp);
      ctx.fillStyle = "#f2c200";
      ctx.strokeStyle = "#8a6d00";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 9, y - 9, 18, 18, 3) : ctx.rect(x - 9, y - 9, 18, 18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#5c4600";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("!", x, y + 1);
    }
  },

  addShape(s) {
    this.byPage[STATE.currentPage].push(s);
    this.history.push({ page: STATE.currentPage, index: this.byPage[STATE.currentPage].length - 1 });
    this.redraw();
  },

  undo() {
    const last = this.history.pop();
    if (!last) { showToast("되돌릴 주석이 없어요."); return; }
    const arr = this.byPage[last.page];
    if (arr && arr.length) arr.splice(arr.length - 1, 1);
    if (last.page === STATE.currentPage) this.redraw();
  },

  clearPage() {
    this.byPage[STATE.currentPage] = [];
    this.history = this.history.filter((h) => h.page !== STATE.currentPage);
    this.redraw();
  },

  hasAny() { return Object.values(this.byPage).some((a) => a.length); },

  /* ---------- 포인터 입력 ---------- */

  initPointerEvents() {
    const c = $("annoCanvas");
    let notePendingPoint = null;

    const getPdfPoint = (evt) => {
      const rect = c.getBoundingClientRect();
      const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
      return STATE.pageViewport.convertToPdfPoint(x, y);
    };

    c.addEventListener("pointerdown", (e) => {
      if (this.tool === "select" || !STATE.pdfDoc) return;
      const pt = getPdfPoint(e);

      if (this.tool === "note") {
        notePendingPoint = pt;
        $("noteText").value = "";
        openModal("noteOverlay");
        return;
      }

      this.drawing = true;
      c.setPointerCapture(e.pointerId);
      const base = { color: this.color, width: this.width };
      if (this.tool === "free") this.cur = { type: "free", ...base, points: [pt] };
      else this.cur = { type: this.tool, ...base, p1: pt, p2: pt };
    });

    c.addEventListener("pointermove", (e) => {
      if (!this.drawing || !this.cur) return;
      const pt = getPdfPoint(e);
      if (this.cur.type === "free") this.cur.points.push(pt);
      else this.cur.p2 = pt;
      this.redraw();
    });

    const finish = () => {
      if (!this.drawing || !this.cur) return;
      this.drawing = false;
      const s = this.cur; this.cur = null;
      if (s.type !== "free" && Math.hypot(
        this.toViewport(s.p2, STATE.pageViewport)[0] - this.toViewport(s.p1, STATE.pageViewport)[0],
        this.toViewport(s.p2, STATE.pageViewport)[1] - this.toViewport(s.p1, STATE.pageViewport)[1]) < 3) {
        this.redraw(); return; // 너무 작으면 무시
      }
      this.addShape(s);
    };
    c.addEventListener("pointerup", finish);
    c.addEventListener("pointercancel", finish);

    $("noteConfirm").addEventListener("click", () => {
      const text = $("noteText").value.trim();
      if (notePendingPoint) {
        this.addShape({ type: "note", color: "#f2c200", width: 1, p1: notePendingPoint, text: text || "(내용 없음)" });
      }
      notePendingPoint = null;
      closeModal("noteOverlay");
    });

    // 스티커 노트 클릭 시 내용 미리보기 (선택 도구일 때)
    c.addEventListener("click", (e) => {
      if (this.tool !== "select" || !STATE.pageViewport) return;
    });
  },

  /* ---------- 주석 포함 PDF 내보내기 ---------- */

  async exportPDF() {
    if (!STATE.pdfDoc) return;
    if (!this.hasAny()) { showToast("추가된 주석이 없어요."); return; }
    showLoading("주석을 반영한 PDF를 만드는 중…");
    try {
      const outDoc = await PDFLib.PDFDocument.create();
      for (let i = 1; i <= STATE.numPages; i++) {
        const page = await STATE.pdfDoc.getPage(i);
        const scale = 2;
        const vp = page.getViewport({ scale, rotation: STATE.rotation });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        (this.byPage[i] || []).forEach((s) => this.drawShape(ctx, s, vp));

        const pngBytes = await new Promise((res) =>
          canvas.toBlob((b) => b.arrayBuffer().then(res), "image/png"));
        const png = await outDoc.embedPng(pngBytes);
        const base = page.getViewport({ scale: 1, rotation: STATE.rotation });
        const outPage = outDoc.addPage([base.width, base.height]);
        outPage.drawImage(png, { x: 0, y: 0, width: base.width, height: base.height });
      }
      const bytes = await outDoc.save();
      downloadBytes(bytes, replaceExt(STATE.fileName, "_주석.pdf"), "application/pdf");
      showToast("주석을 반영한 PDF를 저장했어요.");
    } catch (err) {
      console.error(err);
      showToast("내보내기 중 문제가 발생했어요.");
    } finally {
      hideLoading();
    }
  },
};
