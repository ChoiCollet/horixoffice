/* app.js — 리본/메뉴/상태바 이벤트 연결 (data-a 속성 기반) */
const ACT = {
  // 저장 안 한 주석이 있으면 먼저 저장할지 물어보고 열어요
  open: () => withUnsavedCheck(ACT._openPicker),
  _openPicker: async () => {
    if (typeof FSA_SUPPORTED !== "undefined" && FSA_SUPPORTED) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "PDF 파일", accept: { "application/pdf": [".pdf"] } }],
        });
        const file = await handle.getFile();
        await loadPDFFromFile(file);
        STATE.fileHandle = handle;
        RECENT.saveHandle(file.name, handle);
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    $("fileInput").click();
  },
  save: () => saveDocument(false),
  saveAs: () => saveDocument(true),
  print: () => PRINTMOD.open(),
  zoomIn: () => setZoom(0.15), zoomOut: () => setZoom(-0.15),
  z100: () => { STATE.fitMode = "custom"; STATE.scale = 1; refreshView(); },
  fitPage: () => setFitMode("page"), fitWidth: () => setFitMode("width"), rotate: rotatePage,
  merge: () => MERGE.open(), capture: () => CAPTURE.toggle(),
  select: () => ANNOTATE.setTool("select"),
  undo: () => ANNOTATE.undo(), redo: () => ANNOTATE.redo(), clearPage: () => ANNOTATE.clearPage(), clearAll: async () => { if (!ANNOTATE.hasAny()) return showToast("지울 주석이 없어요."); if (await DLG.confirm("모든 쪽의 주석을 지울까요? (실행 취소로 되돌릴 수 있어요)", { ok: "모두 지우기" })) ANNOTATE.clearAll(); }, export: () => saveDocument(true),
  annoToggle: () => {
    ANNOTATE.setVisible(!ANNOTATE.visible);
  },
  pane: () => { const p = $("rightPanel"); p.hidden = !p.hidden; refreshView(); },
  // 두 쪽 보기에서는 두 쪽씩 넘겨요
  first: () => goToPage(1), prev: () => goToPage(STATE.currentPage - (STATE.viewMode === "two" ? 2 : 1)),
  next: () => goToPage(STATE.currentPage + (STATE.viewMode === "two" ? 2 : 1)), last: () => goToPage(STATE.numPages),
  close: () => location.reload(),
  fullscreen: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  convert: () => showToast("HWP·DOCX·PPTX·XLSX·그림 변환은 서버가 필요해 아직 지원하지 않아요."),
};

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#dd")) return; // 탭 ∨ 드롭다운은 ui.js가 자체 처리
    const b = e.target.closest("[data-a]");
    if (!b || !ACT[b.dataset.a]) return;
    closeFileMenu();
    ACT[b.dataset.a](b.dataset.name);
  });

  // 사용자 설정 / 스킨 설정 창 (색상 스와치는 ui.js가 위임 방식으로 처리 — 나중에 추가되는 사용자 정의 색도 즉시 동작해야 하므로)
  $("prefSave").addEventListener("click", () => {
    PREFS.data.fit = $("pref_fit").value;
    PREFS.data.thumbs = $("pref_thumbs").checked;
    PREFS.data.annoWidth = Number($("pref_annowidth").value);
    PREFS.data.embedSession = $("pref_embed").checked;
    const sel = document.querySelector("#pref_annocolor_row .rcolor.selected");
    if (sel) PREFS.data.annoColor = sel.dataset.color;
    PREFS.save();
    $("leftPanel").style.display = PREFS.data.thumbs ? "" : "none";
    if (STATE.pdfDoc) { ANNOTATE.color = PREFS.data.annoColor; ANNOTATE.width = PREFS.data.annoWidth; ANNOTATE.pickedColor = true; syncAnnoUI(); }
    closeModal("settingsWin");
    showToast("설정을 저장했어요.");
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

  $("emptyOpenBtn").addEventListener("click", () => ACT.open());
  // 리본이 화면보다 길면 마우스 휠로도 옆으로 밀어 볼 수 있게
  document.querySelectorAll("#ribbon .panel, #quick, #tabScroller").forEach((el) => el.addEventListener("wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
    e.preventDefault(); el.scrollLeft += e.deltaY;
  }, { passive: false }));

  // 파일을 끌어다 놓아서 열기 (여러 개를 놓으면 PDF 병합 창에 넣어요)
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  document.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add("dropping"); });
  document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dropping"); } });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove("dropping");
    const pdfs = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!pdfs.length) return showToast("PDF 파일만 열 수 있어요.");
    if (e.target.closest && e.target.closest("#mergeWin")) return MERGE.addFiles(pdfs);
    if (pdfs.length > 1) { MERGE.open(); MERGE.addFiles(pdfs); return; }
    withUnsavedCheck(() => loadPDFFromFile(pdfs[0]));
  });
  $("fileInput").addEventListener("change", (e) => { if (e.target.files[0]) loadPDFFromFile(e.target.files[0]); e.target.value = ""; });
  $("pageInput").addEventListener("change", (e) => goToPage(parseInt(e.target.value, 10) || 1));
  $("zoomSlider").addEventListener("input", (e) => { STATE.fitMode = "custom"; STATE.scale = e.target.value / 100; refreshView(); });


  // 인쇄 창
  $("printWin").addEventListener("input", () => PRINTMOD.updatePreview());
  $("printWin").addEventListener("change", () => PRINTMOD.updatePreview());
  $("executePrint").addEventListener("click", () => PRINTMOD.execute());
  document.querySelectorAll("#printWin .prn[data-target]").forEach((b) => b.addEventListener("click", () => PRINTMOD.setTarget(b.dataset.target)));
  $("printToFile").addEventListener("change", (e) => PRINTMOD.setTarget(e.target.checked ? "pdf" : "printer"));
  $("previewSlider").addEventListener("input", (e) => PRINTMOD.setPreviewPage(Number(e.target.value)));
  $("prevPreviewPage").addEventListener("click", () => PRINTMOD.setPreviewPage(PRINTMOD.previewPage - 1));
  $("nextPreviewPage").addEventListener("click", () => PRINTMOD.setPreviewPage(PRINTMOD.previewPage + 1));

  // 주석
  // 같은 도구를 한 번 더 누르면 선택 도구로 돌아가요
  document.querySelectorAll(".atool").forEach((b) => b.addEventListener("click", () =>
    ANNOTATE.setTool(ANNOTATE.tool === b.dataset.tool ? "select" : b.dataset.tool)));
  // 리본의 색상 스와치만 (설정·스킨 창의 스와치와 섞이지 않게)
  document.querySelectorAll("#colorRow .rcolor").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#colorRow .rcolor").forEach((x) => x.classList.remove("selected"));
    b.classList.add("selected"); ANNOTATE.setColor(b.dataset.color);
  }));
  $("strokeWidth").addEventListener("change", (e) => ANNOTATE.setWidth(Number(e.target.value)));
  ANNOTATE.initPointerEvents(); CAPTURE.initPointerEvents();
  $("viewer").addEventListener("scroll", () => { if (ANNOTATE.selected) ANNOTATE.updateSelBar(); }, { passive: true });

  // 병합 / 프레젠테이션 / 최근 파일
  $("mergeAddBtn").addEventListener("click", () => $("mergeFileInput").click());
  $("mergeFileInput").addEventListener("change", (e) => { if (e.target.files.length) MERGE.addFiles(e.target.files); e.target.value = ""; });
  $("mergeExecute").addEventListener("click", () => MERGE.execute());
  $("mergeRemoveBtn").addEventListener("click", () => MERGE.remove());
  $("mergeUpBtn").addEventListener("click", () => MERGE.move(-1));
  $("mergeDownBtn").addEventListener("click", () => MERGE.move(1));
  $("mergeConfigBtn").addEventListener("click", () => MERGE.openConfig());
  $("mcConfirm").addEventListener("click", () => MERGE.confirmConfig());
  $("mcPrev").addEventListener("click", () => MERGE.setConfigPage(MERGE.previewPage - 1));
  $("mcNext").addEventListener("click", () => MERGE.setConfigPage(MERGE.previewPage + 1));
  $("mcSlider").addEventListener("input", (e) => MERGE.setConfigPage(Number(e.target.value)));
  document.querySelectorAll('input[name="mcRange"]').forEach((r) => r.addEventListener("change", () => {
    if (r.value === "custom") $("mcCustomRange").focus();
  }));
  $("presentExit").addEventListener("click", () => PRESENT.close());
  $("clearRecentBtn").addEventListener("click", () => RECENT.clear());

  // 휴대폰은 스크롤할 때 주소창이 숨었다 나타나면서 높이만 바뀌는 resize가 계속 생겨요.
  // 그때마다 다시 그리면 화면이 튀므로, 폭이 바뀌었을 때(또는 쪽 맞춤에서 높이가 크게 바뀌었을 때)만 다시 그려요.
  let lastW = innerWidth, lastH = innerHeight, rsTm = null;
  window.addEventListener("resize", () => {
    clearTimeout(rsTm);
    rsTm = setTimeout(() => {
      const wChanged = Math.abs(innerWidth - lastW) > 2, hChanged = Math.abs(innerHeight - lastH) > 120;
      if (!wChanged && !(hChanged && STATE.fitMode === "page")) return;
      lastW = innerWidth; lastH = innerHeight;
      if (STATE.pdfDoc && (STATE.fitMode !== "custom" || isMultiView())) refreshView();
    }, 150);
  });
});
