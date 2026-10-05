/* =========================================================
   annotate.js — 주석 도구
   - 도형은 PDF 좌표계(점 단위)로 저장돼서 확대/축소·회전해도 제자리에 있어요.
   - 저장할 땐 원본 PDF 위에 벡터로 그려 넣어요 (글자는 그대로 선택·검색 가능, 용량도 거의 안 늘어요).
   - 되돌리기/다시 실행은 "작업 기록"으로 관리해서 추가·삭제·이동·속성 변경을 모두 되돌릴 수 있어요.
   ========================================================= */

/* ---------- 순수 함수들 (테스트 가능) ---------- */

// pdf.js textContent → 가로 글줄 상자 목록 (기울어진 글자는 건너뜀)
function textItemsFromContent(content) {
  const out = [];
  for (const it of content.items || []) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const t = it.transform;
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
    const h = Math.abs(it.height || t[3]);
    if (!(h > 0) || !(it.width > 0)) continue;
    out.push({ x: t[4], base: t[5], w: it.width, h });
  }
  return out;
}

// 드래그 영역과 겹치는 글자들을 줄 단위로 묶어서 [{x0,x1,base,h}] 로
function textLinesInSelection(items, p1, p2) {
  const x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]);
  const y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
  const hits = items.filter((it) =>
    it.x < x1 && it.x + it.w > x0 && it.base - it.h * 0.2 < y1 && it.base + it.h * 0.85 > y0);
  hits.sort((a, b) => (b.base - a.base) || (a.x - b.x));
  const lines = [];
  for (const it of hits) {
    const ln = lines.find((l) => Math.abs(l.base - it.base) < Math.max(l.h, it.h) * 0.4);
    if (ln) { ln.x0 = Math.min(ln.x0, it.x); ln.x1 = Math.max(ln.x1, it.x + it.w); ln.h = Math.max(ln.h, it.h); }
    else lines.push({ x0: it.x, x1: it.x + it.w, base: it.base, h: it.h });
  }
  return lines;
}

function shapeTranslate(s, dx, dy) {
  ["p1", "p2"].forEach((k) => { if (s[k]) s[k] = [s[k][0] + dx, s[k][1] + dy]; });
  if (s.points) s.points = s.points.map((p) => [p[0] + dx, p[1] + dy]);
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// 저장용: 원본 PDF 위에 주석을 벡터로 그리고, 쪽 회전·스티커노트(실제 PDF 메모)까지 반영
async function buildAnnotatedPDF(PL, bytes, byPage, rotations, opts) {
  const { PDFDocument, rgb, degrees, LineCapStyle, PDFName, PDFHexString, PDFArray } = PL;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const col = (hex) => {
    const n = parseInt(String(hex || "#000000").slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const cap = LineCapStyle ? { lineCap: LineCapStyle.Round } : {};
  doc.getPages().forEach((page, i) => {
    const pn = i + 1;
    const extra = (rotations && rotations[pn]) || 0;
    if (extra) page.setRotation(degrees((((page.getRotation().angle || 0) + extra) % 360 + 360) % 360));
    for (const s of (byPage && byPage[pn]) || []) {
      const c = col(s.color), w = Math.max(0.5, s.width || 2);
      const seg = (a, b, t) => page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: t || w, color: c, ...cap });
      if (s.type === "line" || s.type === "underline" || s.type === "strike") seg(s.p1, s.p2);
      else if (s.type === "arrow") {
        seg(s.p1, s.p2);
        const ang = Math.atan2(s.p2[1] - s.p1[1], s.p2[0] - s.p1[0]), len = 8 + 2 * w;
        [-1, 1].forEach((d) => seg(s.p2, [s.p2[0] - len * Math.cos(ang + d * Math.PI / 7), s.p2[1] - len * Math.sin(ang + d * Math.PI / 7)]));
      } else if (s.type === "rect") {
        page.drawRectangle({ x: Math.min(s.p1[0], s.p2[0]), y: Math.min(s.p1[1], s.p2[1]),
          width: Math.abs(s.p2[0] - s.p1[0]), height: Math.abs(s.p2[1] - s.p1[1]), borderColor: c, borderWidth: w });
      } else if (s.type === "ellipse") {
        const rx = Math.abs(s.p2[0] - s.p1[0]) / 2, ry = Math.abs(s.p2[1] - s.p1[1]) / 2;
        if (rx > 0 && ry > 0) page.drawEllipse({ x: (s.p1[0] + s.p2[0]) / 2, y: (s.p1[1] + s.p2[1]) / 2, xScale: rx, yScale: ry, borderColor: c, borderWidth: w });
      } else if (s.type === "free") {
        const pts = s.points || [];
        if (pts.length === 1) page.drawCircle({ x: pts[0][0], y: pts[0][1], size: w / 2, color: c });
        for (let k = 1; k < pts.length; k++) seg(pts[k - 1], pts[k]);
      } else if (s.type === "highlight") {
        page.drawRectangle({ x: Math.min(s.p1[0], s.p2[0]), y: Math.min(s.p1[1], s.p2[1]),
          width: Math.abs(s.p2[0] - s.p1[0]), height: Math.abs(s.p2[1] - s.p1[1]), color: c, opacity: 0.35 });
      } else if (s.type === "note") {
        const [x, y] = s.p1, half = 8;
        page.drawRectangle({ x: x - half, y: y - half, width: half * 2, height: half * 2, color: rgb(1, 0.85, 0.2), borderColor: rgb(0.54, 0.43, 0), borderWidth: 1 });
        page.drawLine({ start: { x, y: y + 4 }, end: { x, y: y - 1 }, thickness: 1.6, color: rgb(0.36, 0.27, 0) });
        page.drawCircle({ x, y: y - 4.5, size: 0.9, color: rgb(0.36, 0.27, 0) });
        const ctx = doc.context;
        const ref = ctx.register(ctx.obj({
          Type: "Annot", Subtype: "Text", Rect: [x - half, y - half, x + half, y + half],
          Contents: PDFHexString.fromText(s.text || ""), Name: "Comment", C: [1, 0.85, 0.2], F: 4,
        }));
        let arr = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        if (!arr) { arr = ctx.obj([]); page.node.set(PDFName.of("Annots"), arr); }
        arr.push(ref);
      }
    }
  });
  if (opts && opts.embed) {
    // 다시 열었을 때 주석을 계속 편집할 수 있도록 원본과 주석 데이터를 함께 보관
    await doc.attach(opts.embed.original, "horixoffice-original.pdf", { mimeType: "application/pdf", description: "HorixOffice 편집 이어가기용 원본" });
    await doc.attach(new TextEncoder().encode(JSON.stringify(opts.embed.session)), "horixoffice-session.json", { mimeType: "application/json", description: "HorixOffice 주석 데이터" });
  }
  return doc.save();
}

// 저장된 파일에 HorixOffice 편집 데이터가 들어있는지 확인
async function detectHorixSession(doc) {
  let atts; try { atts = await doc.getAttachments(); } catch (e) { return null; }
  if (!atts || !atts["horixoffice-session.json"] || !atts["horixoffice-original.pdf"]) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(atts["horixoffice-session.json"].content));
    return { session, original: atts["horixoffice-original.pdf"].content };
  } catch (e) { return null; }
}

/* ---------- 주석 도구 본체 ---------- */

const ANNOTATE = {
  tool: "select",
  color: "#e2231a",
  width: 4,              // 점(pt) 단위 — 확대/축소에 따라 같이 커지고 작아져요
  pickedColor: false,    // 사용자가 직접 색을 골랐는지 (강조 기본색 처리용)
  byPage: {},
  visible: true,
  cur: null,
  selected: null,
  ops: [], redoStack: [],
  dirty: false,
  textCache: {},
  noteEditing: null,
  drag: null, av: null, curPage: null, startV: null, _blockSel: false,

  reset(numPages) {
    this.byPage = {};
    for (let i = 1; i <= numPages; i++) this.byPage[i] = [];
    this.ops = []; this.redoStack = []; this.dirty = false;
    this.selected = null; this.cur = null; this.textCache = {};
  },

  hasAny() { return Object.values(this.byPage).some((a) => a.length); },
  hasChanges() { return this.dirty; },
  markDirty() { this.dirty = true; },

  /* ----- 도구/색/두께 ----- */
  setTool(tool) {
    this.tool = tool;
    this.cur = null;
    if (tool !== "select") { this.selected = null; }
    if (!["select", "hand"].includes(tool) && !this.visible) this.setVisible(true);
    const v = $("viewer");
    v.dataset.tool = tool === "select" ? "select" : tool === "hand" ? "hand" : "draw";
    v.dataset.sel = this.selected ? "1" : "";
    this.syncToolUI();
    this.redraw();
  },

  syncToolUI() {
    document.querySelectorAll(".atool").forEach((b) => b.classList.toggle("on", b.dataset.tool === this.tool));
    document.querySelectorAll('[data-a="select"]').forEach((b) => b.classList.toggle("on", this.tool === "select"));
    document.querySelectorAll('[data-a="hand"]').forEach((b) => b.classList.toggle("on", this.tool === "hand"));
  },

  setVisible(v) {
    this.visible = v;
    document.querySelectorAll('[data-a="annoToggle"]').forEach((b) => b.classList.toggle("on", v));
    if (!v) this.selected = null;
    this.redraw();
  },

  colorFor(tool) { return tool === "highlight" && !this.pickedColor ? "#ffd400" : this.color; },

  setColor(c) {
    this.color = c; this.pickedColor = true;
    if (this.selected && this.selected.type !== "note") this.doOp({ k: "prop", shape: this.selected, before: { color: this.selected.color }, after: { color: c } });
  },
  setWidth(w) {
    this.width = w;
    const s = this.selected;
    if (s && !["note", "highlight"].includes(s.type)) this.doOp({ k: "prop", shape: s, before: { width: s.width }, after: { width: w } });
  },

  /* ----- 작업 기록 (되돌리기/다시 실행) ----- */
  _arr(p) { return this.byPage[p] || (this.byPage[p] = []); },
  _pageOf(shape) { for (const p of Object.keys(this.byPage)) if (this.byPage[p].includes(shape)) return Number(p); return null; },

  _apply(op, undo) {
    switch (op.k) {
      case "add":
        op.shapes.forEach((s) => {
          const a = this._arr(op.page);
          if (!undo) a.push(s); else { const i = a.indexOf(s); if (i >= 0) a.splice(i, 1); }
        });
        break;
      case "del":
        if (!undo) op.items.forEach((it) => { const a = this._arr(op.page), i = a.indexOf(it.shape); if (i >= 0) a.splice(i, 1); });
        else [...op.items].sort((a, b) => a.index - b.index).forEach((it) => this._arr(op.page).splice(it.index, 0, it.shape));
        break;
      case "move": shapeTranslate(op.shape, undo ? -op.dx : op.dx, undo ? -op.dy : op.dy); break;
      case "prop": Object.assign(op.shape, undo ? op.before : op.after); break;
      case "multi": (undo ? [...op.ops].reverse() : op.ops).forEach((o) => this._apply(o, undo)); break;
    }
  },

  doOp(op) {
    this._apply(op, false);
    this.ops.push(op); this.redoStack = []; this.dirty = true;
    if (this.selected && this._pageOf(this.selected) === null) this.selected = null;
    $("viewer").dataset.sel = this.selected ? "1" : "";
    this.redraw();
  },

  _opPage(op) {
    if (op.page) return op.page;
    if (op.shape) return this._pageOf(op.shape);
    if (op.ops) return this._opPage(op.ops[0]);
    return null;
  },

  _afterHistory(op) {
    this.dirty = true;
    if (this.selected && this._pageOf(this.selected) === null) this.selected = null;
    const p = this._opPage(op);
    if (p && p !== STATE.currentPage && STATE.viewMode === "single") goToPage(p); else this.redraw();
  },

  undo() {
    const op = this.ops.pop();
    if (!op) { showToast("되돌릴 작업이 없어요."); return; }
    this._apply(op, true); this.redoStack.push(op); this._afterHistory(op);
  },
  redo() {
    const op = this.redoStack.pop();
    if (!op) { showToast("다시 실행할 작업이 없어요."); return; }
    this._apply(op, false); this.ops.push(op); this._afterHistory(op);
  },

  addShapes(list, page) {
    if (!list.length) return;
    this.doOp({ k: "add", page: page || STATE.currentPage, shapes: list });
  },
  addShape(s) { this.addShapes([s]); },

  removeAt(page, index) {
    const shape = (this.byPage[page] || [])[index];
    if (shape) this.doOp({ k: "del", page, items: [{ shape, index }] });
  },
  deleteSelected() {
    const s = this.selected; if (!s) return false;
    const page = this._pageOf(s); if (page === null) return false;
    this.selected = null;
    this.doOp({ k: "del", page, items: [{ shape: s, index: this.byPage[page].indexOf(s) }] });
    return true;
  },
  clearPage() {
    const a = this.byPage[STATE.currentPage] || [];
    if (!a.length) { showToast("이 쪽에는 지울 주석이 없어요."); return; }
    this.doOp({ k: "del", page: STATE.currentPage, items: a.map((shape, index) => ({ shape, index })) });
  },
  clearAll() {
    const ops = Object.keys(this.byPage).filter((p) => this.byPage[p].length)
      .map((p) => ({ k: "del", page: Number(p), items: this.byPage[p].map((shape, index) => ({ shape, index })) }));
    if (!ops.length) { showToast("지울 주석이 없어요."); return; }
    this.doOp({ k: "multi", ops });
  },

  /* ----- 선택 ----- */
  select(shape) { this.selected = shape || null; $("viewer").dataset.sel = this.selected ? "1" : ""; this.redraw(); },

  /* ----- 그리기 ----- */
  // 지금 화면에 보이는 쪽들 (한 쪽씩 보기: 1개, 연속 보기: 여러 개)
  views() {
    if (STATE.viewMode === "continuous") return (typeof CONTVIEW !== "undefined" && CONTVIEW.views) || [];
    return STATE.pageViewport ? [{ page: STATE.currentPage, vp: STATE.pageViewport, canvas: $("annoCanvas"), el: $("pageWrap") }] : [];
  },

  sizeCanvas(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
    c.style.width = w + "px"; c.style.height = h + "px";
  },

  onPageRendered(w, h) {
    this.sizeCanvas($("annoCanvas"), w, h);
    if (this.selected && !(this.byPage[STATE.currentPage] || []).includes(this.selected)) this.selected = null;
    this.redraw();
  },

  redraw() { this.views().forEach((v) => this.redrawView(v)); },

  redrawView(view) {
    const c = view.canvas, vp = view.vp;
    if (!c || !vp) return;
    const ctx = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.visible) {
      const list = this.byPage[view.page] || [];
      list.forEach((s) => this.drawShape(ctx, s, vp));
      if (this.cur && this.curPage === view.page) this.drawShape(ctx, this.cur, vp);
      if (this.selected && list.includes(this.selected)) this.drawSelection(ctx, this.selected, vp);
    }
    ctx.restore();
  },

  toViewport(pt, vp) { return vp.convertToViewportPoint(pt[0], pt[1]); },

  vpPoints(s, vp) {
    const P = (p) => this.toViewport(p, vp);
    if (s.points) return s.points.map(P);
    return [s.p1, s.p2].filter(Boolean).map(P);
  },

  // 크기 조절 핸들: [{ id, x, y }]  (x,y는 화면 좌표)
  handlesOf(s, vp) {
    const P = (p) => this.toViewport(p, vp);
    if (["line", "arrow", "underline", "strike"].includes(s.type)) {
      return [["p1", ...P(s.p1)], ["p2", ...P(s.p2)]].map(([id, x, y]) => ({ id, x, y }));
    }
    if (["rect", "ellipse", "highlight"].includes(s.type)) {
      return [[1, 1], [2, 1], [2, 2], [1, 2]].map(([xi, yi]) => {
        const [x, y] = P([s["p" + xi][0], s["p" + yi][1]]);
        return { id: `c${xi}${yi}`, xi, yi, x, y };
      });
    }
    return [];
  },

  drawSelection(ctx, s, vp) {
    const pts = this.vpPoints(s, vp);
    if (!pts.length) return;
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const pad = s.type === "note" ? 12 : 6 + (s.width || 2) * (vp.scale || 1) / 2;
    ctx.save();
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = "#2f6fed";
    ctx.strokeRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
    ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.lineWidth = 1.5;
    const hs = this.handleSize();
    this.handlesOf(s, vp).forEach((h) => { ctx.beginPath(); ctx.rect(h.x - hs / 2, h.y - hs / 2, hs, hs); ctx.fill(); ctx.stroke(); });
    ctx.restore();
  },

  handleSize() { return window.matchMedia && matchMedia("(pointer:coarse)").matches ? 14 : 9; },

  drawShape(ctx, s, vp) {
    const k = vp.scale || 1;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, (s.width || 2) * k);
    ctx.globalAlpha = 1;
    const P = (p) => this.toViewport(p, vp);

    if (s.preview) { // 글자 선택 드래그 미리보기
      const [x1, y1] = P(s.p1), [x2, y2] = P(s.p2);
      ctx.save(); ctx.globalAlpha = 0.25;
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.restore(); return;
    }
    if (["line", "arrow", "underline", "strike"].includes(s.type)) {
      const [x1, y1] = P(s.p1), [x2, y2] = P(s.p2);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (s.type === "arrow") {
        const ang = Math.atan2(y2 - y1, x2 - x1), len = (8 + 2 * (s.width || 2)) * k;
        ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(ang - Math.PI / 7), y2 - len * Math.sin(ang - Math.PI / 7));
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 7), y2 - len * Math.sin(ang + Math.PI / 7));
        ctx.stroke();
      }
    } else if (s.type === "rect") {
      const [x1, y1] = P(s.p1), [x2, y2] = P(s.p2);
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === "ellipse") {
      const [x1, y1] = P(s.p1), [x2, y2] = P(s.p2);
      ctx.beginPath(); ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (s.type === "free") {
      ctx.beginPath();
      s.points.forEach((p, i) => { const [x, y] = P(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      if (s.points.length === 1) { const [x, y] = P(s.points[0]); ctx.lineTo(x + 0.01, y); }
      ctx.stroke();
    } else if (s.type === "highlight") {
      const [x1, y1] = P(s.p1), [x2, y2] = P(s.p2);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.globalAlpha = 1;
    } else if (s.type === "note") {
      const [x, y] = P(s.p1), h = 8 * k;
      ctx.fillStyle = "#ffd933"; ctx.strokeStyle = "#8a6d00"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(x - h, y - h, h * 2, h * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#5c4600"; ctx.font = `bold ${Math.round(12 * k)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", x, y + 1);
    }
  },

  hitHandle(v, view) {
    const s = this.selected;
    if (!s || !view || !(this.byPage[view.page] || []).includes(s)) return null;
    const tol = this.handleSize() / 2 + 5;
    return this.handlesOf(s, view.vp).find((h) => Math.hypot(v[0] - h.x, v[1] - h.y) <= tol) || null;
  },

  hitTest(v, view) {
    const vp = view && view.vp; if (!vp) return null;
    const list = this.byPage[view.page] || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i], k = vp.scale || 1, tol = Math.max(6, (s.width || 2) * k / 2 + 4);
      const pts = this.vpPoints(s, vp);
      if (!pts.length) continue;
      const [px, py] = v;
      let hit = false;
      if (["line", "arrow", "underline", "strike"].includes(s.type)) hit = distToSeg(px, py, pts[0][0], pts[0][1], pts[1][0], pts[1][1]) <= tol;
      else if (s.type === "free") { for (let j = 1; j < pts.length && !hit; j++) hit = distToSeg(px, py, ...pts[j - 1], ...pts[j]) <= tol; if (pts.length === 1) hit = Math.hypot(px - pts[0][0], py - pts[0][1]) <= tol + 2; }
      else if (s.type === "rect") {
        const [a, b] = pts, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        hit = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]].some((e) => distToSeg(px, py, ...e) <= tol);
      } else if (s.type === "ellipse") {
        const [a, b] = pts, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
        if (rx > 0 && ry > 0) { const r = Math.hypot((px - cx) / rx, (py - cy) / ry); hit = Math.abs(r - 1) * Math.min(rx, ry) <= tol; }
      } else if (s.type === "highlight") {
        const [a, b] = pts; hit = px >= Math.min(a[0], b[0]) && px <= Math.max(a[0], b[0]) && py >= Math.min(a[1], b[1]) && py <= Math.max(a[1], b[1]);
      } else if (s.type === "note") hit = Math.abs(px - pts[0][0]) <= 11 * k && Math.abs(py - pts[0][1]) <= 11 * k;
      if (hit) return s;
    }
    return null;
  },

  async textItems(page) {
    if (!this.textCache[page]) {
      try { this.textCache[page] = textItemsFromContent(await (await STATE.pdfDoc.getPage(page)).getTextContent()); }
      catch (e) { this.textCache[page] = []; }
    }
    return this.textCache[page];
  },

  /* ----- 포인터 입력 ----- */
  // 한 쪽을 감싼 요소(el)에 마우스·터치 입력을 연결해요. getView()는 그 쪽의 화면 정보를 돌려줘요.
  bindContainer(el, getView) {
    const MARKUP = ["highlight", "underline", "strike"];
    const vOf = (e, view) => { const r = view.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const toPdf = (v, view) => view.vp.convertToPdfPoint(v[0], v[1]);
    const constrain = (a, b, tool) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (tool === "line" || tool === "arrow") {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
        return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
      }
      if (tool === "rect" || tool === "ellipse") {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        return [a[0] + Math.sign(dx || 1) * m, a[1] + Math.sign(dy || 1) * m];
      }
      return b;
    };
    const showPop = (note, x, y, ms) => {
      const pop = $("notePop");
      pop.textContent = note.text || "(내용 없음)";
      pop.style.left = Math.min(x + 14, innerWidth - 270) + "px"; pop.style.top = y + 14 + "px"; pop.hidden = false;
      if (ms) { clearTimeout(this._popTm); this._popTm = setTimeout(() => { pop.hidden = true; }, ms); }
    };

    el.addEventListener("pointerdown", (e) => {
      if (!STATE.pdfDoc || e.button !== 0 || this.tool === "hand") return;
      if (e.target.closest && e.target.closest(".capC") && CAPTURE.active) return;
      const view = getView(); if (!view || !view.vp) return;
      this.av = view;
      if (STATE.currentPage !== view.page) { STATE.currentPage = view.page; $("pageInput").value = view.page; THUMBS.setActive(view.page); }
      const v = vOf(e, view);

      if (this.tool === "select") {
        if (!this.visible) return;
        const h = this.hitHandle(v, view);
        if (h) {
          const s = this.selected;
          this.drag = { mode: "resize", h, shape: s, view, before: { p1: [...s.p1], p2: [...s.p2] } };
          this._blockSel = true; el.setPointerCapture(e.pointerId); e.preventDefault(); return;
        }
        const hit = this.hitTest(v, view);
        this.select(hit);
        $("viewer").dataset.sel = hit ? "1" : "";
        if (hit) {
          this.drag = { mode: "move", last: toPdf(v, view), dx: 0, dy: 0, shape: hit, view };
          this._blockSel = true; el.setPointerCapture(e.pointerId); e.preventDefault();
          if (hit.type === "note") showPop(hit, e.clientX, e.clientY, 3000);
        }
        return;
      }
      if (this.tool === "note") {
        this.notePending = toPdf(v, view); this.notePage = view.page; this.noteEditing = null;
        $("noteText").value = ""; openModal("noteOverlay"); return;
      }
      this.startV = v;
      const p = toPdf(v, view), color = this.colorFor(this.tool);
      const w = MARKUP.includes(this.tool) ? Math.min(this.width, 2) : this.width;
      this.cur = this.tool === "free"
        ? { type: "free", color, width: w, points: [p] }
        : { type: this.tool, color, width: w, p1: p, p2: p, preview: MARKUP.includes(this.tool) };
      this.curPage = view.page;
      this.drag = { mode: "draw", view };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (d && d.mode === "draw" && this.cur) {
        const v = vOf(e, d.view);
        const p = toPdf(e.shiftKey ? constrain(this.startV, v, this.tool) : v, d.view);
        if (this.cur.type === "free") this.cur.points.push(p); else this.cur.p2 = p;
        this.redrawView(d.view);
      } else if (d && d.mode === "move") {
        const p = toPdf(vOf(e, d.view), d.view), dx = p[0] - d.last[0], dy = p[1] - d.last[1];
        shapeTranslate(d.shape, dx, dy); d.dx += dx; d.dy += dy; d.last = p;
        this.redrawView(d.view);
      } else if (d && d.mode === "resize") {
        const p = toPdf(vOf(e, d.view), d.view), s = d.shape, h = d.h;
        if (h.id === "p1" || h.id === "p2") s[h.id] = p;
        else { s["p" + h.xi] = [p[0], s["p" + h.xi][1]]; s["p" + h.yi] = [s["p" + h.yi][0], p[1]]; }
        this.redrawView(d.view);
      } else if (STATE.pdfDoc && this.visible && this.tool === "select" && e.pointerType !== "touch") {
        const view = getView(); if (!view || !view.vp) return;
        const v = vOf(e, view);
        const handle = this.hitHandle(v, view), hit = handle ? null : this.hitTest(v, view);
        el.style.cursor = handle ? "nwse-resize" : hit ? "move" : "";
        if (hit && hit.type === "note") showPop(hit, e.clientX, e.clientY); else $("notePop").hidden = true;
      }
    });

    const finish = async () => {
      const d = this.drag; if (!d) return;
      this.drag = null;
      if (d.mode === "move") {
        if (Math.abs(d.dx) + Math.abs(d.dy) > 1e-6) {
          shapeTranslate(d.shape, -d.dx, -d.dy);
          this.doOp({ k: "move", shape: d.shape, dx: d.dx, dy: d.dy });
        }
        return;
      }
      if (d.mode === "resize") {
        const s = d.shape, after = { p1: [...s.p1], p2: [...s.p2] };
        Object.assign(s, d.before);
        if (JSON.stringify(after) !== JSON.stringify(d.before)) this.doOp({ k: "prop", shape: s, before: d.before, after });
        else this.redrawView(d.view);
        return;
      }
      const s = this.cur; this.cur = null;
      if (!s) return;
      const view = d.view, page = view.page;
      const a = this.toViewport(s.p1 || s.points[0], view.vp), b = this.toViewport(s.p2 || s.points[s.points.length - 1], view.vp);
      const tiny = Math.hypot(b[0] - a[0], b[1] - a[1]) < 3;
      if (s.type === "free") { this.addShapes([s], page); return; }
      if (MARKUP.includes(s.type)) {
        const items = await this.textItems(page);
        const lines = tiny ? [] : textLinesInSelection(items, s.p1, s.p2);
        if (lines.length) {
          this.addShapes(lines.map((l) => {
            if (s.type === "highlight") return { type: "highlight", color: s.color, width: 0, p1: [l.x0, l.base - l.h * 0.2], p2: [l.x1, l.base + l.h * 0.85] };
            const y = s.type === "underline" ? l.base - l.h * 0.12 : l.base + l.h * 0.3;
            return { type: s.type, color: s.color, width: s.width, p1: [l.x0, y], p2: [l.x1, y] };
          }), page);
        } else if (!tiny) {
          delete s.preview;
          if (s.type !== "highlight") s.p2 = [s.p2[0], s.p1[1]];
          this.addShapes([s], page);
        } else this.redrawView(view);
        return;
      }
      if (tiny) { this.redrawView(view); return; }
      this.addShapes([s], page);
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", () => { const v = this.drag && this.drag.view; this.drag = null; this.cur = null; if (v) this.redrawView(v); });
    el.addEventListener("pointerleave", () => { $("notePop").hidden = true; });
    // 선택 도구로 주석을 잡았을 땐 글자 선택이 같이 시작되지 않게 막아요
    el.addEventListener("mousedown", (e) => { if (this._blockSel) { e.preventDefault(); this._blockSel = false; } }, true);

    el.addEventListener("dblclick", (e) => {
      if (this.tool !== "select") return;
      const view = getView(); if (!view || !view.vp) return;
      const hit = this.hitTest(vOf(e, view), view);
      if (hit && hit.type === "note") {
        this.noteEditing = hit; $("noteText").value = hit.text || "";
        openModal("noteOverlay"); $("noteText").focus();
      }
    });
  },

  initPointerEvents() {
    this.bindContainer($("pageWrap"), () => this.views()[0]);

    $("noteConfirm").addEventListener("click", () => {
      const text = $("noteText").value.trim() || "(내용 없음)";
      if (this.noteEditing) {
        const s = this.noteEditing;
        if (s.text !== text) this.doOp({ k: "prop", shape: s, before: { text: s.text }, after: { text } });
      } else if (this.notePending) {
        this.addShapes([{ type: "note", color: "#ffd933", width: 1, p1: this.notePending, text }], this.notePage || STATE.currentPage);
      }
      this.noteEditing = null; this.notePending = null;
      closeModal("noteOverlay");
    });

    // 단축키: 되돌리기/다시 실행/삭제/취소
    document.addEventListener("keydown", (e) => {
      if (!STATE.pdfDoc) return;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement || {}).tagName);
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.altKey && (k === "z" || k === "y") && !typing) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) this.redo(); else this.undo();
      } else if (!typing && !e.ctrlKey && (k === "delete" || k === "backspace") && this.selected) {
        e.preventDefault(); this.deleteSelected();
      } else if (!typing && k === "escape" && $("presentOverlay") && !$("presentOverlay").classList.contains("open")) {
        if (this.cur) { this.cur = null; this.drag = null; this.redraw(); }
        else if (this.selected) this.select(null);
        else if (this.tool !== "select") this.setTool("select");
      }
    });
  },

  // 저장했던 편집 데이터를 다시 불러오기
  restore(session) {
    if (!session || !session.byPage) return;
    Object.keys(session.byPage).forEach((p) => { this.byPage[p] = session.byPage[p]; });
    STATE.pageRotations = session.rotations || {};
    this.dirty = false;
  },

  /* ----- 저장용 바이트 만들기 ----- */
  async buildBytes() {
    try {
      const changed = this.hasAny() || Object.keys(STATE.pageRotations).some((k) => STATE.pageRotations[k]);
      const embed = changed ? { original: new Uint8Array(STATE.fileBytes), session: { v: 1, byPage: this.byPage, rotations: STATE.pageRotations } } : null;
      return await buildAnnotatedPDF(PDFLib, STATE.fileBytes, this.byPage, STATE.pageRotations, { embed });
    } catch (e) {
      console.warn("벡터 저장 실패, 이미지 방식으로 대신 저장해요:", e);
      return this.buildBytesRaster();
    }
  },

  // 예비 방식: 모든 쪽을 이미지로 구워서 저장 (벡터 방식이 안 되는 특이한 PDF용)
  async buildBytesRaster() {
    const outDoc = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= STATE.numPages; i++) {
      const page = await STATE.pdfDoc.getPage(i), rotation = getPageRotation(i);
      const vp = page.getViewport({ scale: 2, rotation });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      (this.byPage[i] || []).forEach((s) => this.drawShape(ctx, s, vp));
      const png = await outDoc.embedPng(await new Promise((res) => canvas.toBlob((b) => b.arrayBuffer().then(res), "image/png")));
      const base = page.getViewport({ scale: 1, rotation });
      outDoc.addPage([base.width, base.height]).drawImage(png, { x: 0, y: 0, width: base.width, height: base.height });
    }
    return outDoc.save();
  },
};

/* ---------- 저장하기 / 다른 이름으로 저장 ---------- */
// 반환값: 저장했으면 true, 취소·실패면 false
async function saveDocument(saveAsNew) {
  if (!STATE.pdfDoc) { showToast("먼저 PDF를 열어주세요."); return false; }
  let target = null;
  try {
    if (saveAsNew && window.showSaveFilePicker) {
      target = await window.showSaveFilePicker({
        suggestedName: STATE.fileName,
        types: [{ description: "PDF 파일", accept: { "application/pdf": [".pdf"] } }],
      });
    } else if (!saveAsNew && STATE.fileHandle && STATE.fileHandle.requestPermission) {
      let perm = await STATE.fileHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") perm = await STATE.fileHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") target = STATE.fileHandle;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return false;
    target = null;
  }
  let downloadName = STATE.fileName;
  if (!target && saveAsNew) {
    const name = prompt("저장할 파일 이름을 입력하세요.", STATE.fileName.replace(/\.pdf$/i, ""));
    if (!name) return false;
    downloadName = name.replace(/\.pdf$/i, "") + ".pdf";
  }
  showLoading("저장하는 중…");
  try {
    const bytes = ANNOTATE.hasChanges() ? await ANNOTATE.buildBytes() : new Uint8Array(STATE.fileBytes);
    if (target) {
      const w = await target.createWritable();
      await w.write(bytes); await w.close();
      if (saveAsNew) {
        STATE.fileHandle = target; STATE.fileName = target.name;
        $("docTitle").textContent = STATE.fileName + " - HorixOffice";
        if (typeof RECENT !== "undefined") { RECENT.add(STATE.fileName, STATE.numPages); RECENT.saveHandle(STATE.fileName, target); }
      }
      showToast("저장했어요.");
    } else {
      downloadBytes(bytes, downloadName, "application/pdf");
      showToast("저장했어요. (다운로드 폴더를 확인해 보세요)");
    }
    ANNOTATE.dirty = false;
    return true;
  } catch (err) {
    console.error(err);
    showToast("저장하는 중 문제가 발생했어요.");
    return false;
  } finally { hideLoading(); }
}
