/* =========================================================
   merge.js — 여러 PDF를 순서대로 합쳐서 하나의 PDF로 다운로드
   ========================================================= */

const MERGE = {
  files: [], // { name, buffer }

  open() {
    openModal("mergeOverlay");
    this.render();
  },

  addFiles(fileList) {
    const readers = Array.from(fileList).map(
      (f) => f.arrayBuffer().then((buf) => this.files.push({ name: f.name, buffer: buf }))
    );
    Promise.all(readers).then(() => this.render());
  },

  move(index, dir) {
    const j = index + dir;
    if (j < 0 || j >= this.files.length) return;
    [this.files[index], this.files[j]] = [this.files[j], this.files[index]];
    this.render();
  },

  remove(index) {
    this.files.splice(index, 1);
    this.render();
  },

  render() {
    const ul = $("mergeList");
    ul.innerHTML = "";
    if (!this.files.length) {
      ul.innerHTML = '<li style="justify-content:center;color:#9aa0a8">추가된 파일이 없어요.</li>';
      return;
    }
    this.files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="fname">${i + 1}. ${escapeHtml(f.name)}</span>
        <button class="mvbtn" data-act="up" data-i="${i}" title="위로">▲</button>
        <button class="mvbtn" data-act="down" data-i="${i}" title="아래로">▼</button>
        <button class="mvbtn" data-act="del" data-i="${i}" title="삭제">✕</button>
      `;
      ul.appendChild(li);
    });
  },

  async execute() {
    if (this.files.length < 2) { showToast("합칠 PDF를 2개 이상 추가해 주세요."); return; }
    showLoading("PDF를 합치는 중…");
    try {
      const outDoc = await PDFLib.PDFDocument.create();
      for (const f of this.files) {
        const src = await PDFLib.PDFDocument.load(f.buffer);
        const pages = await outDoc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => outDoc.addPage(p));
      }
      const bytes = await outDoc.save();
      downloadBytes(bytes, "병합된 문서.pdf", "application/pdf");
      showToast("PDF를 합쳐서 다운로드했어요.");
      closeModal("mergeOverlay");
      this.files = [];
    } catch (err) {
      console.error(err);
      showToast("병합 중 문제가 발생했어요. PDF 파일인지 확인해 주세요.");
    } finally {
      hideLoading();
    }
  },
};

document.addEventListener("click", (e) => {
  const act = e.target.getAttribute && e.target.getAttribute("data-act");
  if (!act) return;
  const i = Number(e.target.getAttribute("data-i"));
  if (act === "up") MERGE.move(i, -1);
  else if (act === "down") MERGE.move(i, 1);
  else if (act === "del") MERGE.remove(i);
});
