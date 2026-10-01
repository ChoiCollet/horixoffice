/* =========================================================
   merge.js — 여러 PDF를 순서대로, 그리고 파일별로 원하는 쪽만 골라 합치기
   ========================================================= */

const MERGE = {
  files: [], // { name, buffer, pageCount, sizeBytes, range: 'all'|'custom', customRange }
  selected: -1,
  previewDoc: null, // 설정 창에서 미리보기용으로 연 pdf.js 문서 (선택된 파일)
  previewPage: 1,

  open() {
    openModal("mergeWin"); centerWin($("mergeWin"));
    this.render();
  },

  async addFiles(fileList) {
    showLoading("PDF 정보를 확인하는 중…");
    try {
      for (const f of Array.from(fileList)) {
        const buffer = await f.arrayBuffer();
        let pageCount = 0;
        try { pageCount = (await PDFLib.PDFDocument.load(buffer)).getPageCount(); } catch (e) { /* 손상된 파일은 0쪽으로 표시 */ }
        this.files.push({ name: f.name, buffer, pageCount, sizeBytes: f.size, range: "all", customRange: "" });
      }
    } finally { hideLoading(); }
    this.render();
  },

  select(i) {
    this.selected = i;
    this.render();
  },

  move(dir) {
    const i = this.selected, j = i + dir;
    if (i < 0 || j < 0 || j >= this.files.length) return;
    [this.files[i], this.files[j]] = [this.files[j], this.files[i]];
    this.selected = j;
    this.render();
  },

  remove() {
    if (this.selected < 0) return;
    this.files.splice(this.selected, 1);
    this.selected = -1;
    this.render();
  },

  rangeLabel(f) {
    if (f.range === "all") return "범위: 문서 전체";
    return `범위: ${f.customRange || "-"}`;
  },

  render() {
    const ul = $("mergeList");
    if (!this.files.length) {
      ul.innerHTML = '<div class="wpEmpty" style="padding:14px">추가된 파일이 없어요. + 를 눌러 PDF를 추가하세요.</div>';
    } else {
      ul.innerHTML = this.files.map((f, i) => `
        <li class="${i === this.selected ? "sel" : ""}" data-i="${i}">
          <div class="micon">PDF</div>
          <div class="mmeta">
            <div class="mname">${i + 1}. ${escapeHtml(f.name)}</div>
            <div class="mrange">${this.rangeLabel(f)}</div>
          </div>
          <div class="msize">${f.pageCount}쪽, ${(f.sizeBytes / 1048576).toFixed(2)} MB</div>
        </li>`).join("");
    }
    $("mergeRemoveBtn").disabled = this.selected < 0;
    $("mergeConfigBtn").disabled = this.selected < 0;
    $("mergeUpBtn").disabled = this.selected <= 0;
    $("mergeDownBtn").disabled = this.selected < 0 || this.selected >= this.files.length - 1;
  },

  async openConfig() {
    if (this.selected < 0) return;
    const f = this.files[this.selected];
    showLoading("미리보기를 불러오는 중…");
    try {
      if (!f._previewDoc) f._previewDoc = await pdfjsLib.getDocument({ data: f.buffer.slice(0) }).promise;
      this.previewDoc = f._previewDoc;
      this.previewPage = 1;
      $("mcSlider").max = f.pageCount || 1;
      $("mcSlider").value = 1;
      $("mcFileName").textContent = f.name;
      $("mcFileSize").textContent = `${(f.sizeBytes / 1048576).toFixed(2)} MB`;
      document.querySelector(`input[name="mcRange"][value="${f.range}"]`).checked = true;
      $("mcCustomRange").value = f.customRange || "";
      await this.renderConfigPreview();
      openModal("mergeConfigWin"); centerWin($("mergeConfigWin"));
    } catch (e) {
      showToast("이 파일의 미리보기를 열지 못했어요. 손상된 PDF일 수 있어요.");
    } finally { hideLoading(); }
  },

  async renderConfigPreview() {
    if (!this.previewDoc) return;
    const page = await this.previewDoc.getPage(this.previewPage);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(280 / base.width, 280 / base.height);
    const vp = page.getViewport({ scale });
    const canvas = $("mcPreviewCanvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    $("mcPageLabel").textContent = `${this.previewPage} / ${this.previewDoc.numPages}`;
    $("mcSlider").value = this.previewPage;
  },

  setConfigPage(n) {
    if (!this.previewDoc) return;
    this.previewPage = Math.max(1, Math.min(this.previewDoc.numPages, n));
    this.renderConfigPreview();
  },

  confirmConfig() {
    const f = this.files[this.selected];
    if (!f) return;
    const mode = document.querySelector('input[name="mcRange"]:checked').value;
    if (mode === "custom") {
      const parsed = parsePageRange($("mcCustomRange").value, f.pageCount);
      if (!parsed.length) { showToast("올바른 쪽 번호를 입력해 주세요. 예: 1,3,5-7"); return; }
      f.range = "custom"; f.customRange = $("mcCustomRange").value.trim();
    } else {
      f.range = "all"; f.customRange = "";
    }
    closeModal("mergeConfigWin");
    this.render();
  },

  async execute() {
    if (this.files.length < 2) { showToast("합칠 PDF를 2개 이상 추가해 주세요."); return; }
    showLoading("PDF를 합치는 중…");
    try {
      const outDoc = await PDFLib.PDFDocument.create();
      for (const f of this.files) {
        const src = await PDFLib.PDFDocument.load(f.buffer);
        const indices = f.range === "custom"
          ? parsePageRange(f.customRange, f.pageCount).map((n) => n - 1)
          : src.getPageIndices();
        if (!indices.length) continue;
        const pages = await outDoc.copyPages(src, indices);
        pages.forEach((p) => outDoc.addPage(p));
      }
      const bytes = await outDoc.save();
      downloadBytes(bytes, "병합된 문서.pdf", "application/pdf");
      showToast("PDF를 합쳐서 다운로드했어요.");
      closeModal("mergeWin");
      this.files = []; this.selected = -1;
    } catch (err) {
      console.error(err);
      showToast("병합 중 문제가 발생했어요. PDF 파일인지 확인해 주세요.");
    } finally {
      hideLoading();
    }
  },
};

document.addEventListener("click", (e) => {
  const li = e.target.closest("#mergeList li[data-i]");
  if (li) MERGE.select(Number(li.dataset.i));
});
