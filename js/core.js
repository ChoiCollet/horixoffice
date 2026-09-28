/* =========================================================
   core.js — 전역 상태 · PDF 로딩 · 페이지 렌더링
   ========================================================= */

const STATE = {
  pdfDoc: null,        // pdf.js document
  fileBytes: null,     // ArrayBuffer of the original file (for pdf-lib / merge / export)
  fileName: "제목 없음.pdf",
  numPages: 0,
  currentPage: 1,
  scale: 1.2,
  fitMode: "custom",   // 'width' | 'page' | 'custom'
  rotation: 0,          // 0/90/180/270 (전체 문서 회전, 보기용)
  pageViewport: null,   // 마지막 렌더 viewport (캡처/주석 좌표 계산용)
};

function $(id) { return document.getElementById(id); }

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
    const buf = await file.arrayBuffer();
    STATE.fileBytes = buf;
    STATE.fileName = file.name || "제목 없음.pdf";
    $("docTitle").textContent = STATE.fileName + " - HorixOffice";

    const loadingTask = pdfjsLib.getDocument({ data: buf.slice(0) });
    const doc = await loadingTask.promise;

    STATE.pdfDoc = doc;
    STATE.numPages = doc.numPages;
    STATE.currentPage = 1;
    STATE.rotation = 0;
    STATE.fitMode = "custom";
    STATE.scale = 1.2;

    $("empty").style.display = "none";
    $("pageWrap").style.display = "block";
    $("pageTotal").textContent = STATE.numPages;
    $("pageInput").value = 1;

    setControlsEnabled(true);
    ANNOTATE.reset(STATE.numPages);

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

  let viewport = page.getViewport({ scale: STATE.scale, rotation: STATE.rotation });

  if (STATE.fitMode === "width" || STATE.fitMode === "page") {
    const availW = $("viewer").clientWidth - 48;
    const availH = $("viewer").clientHeight - 48;
    const base = page.getViewport({ scale: 1, rotation: STATE.rotation });
    let s;
    if (STATE.fitMode === "width") s = availW / base.width;
    else s = Math.min(availW / base.width, availH / base.height);
    STATE.scale = Math.max(0.2, s);
    viewport = page.getViewport({ scale: STATE.scale, rotation: STATE.rotation });
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
  CAPTURE.onPageRendered(viewport.width, viewport.height);
  THUMBS.setActive(STATE.currentPage);
}

async function goToPage(n) {
  if (!STATE.pdfDoc) return;
  n = Math.max(1, Math.min(STATE.numPages, n));
  if (n === STATE.currentPage) return;
  STATE.currentPage = n;
  await renderCurrentPage();
}

function setZoom(delta) {
  STATE.fitMode = "custom";
  STATE.scale = Math.max(0.25, Math.min(4, STATE.scale + delta));
  renderCurrentPage();
}

function setFitMode(mode) {
  STATE.fitMode = mode;
  renderCurrentPage();
}

function rotatePage() {
  STATE.rotation = (STATE.rotation + 90) % 360;
  renderCurrentPage();
}
