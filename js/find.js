/* =========================================================
   find.js — 찾기: 문서 안의 글자를 찾아 쪽으로 이동하고, 찾은 곳을 형광 상자로 보여줘요.
   '찾기(D)'를 다시 누르거나 Enter·F3을 누르면 다음 곳으로, Shift+F3은 앞으로 가요.
   ========================================================= */

// pdf.js 글자 조각들 → 검색용 문자열 + 글자마다 어느 조각의 몇 번째 글자인지
function buildFindIndex(content) {
  let text = "";
  const map = []; // text의 i번째 글자 → { item, ci } (사이 공백은 null)
  const items = (content.items || []).filter((it) => it.str !== undefined && it.transform);
  let prev = null;
  items.forEach((it) => {
    if (prev) {
      const sameLine = Math.abs(prev.transform[5] - it.transform[5]) < Math.max(2, Math.abs(prev.transform[3]) * 0.5);
      const gap = it.transform[4] - (prev.transform[4] + (prev.width || 0));
      if (!sameLine || prev.hasEOL || gap > Math.abs(it.transform[3] || 10) * 0.25) { text += " "; map.push(null); }
    }
    for (let ci = 0; ci < it.str.length; ci++) { text += it.str[ci]; map.push({ it, ci }); }
    prev = it;
  });
  return { text, map };
}

// 검색어 위치들 → PDF 좌표 상자들 [[x0,y0,x1,y1], ...] (찾은 곳마다 하나의 배열)
function findInIndex(index, query, caseSensitive) {
  const norm = (s) => (caseSensitive ? s : s.toLowerCase());
  const hay = norm(index.text).replace(/\s+/g, " "), q = norm(query).replace(/\s+/g, " ").trim();
  const out = [];
  if (!q) return out;
  let from = 0;
  while (true) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    const boxes = new Map();
    for (let i = at; i < at + q.length; i++) {
      const m = index.map[i]; if (!m) continue;
      const it = m.it, t = it.transform, n = it.str.length || 1, h = Math.abs(it.height || t[3]) || 10;
      const x0 = t[4] + (it.width || 0) * (m.ci / n), x1 = t[4] + (it.width || 0) * ((m.ci + 1) / n);
      const b = boxes.get(it);
      if (b) { b[0] = Math.min(b[0], x0); b[2] = Math.max(b[2], x1); }
      else boxes.set(it, [x0, t[5] - h * 0.22, x1, t[5] + h * 0.88]);
    }
    if (boxes.size) out.push([...boxes.values()]);
    from = at + Math.max(1, q.length);
  }
  return out;
}

const FINDHL = {
  query: "", caseSensitive: false,
  cache: {},      // 쪽 → 찾기 색인
  hits: {},       // 쪽 → [찾은 곳(상자들)] (지금 검색어 기준)
  cur: null,      // { page, i }

  clear() {
    this.query = ""; this.cache = {}; this.hits = {}; this.cur = null;
    document.querySelectorAll(".findL").forEach((l) => l.remove());
  },

  async pageHits(p) {
    if (this.hits[p]) return this.hits[p];
    if (!this.cache[p]) {
      try { this.cache[p] = buildFindIndex(await (await STATE.pdfDoc.getPage(p)).getTextContent()); }
      catch (e) { this.cache[p] = { text: "", map: [] }; }
    }
    this.hits[p] = findInIndex(this.cache[p], this.query, this.caseSensitive);
    return this.hits[p];
  },

  // 화면에 보이는 쪽들 위에 상자를 그려요
  paint() {
    document.querySelectorAll(".findL").forEach((l) => l.remove());
    if (!this.query || !STATE.pdfDoc) return;
    const views = isMultiView() ? CONTVIEW.views.filter((v) => v.vp) : (STATE.pageViewport ? [{ page: STATE.currentPage, vp: STATE.pageViewport, el: $("pageWrap") }] : []);
    views.forEach((v) => {
      const list = this.hits[v.page]; if (!list || !list.length) return;
      const layer = document.createElement("div"); layer.className = "findL";
      list.forEach((boxes, i) => boxes.forEach((r) => {
        const [x1, y1, x2, y2] = v.vp.convertToViewportRectangle(r);
        const d = document.createElement("div");
        d.className = "findHit" + (this.cur && this.cur.page === v.page && this.cur.i === i ? " cur" : "");
        Object.assign(d.style, { left: Math.min(x1, x2) + "px", top: Math.min(y1, y2) + "px", width: Math.abs(x2 - x1) + "px", height: Math.abs(y2 - y1) + "px" });
        layer.appendChild(d);
      }));
      v.el.appendChild(layer);
    });
  },

  // 다음(또는 이전) 찾은 곳으로. 못 찾으면 false
  async step(dir) {
    const total = STATE.numPages;
    let p = this.cur ? this.cur.page : STATE.currentPage;
    let i = this.cur ? this.cur.i + dir : (dir > 0 ? 0 : Infinity);
    for (let n = 0; n <= total; n++) {
      const list = await this.pageHits(p);
      if (i === Infinity) i = list.length - 1;
      if (i >= 0 && i < list.length) { this.cur = { page: p, i }; return true; }
      p = dir > 0 ? (p % total) + 1 : ((p - 2 + total) % total) + 1;
      i = dir > 0 ? 0 : Infinity;
    }
    return false;
  },

  async countAll() {
    let n = 0;
    for (let p = 1; p <= STATE.numPages; p++) n += (await this.pageHits(p)).length;
    return n;
  },
};

async function performFind(dirOverride) {
  if (!STATE.pdfDoc) return;
  const q = $("findText").value.trim();
  if (!q) return;
  const dir = dirOverride || (document.querySelector('input[name="findDir"]:checked').value === "up" ? -1 : 1);
  const cs = $("findCaseSensitive").checked;
  if (q !== FINDHL.query || cs !== FINDHL.caseSensitive) {
    FINDHL.query = q; FINDHL.caseSensitive = cs; FINDHL.hits = {}; FINDHL.cur = null;
    if (!Array.from($("findHistory").options).some((o) => o.value === q)) {
      const opt = document.createElement("option"); opt.value = q; $("findHistory").prepend(opt);
    }
  }
  showLoading("찾는 중…");
  let ok = false;
  try { ok = await FINDHL.step(dir); } finally { hideLoading(); }
  if (!ok) { FINDHL.paint(); showToast(`'${q}'을(를) 찾을 수 없어요.`); return; }
  const { page, i } = FINDHL.cur;
  if (page !== STATE.currentPage || isMultiView()) await goToPage(page);
  FINDHL.paint();
  // 찾은 곳이 화면 안에 들어오게 스크롤
  const hit = document.querySelector(".findHit.cur");
  if (hit) {
    const vr = $("viewer").getBoundingClientRect(), hr = hit.getBoundingClientRect();
    if (hr.top < vr.top + 40 || hr.bottom > vr.bottom - 40) $("viewer").scrollTop += hr.top - vr.top - vr.height / 3;
    if (hr.left < vr.left || hr.right > vr.right) $("viewer").scrollLeft += hr.left - vr.left - vr.width / 3;
  }
  const n = (await FINDHL.pageHits(page)).length;
  showToast(`${page}쪽에서 찾았어요 (이 쪽 ${i + 1}/${n})`);
}

document.addEventListener("DOMContentLoaded", () => {
  $("findText").addEventListener("input", () => { $("findExecute").disabled = !$("findText").value.trim(); });
  $("findText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("findExecute").disabled) { e.preventDefault(); performFind(e.shiftKey ? -1 : 0); } });
  $("findExecute").addEventListener("click", () => performFind());
  // 찾기 창을 닫으면 표시도 지워요
  $("findWin").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) { FINDHL.clear(); } });
  // F3 / Shift+F3: 다음 / 이전 찾기 (찾기 창이 닫혀 있어도)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "F3" || !STATE.pdfDoc) return;
    e.preventDefault();
    if (!$("findText").value.trim()) { ACT.find(); return; }
    performFind(e.shiftKey ? -1 : 1);
  });
});
