/* pdfopen.js — pdf.js로 문서 열기 (비밀번호가 걸린 PDF는 물어보고 다시 시도) */
// 한글 PDF는 글꼴을 파일에 넣지 않은 경우가 많아요(관공서·한글 문서 등). 이때 글자 모양표(CMap)가 없으면 글자가 통째로 안 보여요.
const PDFJS_ASSETS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";
function pdfjsParams(data) {
  return { data, cMapUrl: PDFJS_ASSETS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS_ASSETS + "standard_fonts/" };
}
async function openPdfDocument(pdfjs, data, ask) {
  const task = pdfjs.getDocument(typeof window !== "undefined" && window.document ? pdfjsParams(data) : { data });
  let cancelled = false;
  task.onPassword = (update, reason) => {
    const R = pdfjs.PasswordResponses || { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };
    Promise.resolve(ask(reason === R.INCORRECT_PASSWORD)).then((pw) => {
      if (pw === null || pw === undefined) { cancelled = true; task.destroy(); } else update(pw);
    });
  };
  try { return await task.promise; }
  catch (e) {
    if (cancelled) { const err = new Error("cancelled"); err.cancelled = true; throw err; }
    throw e;
  }
}
function askPdfPassword(wrong) {
  const msg = wrong ? "암호가 맞지 않아요. 다시 입력해 주세요." : "이 문서는 암호로 보호되어 있어요. 문서를 열 암호를 입력해 주세요.";
  if (typeof STATE !== "undefined") STATE.passwordUsed = true;
  if (typeof DLG !== "undefined" && typeof document !== "undefined") { hideLoading(); return DLG.password(msg).then((v) => { showLoading("PDF를 불러오는 중…"); return v; }); }
  return prompt(msg, "");
}
