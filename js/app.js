/* =========================================================
   app.js — 리본 탭 전환 및 전체 이벤트 연결
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

  /* ---- 리본 탭 전환 ---- */
  document.querySelectorAll(".ribbon-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ribbon-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".ribbon-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`.ribbon-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });

  /* ---- 파일 열기 ---- */
  $("openBtn").addEventListener("click", () => $("fileInput").click());
  $("emptyOpenBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => {
    if (e.target.files[0]) loadPDFFromFile(e.target.files[0]);
    e.target.value = "";
  });

  $("saveOrigBtn").addEventListener("click", () => {
    if (!STATE.fileBytes) return;
    downloadBytes(STATE.fileBytes, STATE.fileName, "application/pdf");
  });

  /* ---- 페이지 이동 ---- */
  $("prevBtn").addEventListener("click", () => goToPage(STATE.currentPage - 1));
  $("nextBtn").addEventListener("click", () => goToPage(STATE.currentPage + 1));
  $("pageInput").addEventListener("change", (e) => goToPage(parseInt(e.target.value, 10) || 1));

  /* ---- 확대/축소/맞춤/회전 ---- */
  $("zoomOutBtn").addEventListener("click", () => setZoom(-0.15));
  $("zoomInBtn").addEventListener("click", () => setZoom(0.15));
  $("fitBtn").addEventListener("click", () => setFitMode("page"));
  $("rotateBtn").addEventListener("click", rotatePage);

  $("v_fitWidth").addEventListener("click", () => setFitMode("width"));
  $("v_fitPage").addEventListener("click", () => setFitMode("page"));
  $("v_100").addEventListener("click", () => { STATE.fitMode = "custom"; STATE.scale = 1; renderCurrentPage(); });
  $("v_toggleThumb").addEventListener("click", () => {
    const el = $("leftPanel");
    el.style.display = (el.style.display === "none") ? "" : "none";
  });
  $("v_toggleAnno").addEventListener("click", (e) => {
    ANNOTATE.visible = !ANNOTATE.visible;
    e.currentTarget.classList.toggle("active", ANNOTATE.visible);
    ANNOTATE.redraw();
  });
  $("v_present").addEventListener("click", () => PRESENT.open(STATE.currentPage));

  /* ---- 인쇄 ---- */
  $("printBtn").addEventListener("click", () => PRINTMOD.open());
  $("rangeSelect").addEventListener("change", (e) => {
    $("customRangeWrap").style.display = e.target.value === "custom" ? "block" : "none";
    PRINTMOD.updatePreview();
  });
  ["customRange", "reversePrint", "orientationSelect", "paperSize", "fitToPage"].forEach((id) => {
    $(id).addEventListener("input", () => PRINTMOD.updatePreview());
    $(id).addEventListener("change", () => PRINTMOD.updatePreview());
  });
  $("executePrint").addEventListener("click", () => PRINTMOD.execute());

  /* ---- 주석 ---- */
  document.querySelectorAll(".atool").forEach((btn) => {
    btn.addEventListener("click", () => ANNOTATE.setTool(btn.dataset.tool));
  });
  document.querySelectorAll(".rcolor").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rcolor").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      ANNOTATE.color = btn.dataset.color;
    });
  });
  $("strokeWidth").addEventListener("change", (e) => { ANNOTATE.width = Number(e.target.value); });
  $("annoUndo").addEventListener("click", () => ANNOTATE.undo());
  $("annoClearPage").addEventListener("click", () => ANNOTATE.clearPage());
  $("annoExport").addEventListener("click", () => ANNOTATE.exportPDF());
  ANNOTATE.initPointerEvents();

  /* ---- 프레젠테이션 ---- */
  $("p_fromStart").addEventListener("click", () => PRESENT.open(1));
  $("p_fromCurrent").addEventListener("click", () => PRESENT.open(STATE.currentPage));
  $("presentExit").addEventListener("click", () => PRESENT.close());

  /* ---- 도구: 병합 ---- */
  $("t_merge").addEventListener("click", () => MERGE.open());
  $("mergeAddBtn").addEventListener("click", () => $("mergeFileInput").click());
  $("mergeFileInput").addEventListener("change", (e) => {
    if (e.target.files.length) MERGE.addFiles(e.target.files);
    e.target.value = "";
  });
  $("mergeExecute").addEventListener("click", () => MERGE.execute());

  /* ---- 도구: 캡처 ---- */
  $("t_capture").addEventListener("click", () => CAPTURE.toggle());
  CAPTURE.initPointerEvents();

  /* ---- 최근 파일 ---- */
  $("clearRecentBtn").addEventListener("click", () => RECENT.clear());

  /* ---- 창 크기 변경 시 fit 모드 재계산 ---- */
  window.addEventListener("resize", () => {
    if (STATE.pdfDoc && STATE.fitMode !== "custom") renderCurrentPage();
  });

  /* ---- 키보드 단축키 (본문 포커스 시) ---- */
  document.addEventListener("keydown", (e) => {
    if ($("presentOverlay").classList.contains("open")) return;
    if (!STATE.pdfDoc) return;
    if (document.activeElement === $("pageInput") || document.activeElement.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft") goToPage(STATE.currentPage - 1);
    if (e.key === "ArrowRight") goToPage(STATE.currentPage + 1);
  });
});
