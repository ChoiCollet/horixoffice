/* templates.js — 문서 시작 도우미: 줄 노트·모눈종이·점 모눈·코넬 노트·5선 악보 (A4 세로) */
async function buildTemplatePDF(PL, kind) {
  const { PDFDocument, rgb } = PL;
  const doc = await PDFDocument.create();
  const W = 595.28, H = 841.89, page = doc.addPage([W, H]);
  const gray = (v) => rgb(v, v, v);
  const line = (x1, y1, x2, y2, t, c) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t || 0.6, color: c || gray(0.78) });
  if (kind === "lined") {
    for (let y = H - 70; y > 50; y -= 26) line(40, y, W - 40, y);
    line(78, H - 40, 78, 40, 0.9, rgb(0.88, 0.45, 0.45));
  } else if (kind === "grid") {
    const s = 14.17;
    for (let x = 28; x <= W - 28; x += s) line(x, 28, x, H - 28, 0.4, gray(0.82));
    for (let y = 28; y <= H - 28; y += s) line(28, y, W - 28, y, 0.4, gray(0.82));
  } else if (kind === "dots") {
    const s = 14.17;
    for (let x = 34; x <= W - 30; x += s) for (let y = 34; y <= H - 30; y += s) page.drawCircle({ x, y, size: 0.7, color: gray(0.55) });
  } else if (kind === "cornell") {
    line(30, H - 110, W - 30, H - 110, 1, gray(0.5));          // 제목 아래줄
    line(165, 190, 165, H - 110, 1, gray(0.5));                // 단서 칸 경계
    line(30, 190, W - 30, 190, 1, gray(0.5));                  // 요약 칸 경계
    page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: gray(0.5), borderWidth: 1 });
    for (let y = H - 140; y > 200; y -= 26) line(172, y, W - 34, y, 0.5, gray(0.85));
  } else if (kind === "staff") {
    for (let top = H - 80; top > 70; top -= 62) for (let k = 0; k < 5; k++) line(40, top - k * 7, W - 40, top - k * 7, 0.7, gray(0.2));
  }
  return doc.save();
}

async function makeTemplate(kind, label) {
  showLoading("새 문서를 만드는 중…");
  try {
    const bytes = await buildTemplatePDF(PDFLib, kind);
    await loadPDFFromFile(new File([bytes], `${label}.pdf`, { type: "application/pdf" }));
  } catch (e) { showToast("새 문서를 만드는 중 문제가 발생했어요."); } finally { hideLoading(); }
}
