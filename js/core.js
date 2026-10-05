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
  viewMode: "single",  // 'single' | 'continuous'
  pageRotations: {},   // { 쪽번호: 0/90/180/270, ... } — 쪽마다 따로 회전
  pageViewport: null,   // 마지막 렌더 viewport (캡처/주석 좌표 계산용)
};

function getPageRotation(p) { return STATE.pageRotations[p] || 0; }
function setPageRotation(p, deg) {
  STATE.pageRotations[p] = ((deg % 360) + 360) % 360;
  if (typeof ANNOTATE !== "undefined") ANNOTATE.markDirty();
}

function $(id) { return document.getElementById(id); }

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
    $("docTitle").textContent = STATE.fileName + " - HorixOffice";

    let doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    // 이전에 HorixOffice에서 저장한 파일이면 원본과 주석을 꺼내서 계속 편집할 수 있게 해요
    const found = typeof detectHorixSession === "function" ? await detectHorixSession(doc) : null;
    if (found) {
      const o = found.original;
      buf = o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength);
      STATE.fileBytes = buf;
      doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    }

    STATE.pdfDoc = doc;
    STATE.numPages = doc.numPages;
    STATE.currentPage = 1;
    STATE.pageRotations = {};
    STATE.viewMode = "single";
    if (typeof CONTVIEW !== "undefined") { CONTVIEW.destroy(); $("continuousWrap").hidden = true; $("continuousWrap").classList.remove("show"); }
    STATE.fitMode = typeof PREFS !== "undefined" ? PREFS.data.fit : "custom";
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
    console.error(err);
    showToast("PDF를 여는 중 문제가 발생했어요. 파일이 손상되지 않았는지 확인해 주세요.");
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
    const availW = $("viewer").clientWidth - 48;
    const availH = $("viewer").clientHeight - 48;
    const base = page.getViewport({ scale: 1, rotation: getPageRotation(STATE.currentPage) });
    let s;
    if (STATE.fitMode === "width") s = availW / base.width;
    else s = Math.min(availW / base.width, availH / base.height);
    STATE.scale = Math.max(0.2, s);
    viewport = page.getViewport({ scale: STATE.scale, rotation: getPageRotation(STATE.currentPage) });
  }

  const canvas = $("pdfCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + "px";
  canvas.style.height = viewport.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  await page.render({ canvasContext: ctx, viewport }).promise;

  $("pageWrap").style.width = viewport.width + "px";
  $("pageWrap").style.height = viewport.height + "px";

  STATE.pageViewport = viewport;
  $("zoomText").textContent = Math.round(STATE.scale * 100) + " %";
  $("zoomSlider").value = Math.round(STATE.scale * 100);
  $("pageInput").value = STATE.currentPage;
  $("statusPage").textContent = `페이지 ${STATE.currentPage} / ${STATE.numPages}`;

  ANNOTATE.onPageRendered(viewport.width, viewport.height);
  TEXTLAYER.render(page, viewport, $("textLayer"));
  CAPTURE.onPageRendered(viewport.width, viewport.height);
  THUMBS.setActive(STATE.currentPage);
}

function refreshView() {
  if (!STATE.pdfDoc) return;
  return STATE.viewMode === "continuous" ? CONTVIEW.renderAll() : renderCurrentPage();
}

async function goToPage(n) {
  if (!STATE.pdfDoc) return;
  n = Math.max(1, Math.min(STATE.numPages, n));
  if (STATE.viewMode === "continuous") {
    STATE.currentPage = n;
    CONTVIEW.scrollToPage(n);
    return;
  }
  if (n === STATE.currentPage) return;
  STATE.currentPage = n;
  await renderCurrentPage();
}

function setZoom(delta) {
  STATE.fitMode = "custom";
  STATE.scale = Math.max(0.25, Math.min(4, STATE.scale + delta));
  STATE.viewMode === "continuous" ? CONTVIEW.renderAll() : renderCurrentPage();
}

function setFitMode(mode) {
  STATE.fitMode = mode;
  STATE.viewMode === "continuous" ? CONTVIEW.renderAll() : renderCurrentPage();
}

function rotatePage() {
  setPageRotation(STATE.currentPage, getPageRotation(STATE.currentPage) + 90);
  THUMBS.rerenderOne(STATE.currentPage);
  STATE.viewMode === "continuous" ? CONTVIEW.renderAll() : renderCurrentPage();
}
