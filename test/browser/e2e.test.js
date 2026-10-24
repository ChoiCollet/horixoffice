// 실제 Chromium으로 주요 기능을 끝까지 눌러 보는 시험 (node test/browser/e2e.test.js)
// 다운로드된 파일은 다시 열어서 내용까지 확인해요.
const fs = require("fs"), path = require("path");
const { launch, openPdf, ROOT } = require("./harness.js");
const PDFLib = require(path.join(ROOT, "node_modules/pdf-lib"));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("✅ " + name); } else { fail++; console.log("❌ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); } };
const OUT = path.join(ROOT, "test/browser/out"); fs.mkdirSync(OUT, { recursive: true });

async function download(page, fn) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), fn()]);
  const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p);
  return p;
}
const drag = async (page, x1, y1, x2, y2) => { await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); };

(async () => {
  const { browser, page, errors } = await launch();
  try {
    // 시험용 브라우저에서는 운영체제 파일 저장 창을 띄울 수 없어서, 그 기능이 없는 브라우저처럼 다운로드로 저장하게 해요
    await page.evaluate(() => { window.showSaveFilePicker = undefined; });
    // ---------- 열기 ----------
    await openPdf(page, "sample.pdf");
    ok("PDF를 열면 8쪽", (await page.evaluate(() => STATE.numPages)) === 8);
    ok("한글 글자가 실제로 그려진다 (CMap)", await page.evaluate(() => {
      const c = $("pdfCanvas"), d = c.getContext("2d").getImageData(0, 0, c.width, Math.round(c.height * 0.3)).data;
      let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++; return dark > 500;
    }));
    ok("글자 층에 글자가 깔린다", (await page.$$eval("#textLayer span", (s) => s.length)) > 10);

    // ---------- 주석: 사각형 그리기 → 선택 → 이동 → 되돌리기 ----------
    await page.click('.tab[data-tab="annot"]');
    await page.click('.atool[data-tool="rect"]');
    const r = await page.$eval("#pageWrap", (e) => e.getBoundingClientRect().toJSON());
    await drag(page, r.left + 100, r.top + 420, r.left + 260, r.top + 520);
    ok("사각형 주석이 생긴다", (await page.evaluate(() => ANNOTATE.byPage[1].length)) === 1);
    await page.click('.atool[data-tool="rect"]'); // 다시 누르면 선택 도구
    ok("같은 도구를 다시 누르면 선택 도구", (await page.evaluate(() => ANNOTATE.tool)) === "select");
    await drag(page, r.left + 100, r.top + 470, r.left + 150, r.top + 500);
    const moved = await page.evaluate(() => ANNOTATE.byPage[1][0].p1[0]);
    ok("선택 도구로 끌면 주석이 움직인다", moved > 100, moved);
    await page.keyboard.press("Control+z");
    ok("Ctrl+Z로 이동이 되돌려진다", Math.abs((await page.evaluate(() => ANNOTATE.byPage[1][0].p1[0])) - moved) > 10);

    // ---------- 형광펜: 글자에 딱 맞게 ----------
    await page.click('.atool[data-tool="highlight"]');
    await drag(page, r.left + 80, r.top + 150, r.left + 400, r.top + 200);
    await page.waitForTimeout(300);
    const hl = await page.evaluate(() => ANNOTATE.byPage[1].filter((s) => s.type === "highlight").length);
    ok("형광펜을 글줄에 맞춰 줄마다 만든다", hl >= 1, hl);
    await page.click('.atool[data-tool="highlight"]');

    // ---------- 썸네일에 주석이 반영된다 ----------
    await page.waitForTimeout(700);
    ok("썸네일 1쪽에 빨간 주석이 보인다", await page.evaluate(() => {
      const c = document.querySelector('.thumb[data-page="1"] canvas'), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) return true; return false;
    }));

    // ---------- 저장(다운로드) → 다시 열어서 주석 편집 이어가기 ----------
    page._dialogAnswer = "저장시험";
    const saved = await download(page, async () => { await page.evaluate(() => { saveDocument(true); }); await page.waitForSelector("#dlgWin.open"); await page.fill("#dlgInput", "저장시험"); await page.click("#dlgOk"); });
    ok("다른 이름으로 저장 → 이름 입력 창 → 다운로드", path.basename(saved) === "저장시험.pdf", path.basename(saved));
    const savedDoc = await PDFLib.PDFDocument.load(fs.readFileSync(saved));
    ok("저장한 PDF는 8쪽", savedDoc.getPageCount() === 8);
    await page.setInputFiles("#fileInput", saved);
    await page.waitForFunction(() => !$("loading").classList.contains("show"));
    await page.waitForTimeout(400);
    ok("다시 열면 주석을 그대로 편집할 수 있다", (await page.evaluate(() => ANNOTATE.byPage[1].length)) >= 2);

    // ---------- 저장 안 한 변경이 있을 때 다른 파일 열기 → 저장 확인 창 ----------
    await page.evaluate(() => { ANNOTATE.addShape({ type: "line", color: "#e2231a", width: 2, p1: [50, 50], p2: [200, 50] }); });
    await page.evaluate(() => ACT.open());
    ok("저장 안 한 주석이 있으면 열기 전에 저장할지 묻는다", await page.evaluate(() => $("confirmSaveWin").classList.contains("open")));
    await page.click("#confirmSaveCancel");

    // ---------- 찾기 ----------
    await page.keyboard.press("Control+f");
    await page.fill("#findText", "Horizon");
    await page.click("#findExecute"); await page.waitForTimeout(300);
    await page.click("#findExecute"); await page.waitForTimeout(500);
    ok("찾기: 다음을 누르면 다음 쪽으로 가고 노란 상자를 그린다", (await page.evaluate(() => [STATE.currentPage, document.querySelectorAll(".findHit.cur").length])).join() === "2,1");
    await page.keyboard.press("Escape");
    ok("Esc로 찾기 창이 닫히고 표시도 지워진다", await page.evaluate(() => !$("findWin").classList.contains("open") && !document.querySelector(".findHit")));

    // ---------- 회전 + 인쇄용 PDF ----------
    await page.evaluate(() => goToPage(1));
    await page.evaluate(() => ACT.rotate());
    await page.evaluate(() => ACT.print()); await page.waitForTimeout(300);
    await page.click('#printWin .prn[data-target="pdf"]');
    ok("HorixOffice PDF를 고르면 '파일로 인쇄'가 켜진다", await page.evaluate(() => $("printToFile").checked && $("executePrint").textContent.startsWith("저장")));
    await page.check('input[name="prange"][value="current"]');
    const printed = await download(page, () => page.click("#executePrint"));
    const pdoc = await PDFLib.PDFDocument.load(fs.readFileSync(printed));
    const sz = pdoc.getPage(0).getSize();
    ok("인쇄용 PDF: 현재 쪽 1장, 회전해서 가로 A4", pdoc.getPageCount() === 1 && Math.round(sz.width) === 842 && Math.round(sz.height) === 595, sz);
    ok("인쇄용 PDF는 그림이 아니라 원래 내용 (용량이 작다)", fs.statSync(printed).size < 200000, fs.statSync(printed).size);

    // ---------- 쪽 추출 ----------
    await page.evaluate(() => ACT.extract());
    await page.check('input[name="exRange"][value="custom"]'); await page.fill("#exCustom", "2-4");
    const ex = await download(page, () => page.click("#extractRun"));
    ok("쪽 추출: 2-4쪽 → 3쪽짜리 PDF", (await PDFLib.PDFDocument.load(fs.readFileSync(ex))).getPageCount() === 3);

    // ---------- 변환: JPG ----------
    await page.evaluate(() => openConvert("J"));
    await page.check('input[name="cvRange"][value="current"]');
    const jpg = await download(page, () => page.click("#convertRun"));
    const head = fs.readFileSync(jpg).subarray(0, 3);
    ok("JPG로 변환하면 진짜 JPEG 파일", head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff, path.basename(jpg));

    // ---------- 선택 영역 내보내기 ----------
    await page.evaluate(async () => { STATE.pageRotations = {}; await refreshView(); ANNOTATE.dirty = false; ACT.exportRegion(); });
    const r2 = await page.$eval("#pageWrap", (e) => e.getBoundingClientRect().toJSON());
    await drag(page, r2.left + 40, r2.top + 40, r2.left + 400, r2.top + 200);
    await page.waitForTimeout(500);
    ok("영역을 끌면 내보내기 창이 열리고 글자를 읽는다", await page.evaluate(() => $("exportWin").classList.contains("open") && $("exportText").value.length > 3));
    await page.keyboard.press("Escape");

    // ---------- 병합: 지금 연 문서가 먼저 들어 있다 ----------
    await page.evaluate(() => ACT.merge()); await page.waitForTimeout(500);
    ok("병합 창을 열면 지금 연 문서가 첫 번째로 들어 있다", await page.evaluate(() => MERGE.files.length === 1 && MERGE.files[0].current));
    await page.setInputFiles("#mergeFileInput", path.join(ROOT, "test/fixtures/sample_attach.pdf"));
    await page.waitForTimeout(500);
    await page.uncheck("#mergeOpenAfter");
    const merged = await download(page, () => page.click("#mergeExecute"));
    ok("병합 결과 16쪽", (await PDFLib.PDFDocument.load(fs.readFileSync(merged))).getPageCount() === 16);

    // ---------- 보기 방식 ----------
    for (const m of ["continuous", "two", "twoCont"]) {
      await page.evaluate((m) => applyViewMode(m), m); await page.waitForTimeout(700);
      ok(`${m}: 화면 근처 쪽만 그린다`, await page.evaluate(() => CONTVIEW.views.some((v) => v.rendered) && CONTVIEW.views.filter((v) => v.rendered).length <= 8));
    }
    await page.evaluate(() => applyViewMode("two"));
    await page.evaluate(() => goToPage(3)); await page.waitForTimeout(500);
    await page.evaluate(() => ACT.next()); await page.waitForTimeout(500);
    ok("두 쪽 보기에서 다음 → 두 쪽씩 넘어간다 (3 → 5)", (await page.evaluate(() => STATE.currentPage)) === 5);
    await page.evaluate(() => applyViewMode("single"));

    // ---------- Ctrl+휠 확대 ----------
    const s0 = await page.evaluate(() => STATE.scale);
    const vr = await page.$eval("#viewer", (e) => e.getBoundingClientRect().toJSON());
    await page.mouse.move(vr.left + 300, vr.top + 200);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -300); await page.keyboard.up("Control");
    await page.waitForTimeout(700);
    ok("Ctrl+휠로 확대된다", (await page.evaluate(() => STATE.scale)) > s0 * 1.2);
    // 크게 확대해도 쪽 왼쪽 끝까지 스크롤할 수 있다
    await page.evaluate(() => zoomTo(4, 0, 0));
    await page.waitForTimeout(500);
    ok("400%에서도 쪽 왼쪽 끝이 화면 밖으로 잘리지 않는다", await page.evaluate(() => { $("viewer").scrollLeft = 0; return $("pageWrap").getBoundingClientRect().left >= $("viewer").getBoundingClientRect().left - 1; }));
    await page.evaluate(() => ACT.fitWidth());

    // ---------- 프레젠테이션 ----------
    await page.evaluate(() => ACT.presentStart()); await page.waitForTimeout(500);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(1400);
    ok("프레젠테이션: → 로 다음 쪽", (await page.evaluate(() => PRESENT.page)) === 2);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    ok("Esc로 프레젠테이션이 끝나고 그 쪽을 보여준다", await page.evaluate(() => !PRESENT.isOpen && STATE.currentPage === 2));

    // ---------- 문서 정보 날짜 ----------
    await page.evaluate(() => ACT.docinfo()); await page.waitForTimeout(300);
    ok("문서 정보: 날짜가 '2026-10-23 오전 8:16:47' 모양", /\d{4}-\d\d-\d\d (오전|오후) \d{1,2}:\d\d:\d\d/.test(await page.textContent("#dp_g")));
    await page.keyboard.press("Escape");

    // ---------- 암호 PDF: 가려진 입력 창 ----------
    await page.evaluate(() => { ANNOTATE.dirty = false; });
    await page.setInputFiles("#fileInput", path.join(ROOT, "test/fixtures/password.pdf"));
    await page.waitForSelector("#dlgWin.open", { timeout: 8000 });
    ok("암호 PDF는 가려진 입력칸으로 암호를 묻는다", (await page.getAttribute("#dlgInput", "type")) === "password");
    await page.fill("#dlgInput", "0000"); await page.click("#dlgOk");
    await page.waitForTimeout(800);
    ok("틀리면 다시 묻는다", await page.evaluate(() => $("dlgWin").classList.contains("open") && /맞지 않/.test($("dlgMsg").textContent)));
    await page.fill("#dlgInput", "1234"); await page.click("#dlgOk");
    await page.waitForFunction(() => STATE.fileName === "password.pdf" && STATE.pdfDoc && !$("loading").classList.contains("show"), null, { timeout: 10000 });
    ok("맞는 암호를 넣으면 열린다", (await page.evaluate(() => STATE.numPages)) === 8);

    // ---------- 권한 제한 PDF 저장 → 덮어쓰기 대신 다운로드(이미지 방식) ----------
    await openPdf(page, "restricted.pdf");
    await page.evaluate(() => ANNOTATE.addShape({ type: "rect", color: "#e2231a", width: 3, p1: [60, 60], p2: [200, 160] }));
    const rs = await download(page, () => page.evaluate(() => saveDocument(false)));
    ok("권한 제한 PDF도 저장된다 (그림 방식)", (await PDFLib.PDFDocument.load(fs.readFileSync(rs))).getPageCount() === 8);

    ok("실행 중 자바스크립트 오류가 없다", errors.length === 0, errors);
  } catch (e) {
    fail++; console.log("❌ 시험 도중 오류: " + e.message);
  } finally {
    await browser.close();
    fs.rmSync(OUT, { recursive: true, force: true });
    console.log(`\n총 ${pass + fail}개 중 ${pass}개 통과, ${fail}개 실패`);
    process.exit(fail ? 1 : 0);
  }
})();
