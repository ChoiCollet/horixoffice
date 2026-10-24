/* =========================================================
   core.js — 전역 상태 · PDF 로딩 · 페이지 렌더링
   ========================================================= */

const STATE = {
  pdfDoc: null,        // pdf.js document
  fileBytes: null,     // ArrayBuffer of the original file (for pdf-lib / merge / export)
  fileName: "제목 없음.pdf",
  fileHandle: null,    // 파일 시스템 접근 API로 연 파일이면 그 핸들 (저장하기로 덮어쓰기용)
  numPages: 0,
  currentPage: 1,
  scale: 1.2,
  fitMode: "custom",   // 'width' | 'page' | 'custom'
  viewMode: "single",  // 'single' | 'continuous' | 'two'(두 쪽) | 'twoCont'(두 쪽 연속)
  pageRotations: {},   // { 쪽번호: 0/90/180/270, ... } — 쪽마다 따로 회전
  pageViewport: null,   // 마지막 렌더 viewport (캡처/주석 좌표 계산용)
};

function getPageRotation(p) { return STATE.pageRotations[p] || 0; }
function setPageRotation(p, deg) {
  STATE.pageRotations[p] = ((deg % 360) + 360) % 360;
  if (typeof ANNOTATE !== "undefined") ANNOTATE.markDirty();
}

function $(id) { return document.getElementById(id); }

/* ---------- 캔버스 해상도 ----------
   확대를 많이 하거나 고해상도 화면이면 캔버스가 너무 커져서 브라우저(특히 휴대폰)가 그리기를 포기하고 하얗게 비워 버려요.
   그래서 캔버스 한 장의 픽셀 수에 상한을 두고, 그 안에서 가장 선명하게 그려요. */
function canvasDpr(w, h, maxPx) {
  const dpr = window.devicePixelRatio || 1;
  const limit = maxPx || (isMobile() ? 6e6 : 14e6);
  return Math.max(0.5, Math.min(dpr, Math.sqrt(limit / Math.max(1, w * h))));
}
function sizeCanvasTo(c, w, h, k) {
  c.width = Math.max(1, Math.floor(w * k)); c.height = Math.max(1, Math.floor(h * k));
  c.style.width = w + "px"; c.style.height = h + "px";
  c._k = k;
  return k;
}
// 캔버스 픽셀 ÷ 화면 크기 (그릴 때·잘라낼 때 같은 비율을 써야 어긋나지 않아요)
function canvasK(c) { return (c && c._k) || (c && c.width / (parseFloat(c.style.width) || c.width)) || 1; }

function updateZoomUi() {
  $("zoomText").textContent = Math.round(STATE.scale * 100) + " %";
  $("zoomSlider").value = Math.round(STATE.scale * 100);
}
function updatePageUi() {
  $("pageInput").value = STATE.currentPage;
  $("statusPage").textContent = `페이지 ${STATE.currentPage} / ${STATE.numPages}`;
  if (typeof THUMBS !== "undefined") THUMBS.setActive(STATE.currentPage);
}

function isMobile() { return !!(window.matchMedia && window.matchMedia("(max-width:720px)").matches); }
// 왼쪽 페이지 패널: 컴퓨터에선 옆에 붙어 있고, 모바일에선 서랍처럼 열고 닫아요
function setLeftPanel(show) {
  const p = $("leftPanel");
  if (isMobile()) p.classList.toggle("mob-open", !!show);
  else p.style.display = show ? "" : "none";
}
function leftPanelShown() {
  const p = $("leftPanel");
  return isMobile() ? p.classList.contains("mob-open") : p.style.display !== "none";
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.remove("show"), 2200);
}

function showLoading(text) {
  $("loadingText").textContent = text || "처리 중…";
  $("loading").classList.add("show");
}
function hideLoading() { $("loading").classList.remove("show"); }

function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

document.addEventListener("click", (e) => {
  const closeId = e.target.getAttribute && e.target.getAttribute("data-close");
  if (closeId) closeModal(closeId);
});

function setControlsEnabled(enabled) {
  document.querySelectorAll("[data-need]").forEach((el) => { el.disabled = !enabled; });
}

/* ---------- 파일 열기 ---------- */

async function loadPDFFromFile(file) {
  showLoading("PDF를 불러오는 중…");
  try {
    let buf = await file.arrayBuffer();
    STATE.fileBytes = buf;
    STATE.fileHandle = null;
    STATE.fileName = file.name || "제목 없음.pdf";
    STATE.fileModified = file.lastModified;
    STATE.passwordUsed = false;
    $("docTitle").textContent = STATE.fileName + " - HorixOffice";

    let doc = await openPdfDocument(pdfjsLib, buf.slice(0), askPdfPassword);
    // 이전에 HorixOffice에서 저장한 파일이면 원본과 주석을 꺼내서 계속 편집할 수 있게 해요
    const found = typeof detectHorixSession === "function" ? await detectHorixSession(doc) : null;
    if (found) {
      const o = found.original;
      buf = o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength);
      STATE.fileBytes = buf;
      doc = await openPdfDocument(pdfjsLib, buf.slice(0), askPdfPassword);
    }

    STATE.pdfDoc = doc;
    STATE.numPages = doc.numPages;
    STATE.currentPage = 1;
    STATE.pageRotations = {};
    STATE.viewMode = "single";
    if (typeof CONTVIEW !== "undefined") { CONTVIEW.destroy(); $("continuousWrap").hidden = true; $("continuousWrap").classList.remove("show"); }
    STATE.fitMode = typeof PREFS !== "undefined" ? PREFS.data.fit : "custom";
    // 휴대폰에서는 처음부터 화면 폭에 맞춰 보여줘요 (120%로 열면 쪽이 화면 밖으로 넘쳐요)
    if (STATE.fitMode === "custom" && isMobile()) STATE.fitMode = "width";
    if (typeof FINDHL !== "undefined") FINDHL.clear();
    STATE.scale = 1.2;

    $("empty").style.display = "none";
    $("pageWrap").style.display = "block";
    $("pageTotal").textContent = STATE.numPages;
    $("pageInput").value = 1;

    setControlsEnabled(true);
    ANNOTATE.reset(STATE.numPages);
    if (found) { ANNOTATE.restore(found.session); showToast("이전에 저장한 주석을 편집할 수 있게 불러왔어요."); }
    if (typeof PREFS !== "undefined") {
      ANNOTATE.color = PREFS.data.annoColor; ANNOTATE.width = PREFS.data.annoWidth;
      $("leftPanel").style.display = PREFS.data.thumbs ? "" : "none";
      if (typeof syncAnnoUI === "function") syncAnnoUI();
    }

    await renderCurrentPage();
    await THUMBS.build();
    updateDocInfo(file);
    RECENT.add(STATE.fileName, STATE.numPages);
    $("statusText").textContent = `${STATE.fileName} 열림`;
  } catch (err) {
    if (err && err.cancelled) showToast("열기를 취소했어요.");
    else { console.error(err); showToast("PDF를 여는 중 문제가 발생했어요. 파일이 손상되지 않았는지 확인해 주세요."); }
  } finally {
    hideLoading();
  }
}

function updateDocInfo(file) {
  const sizeKB = file ? Math.round(file.size / 1024) : Math.round(STATE.fileBytes.byteLength / 1024);
  $("docInfo").innerHTML =
    `<b>${escapeHtml(STATE.fileName)}</b><br>` +
    `쪽수: ${STATE.numPages}쪽<br>` +
    `크기: ${sizeKB.toLocaleString()} KB`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* ---------- 페이지 렌더링 ---------- */

async function renderCurrentPage() {
  if (!STATE.pdfDoc) return;
  const page = await STATE.pdfDoc.getPage(STATE.currentPage);

  let viewport = page.getViewport({ scale: STATE.scale, rotation: getPageRotation(STATE.currentPage) });

  if (STATE.fitMode === "width" || STATE.fitMode === "page") {
    const pad = $("viewer").clientWidth < 500 ? 16 : 48;
    const availW = $("viewer").clientWidth - pad;
    const availH = $("viewer").clientHeight - pad;
    const base = page.getViewport({ scale: 1, rotation: getPageRotation(STATE.currentPage) });
    let s;
    if (STATE.fitMode === "width") s = availW / base.width;
    else s = Math.min(availW / base.width, availH / base.height);
    STATE.scale = Math.max(0.2, s);
    viewport = page.getViewport({ scale: STATE.scale, rotation: getPageRotation(STATE.currentPage) });
  }

  // 그리는 동안 다른 쪽으로 넘어가면 이전 그리기는 취소해요 (빠르게 넘길 때 겹쳐 그려지는 문제 방지)
  const ticket = renderCurrentPage.ticket = (renderCurrentPage.ticket || 0) + 1;
  if (renderCurrentPage.task) { try { renderCurrentPage.task.cancel(); } catch (e) { /* 무시 */ } }
  // 새 그림은 화면 밖 캔버스에 먼저 그리고, 다 그려지면 한 번에 바꿔 끼워요 (깜빡임 없음)
  const k = canvasDpr(viewport.width, viewport.height);
  const off = document.createElement("canvas");
  sizeCanvasTo(off, viewport.width, viewport.height, k);
  const octx = off.getContext("2d");
  octx.setTransform(k, 0, 0, k, 0, 0);
  renderCurrentPage.task = page.render({ canvasContext: octx, viewport });
  try { await renderCurrentPage.task.promise; } catch (e) { if (ticket !== renderCurrentPage.ticket) return; throw e; }
  if (ticket !== renderCurrentPage.ticket) return;
  const canvas = $("pdfCanvas");
  sizeCanvasTo(canvas, viewport.width, viewport.height, k);
  canvas.getContext("2d").drawImage(off, 0, 0);
  off.width = off.height = 0;

  $("pageWrap").style.width = viewport.width + "px";
  $("pageWrap").style.height = viewport.height + "px";

  STATE.pageViewport = viewport;
  updateZoomUi();
  updatePageUi();

  ANNOTATE.onPageRendered(viewport.width, viewport.height);
  TEXTLAYER.render(page, viewport, $("textLayer"));
  CAPTURE.onPageRendered(viewport.width, viewport.height);
  if (typeof FINDHL !== "undefined") FINDHL.paint();
}

// 지금 보기 방식으로 다시 그리기 (여러 쪽 보기면 보던 쪽 위치를 지켜요)
async function refreshView() {
  if (!STATE.pdfDoc) return;
  if (!isMultiView()) return renderCurrentPage();
  const keep = STATE.currentPage;
  await CONTVIEW.renderAll();
  CONTVIEW.scrollToPage(keep);
}

async function goToPage(n, opts) {
  if (!STATE.pdfDoc) return;
  n = Math.max(1, Math.min(STATE.numPages, n));
  if (STATE.viewMode === "two") {
    const pair = (x) => (x % 2 ? x : x - 1);
    const same = pair(n) === pair(STATE.currentPage);
    STATE.currentPage = n;
    if (same) updatePageUi(); else await CONTVIEW.renderAll();
    return;
  }
  if (isMultiView()) {
    STATE.currentPage = n;
    CONTVIEW.scrollToPage(n);
    updatePageUi();
    return;
  }
  if (n === STATE.currentPage) return;
  STATE.currentPage = n;
  await renderCurrentPage();
  // 새 쪽은 맨 위부터 (PageUp으로 앞 쪽에 갈 땐 맨 아래부터) 보여줘요
  const v = $("viewer");
  v.scrollTop = opts && opts.bottom ? v.scrollHeight : 0;
}

function setZoom(delta) {
  const v = $("viewer").getBoundingClientRect();
  zoomTo(STATE.scale + delta, v.left + v.width / 2, v.top + v.height / 2);
}

// 배율을 바꾸되, 화면의 (cx, cy) 지점에 있던 내용이 그대로 그 자리에 남게 스크롤을 맞춰요
// (Ctrl+휠, 두 손가락 확대, 확대/축소 버튼 모두 이걸 써요)
async function zoomTo(newScale, cx, cy, anchor) {
  if (!STATE.pdfDoc) return;
  newScale = Math.max(0.25, Math.min(4, newScale));
  const viewer = $("viewer"), host = isMultiView() ? $("continuousWrap") : $("pageWrap");
  const r0 = host.getBoundingClientRect();
  // anchor: [가로 비율, 세로 비율] — 내용의 이 지점을 (cx, cy)에 맞춰요 (없으면 지금 (cx, cy) 아래에 있는 지점)
  const fx = anchor ? anchor[0] : r0.width ? (cx - r0.left) / r0.width : 0.5;
  const fy = anchor ? anchor[1] : r0.height ? (cy - r0.top) / r0.height : 0;
  STATE.fitMode = "custom";
  STATE.scale = newScale;
  if (isMultiView()) await CONTVIEW.renderAll(); else await renderCurrentPage();
  const r1 = host.getBoundingClientRect();
  viewer.scrollLeft += r1.left + fx * r1.width - cx;
  viewer.scrollTop += r1.top + fy * r1.height - cy;
}

function setFitMode(mode) {
  STATE.fitMode = mode;
  refreshView();
}

function rotatePage() {
  setPageRotation(STATE.currentPage, getPageRotation(STATE.currentPage) + 90);
  THUMBS.rerenderOne(STATE.currentPage);
  refreshView();
}
