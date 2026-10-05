/* =========================================================
   textlayer.js — 글자 선택·복사 (투명한 글자 층) + 실시간 검색 · 사전 · 번역
   ========================================================= */

const TEXTLAYER = {
  measureCtx: null,
  tokens: new WeakMap(),

  _ctx() {
    if (!this.measureCtx) { try { this.measureCtx = document.createElement("canvas").getContext("2d"); } catch (e) { this.measureCtx = null; } }
    return this.measureCtx;
  },

  // pdf.js 글자 정보를 화면 위치에 맞춰 투명한 span으로 깔아요
  async render(page, viewport, layer) {
    const tok = (this.tokens.get(layer) || 0) + 1;
    this.tokens.set(layer, tok);
    layer.innerHTML = "";
    layer.style.width = viewport.width + "px"; layer.style.height = viewport.height + "px";
    let content;
    try { content = await page.getTextContent(); } catch (e) { return 0; }
    if (this.tokens.get(layer) !== tok) return 0;
    const ctx = this._ctx(), frag = document.createDocumentFragment();
    let count = 0;
    for (const it of content.items) {
      if (!it.str || !it.transform) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      if (!(fh > 0)) continue;
      const span = document.createElement("span");
      span.textContent = it.str;
      const fam = (content.styles && content.styles[it.fontName] && content.styles[it.fontName].fontFamily) || "sans-serif";
      span.style.left = tx[4] + "px"; span.style.top = (tx[5] - fh) + "px";
      span.style.fontSize = fh + "px"; span.style.fontFamily = fam; span.style.height = fh + "px";
      let sx = 1;
      if (ctx && it.width > 0) {
        ctx.font = `${fh}px ${fam}`;
        const w = ctx.measureText(it.str).width;
        if (w > 0) sx = (it.width * viewport.scale) / w;
      }
      const ang = Math.atan2(tx[1], tx[0]);
      const tf = [];
      if (Math.abs(ang) > 0.001) tf.push(`rotate(${ang}rad)`);
      if (Math.abs(sx - 1) > 0.01 && isFinite(sx)) tf.push(`scaleX(${sx})`);
      if (tf.length) span.style.transform = tf.join(" ");
      frag.appendChild(span); count++;
    }
    layer.appendChild(frag);
    return count;
  },

  currentLayer() {
    if (STATE.viewMode === "continuous") {
      const el = document.querySelector(`.contPage[data-page="${STATE.currentPage}"] .textL`);
      return el || null;
    }
    return $("textLayer");
  },

  selectionText() { const s = window.getSelection && window.getSelection(); return s ? s.toString() : ""; },

  selectAll() {
    const layer = this.currentLayer();
    if (!layer || !layer.firstChild) { showToast("이 쪽에는 선택할 수 있는 글자가 없어요. (스캔한 이미지일 수 있어요)"); return false; }
    ANNOTATE.setTool("select");
    const r = document.createRange(); r.selectNodeContents(layer);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    return true;
  },

  async copy() {
    const text = this.selectionText();
    if (!text.trim()) { showToast("복사할 글자를 먼저 선택해 주세요. (선택 도구로 글자를 끌어서 고르거나 '모두 선택')"); return false; }
    try { await navigator.clipboard.writeText(text); }
    catch (e) { try { document.execCommand("copy"); } catch (e2) { showToast("복사하지 못했어요."); return false; } }
    showToast("복사했어요.");
    return true;
  },
};

/* ---------- 실시간 검색 · 사전 · 번역 ---------- */
const SEARCH_ENGINES = {
  naver: { name: "네이버", url: "https://search.naver.com/search.naver?query=" },
  google: { name: "구글", url: "https://www.google.com/search?q=" },
  bing: { name: "빙", url: "https://www.bing.com/search?q=" },
  daum: { name: "다음", url: "https://search.daum.net/search?q=" },
};
const DICT_SITES = {
  stdict: { name: "표준국어대사전", url: "https://stdict.korean.go.kr/search/searchResult.do?searchKeyword=" },
  naverdict: { name: "네이버 사전", url: "https://dict.naver.com/search.nhn?query=" },
  wiki: { name: "위키백과", url: "https://ko.wikipedia.org/w/index.php?search=" },
};
const translateUrl = (text) => "https://translate.google.com/?sl=auto&tl=ko&op=translate&text=" + encodeURIComponent(text);
function openExternal(url) { window.open(url, "_blank", "noopener"); }
