/* app.js — 리본/메뉴/상태바 이벤트 연결 (data-a 속성 기반) */
const ACT = {
  open: async () => {
    if (typeof FSA_SUPPORTED !== "undefined" && FSA_SUPPORTED) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "PDF 파일", accept: { "application/pdf": [".pdf"] } }],
        });
        const file = await handle.getFile();
        await loadPDFFromFile(file);
        RECENT.saveHandle(file.name, handle);
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    $("fileInput").click();
  },
  save: () => STATE.fileBytes && downloadBytes(STATE.fileBytes, STATE.fileName, "application/pdf"),
  print: () => PRINTMOD.open(),
  zoomIn: () => setZoom(0.15), zoomOut: () => setZoom(-0.15),
  z100: () => { STATE.fitMode = "custom"; STATE.scale = 1; renderCurrentPage(); },
  fitPage: () => setFitMode("page"), fitWidth: () => setFitMode("width"), rotate: rotatePage,
  present: () => PRESENT.open(STATE.currentPage), presentStart: () => PRESENT.open(1),
  merge: () => MERGE.open(), capture: () => CAPTURE.toggle(),
  select: () => ANNOTATE.setTool("select"),
  undo: () => ANNOTATE.undo(), clearPage: () => ANNOTATE.clearPage(), export: () => ANNOTATE.exportPDF(),
  annoToggle: () => {
    ANNOTATE.visible = !ANNOTATE.visible;
    document.querySelectorAll('[data-a="annoToggle"]').forEach((b) => b.classList.toggle("on", ANNOTATE.visible));
    ANNOTATE.redraw();
  },
  pane: () => { const p = $("rightPanel"); p.hidden = !p.hidden; if (STATE.pdfDoc) renderCurrentPage(); },
  first: () => goToPage(1), prev: () => goToPage(STATE.currentPage - 1),
  next: () => goToPage(STATE.currentPage + 1), last: () => goToPage(STATE.numPages),
  close: () => location.reload(),
  fullscreen: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  convert: () => showToast("HWP·DOCX·PPTX·XLSX·그림 변환은 서버가 필요해 아직 지원하지 않아요."),
  soon: () => showToast("아직 준비 중인 기능이에요."),
  extract: async () => {
    const txt = prompt("추출할 쪽 번호 (예: 1,3,5-7)");
    if (!txt) return;
    const pages = parsePageRange(txt, STATE.numPages);
    if (!pages.length) return showToast("올바른 쪽 번호가 아니에요.");
    showLoading("쪽을 추출하는 중…");
    try {
      const src = await PDFLib.PDFDocument.load(STATE.fileBytes);
      const out = await PDFLib.PDFDocument.create();
      (await out.copyPages(src, pages.map((p) => p - 1))).forEach((p) => out.addPage(p));
      downloadBytes(await out.save(), replaceExt(STATE.fileName, "_추출.pdf"), "application/pdf");
    } catch (e) { showToast("쪽 추출 중 문제가 발생했어요."); } finally { hideLoading(); }
  },
};

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#dd")) return; // 탭 ∨ 드롭다운은 ui.js가 자체 처리
    const b = e.target.closest("[data-a]");
    if (!b || !ACT[b.dataset.a]) return;
    closeFileMenu();
    ACT[b.dataset.a](b.dataset.name);
  });

  // 사용자 설정 / 스킨 설정 창
  document.querySelectorAll("#pref_annocolor_row .rcolor, #skinRow .rcolor").forEach((b) =>
    b.addEventListener("click", () => {
      b.parentElement.querySelectorAll(".rcolor").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    }));
  $("prefSave").addEventListener("click", () => {
    PREFS.data.fit = $("pref_fit").value;
    PREFS.data.thumbs = $("pref_thumbs").checked;
    PREFS.data.annoWidth = Number($("pref_annowidth").value);
    const sel = document.querySelector("#pref_annocolor_row .rcolor.selected");
    if (sel) PREFS.data.annoColor = sel.dataset.color;
    PREFS.save();
    if (STATE.pdfDoc) { ANNOTATE.color = PREFS.data.annoColor; ANNOTATE.width = PREFS.data.annoWidth; syncAnnoUI(); }
    closeModal("settingsWin");
    showToast("설정을 저장했어요.");
  });
  $("skinSave").addEventListener("click", () => {
    const sel = document.querySelector("#skinRow .rcolor.selected");
    if (sel) { PREFS.data.skin = sel.dataset.color; PREFS.save(); PREFS.applySkin(); }
    closeModal("skinWin");
    showToast("스킨을 적용했어요.");
  });
  PREFS.applySkin();

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab,.panel").forEach((e) => e.classList.remove("active"));
    t.classList.add("active");
    document.querySelector(`.panel[data-panel="${t.dataset.tab}"]`).classList.add("active");
  }));

  const closeFileMenu = () => { $("fileMenu").hidden = true; $("fileBtn").classList.remove("open"); };
  window.closeFileMenu = closeFileMenu;
  $("fileBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("fileMenu").hidden = !$("fileMenu").hidden;
    $("fileBtn").classList.toggle("open", !$("fileMenu").hidden);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#fileWrap")) closeFileMenu(); });

  $("emptyOpenBtn").addEventListener("click", ACT.open);
  $("fileInput").addEventListener("change", (e) => { if (e.target.files[0]) loadPDFFromFile(e.target.files[0]); e.target.value = ""; });
  $("pageInput").addEventListener("change", (e) => goToPage(parseInt(e.target.value, 10) || 1));
  $("zoomSlider").addEventListener("input", (e) => { STATE.fitMode = "custom"; STATE.scale = e.target.value / 100; renderCurrentPage(); });

  document.querySelectorAll(".tr").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tr").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); $("transitionSelect").value = b.dataset.tr;
  }));

  // 인쇄 창
  $("printWin").addEventListener("input", () => PRINTMOD.updatePreview());
  $("printWin").addEventListener("change", () => PRINTMOD.updatePreview());
  $("executePrint").addEventListener("click", () => PRINTMOD.execute());

  // 주석
  document.querySelectorAll(".atool").forEach((b) => b.addEventListener("click", () => ANNOTATE.setTool(b.dataset.tool)));
  document.querySelectorAll(".rcolor").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".rcolor").forEach((x) => x.classList.remove("selected"));
    b.classList.add("selected"); ANNOTATE.color = b.dataset.color;
  }));
  $("strokeWidth").addEventListener("change", (e) => { ANNOTATE.width = Number(e.target.value); });
  ANNOTATE.initPointerEvents(); CAPTURE.initPointerEvents();

  // 병합 / 프레젠테이션 / 최근 파일
  $("mergeAddBtn").addEventListener("click", () => $("mergeFileInput").click());
  $("mergeFileInput").addEventListener("change", (e) => { if (e.target.files.length) MERGE.addFiles(e.target.files); e.target.value = ""; });
  $("mergeExecute").addEventListener("click", () => MERGE.execute());
  $("presentExit").addEventListener("click", () => PRESENT.close());
  $("clearRecentBtn").addEventListener("click", () => RECENT.clear());

  window.addEventListener("resize", () => { if (STATE.pdfDoc && STATE.fitMode !== "custom") renderCurrentPage(); });
});
