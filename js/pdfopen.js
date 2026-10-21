/* pdfopen.js — pdf.js로 문서 열기 (비밀번호가 걸린 PDF는 물어보고 다시 시도) */
async function openPdfDocument(pdfjs, data, ask) {
  const task = pdfjs.getDocument({ data });
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
  const msg = wrong ? "비밀번호가 맞지 않아요. 다시 입력해 주세요." : "이 PDF는 비밀번호가 필요해요. 비밀번호를 입력해 주세요.";
  return prompt(msg, "");
}
