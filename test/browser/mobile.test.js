// 휴대폰(Pixel 7 흉내)에서 손가락으로 써 보는 시험 (node test/browser/mobile.test.js)
const { launch, openPdf } = require("./harness.js");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("✅ " + name); } else { fail++; console.log("❌ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); } };

(async () => {
  const { browser, page, errors } = await launch({ mobile: true });
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const swipe = async (x1, y1, x2, y2, n = 12) => { await touch("touchStart", [[x1, y1]]); for (let i = 1; i <= n; i++) await touch("touchMove", [[x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]]); await touch("touchEnd", []); };
  try {
    await openPdf(page, "sample.pdf");
    ok("휴대폰에서는 처음부터 화면 폭에 맞춰 연다", await page.evaluate(() => STATE.fitMode === "width" && $("pageWrap").getBoundingClientRect().width <= innerWidth));
    ok("가로로 넘치는 화면이 없다 (페이지 전체 가로 스크롤 없음)", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

    // 손가락으로 사각형 그리기
    await page.tap('.tab[data-tab="annot"]');
    await page.tap('.atool[data-tool="rect"]');
    const r = await page.$eval("#pageWrap", (e) => e.getBoundingClientRect().toJSON());
    await swipe(r.left + 60, r.top + 300, r.left + 200, r.top + 380);
    await page.waitForTimeout(200);
    ok("손가락으로 끌어서 사각형을 그린다", (await page.evaluate(() => ANNOTATE.byPage[1].length)) === 1);

    // 선택 도구로 바꾸고 톡 눌러 고르기 → 삭제 막대
    await page.tap('.atool[data-tool="rect"]');
    await page.touchscreen.tap(r.left + 60, r.top + 340);
    await page.waitForTimeout(200);
    ok("주석을 톡 누르면 고르고, 삭제 막대가 뜬다", await page.evaluate(() => !!ANNOTATE.selected && !$("selBar").hidden));
    await page.tap('#selBar [data-sb="del"]');
    ok("삭제 막대의 🗑로 지운다", (await page.evaluate(() => ANNOTATE.byPage[1].length)) === 0);

    // 두 손가락 확대
    const s0 = await page.evaluate(() => STATE.scale);
    const cx = r.left + 180, cy = r.top + 250;
    await touch("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", [[cx - 40 - i * 8, cy], [cx + 40 + i * 8, cy]]);
    await touch("touchEnd", []);
    await page.waitForTimeout(800);
    const s1 = await page.evaluate(() => STATE.scale);
    ok("두 손가락 사이를 3배로 벌리면 약 3배로 확대된다", s1 > s0 * 2.6 && s1 < s0 * 3.4, [s0, s1]);

    // 떠 있는 창을 손가락으로 옮기기
    await page.evaluate(() => ACT.find());
    const b = await page.$eval("#findWin", (w) => w.getBoundingClientRect().toJSON());
    await swipe(b.left + b.width * 0.6, b.top + 20, b.left + b.width * 0.6 - 30, b.top + 220, 20);
    const a = await page.$eval("#findWin", (w) => w.getBoundingClientRect().toJSON());
    ok("떠 있는 창을 손가락으로 위아래·좌우로 옮길 수 있다", Math.abs(a.top - b.top - 200) < 4 && Math.abs(a.left - b.left + 30) < 4, [b.left, b.top, a.left, a.top]);
    ok("창은 화면 폭을 넘지 않는다", a.width <= (await page.evaluate(() => innerWidth)));
    await page.waitForTimeout(600); // (시험 브라우저는 바로 다음 톡을 두 번 누르기로 착각해서 잠깐 쉬어요)
    await page.tap("#findWin .x");

    // 파일 메뉴 → 하위 메뉴는 눌러서 펼친다
    await page.tap("#fileBtn");
    await page.tap("#fileMenu .has-sub");
    ok("파일 메뉴의 '문서 시작 도우미'를 누르면 하위 메뉴가 펼쳐진다", await page.evaluate(() => getComputedStyle(document.querySelector("#fileMenu .has-sub .sub")).display !== "none"));
    await page.tap("#fileBtn");

    // 연속 보기에서 스크롤하면 현재 쪽 번호가 바뀐다
    await page.evaluate(() => { ACT.fitWidth(); applyViewMode("continuous"); });
    await page.waitForTimeout(700);
    await page.evaluate(() => { $("viewer").scrollTop = $("continuousWrap").querySelector('[data-page="4"]').offsetTop; });
    await page.waitForTimeout(500);
    ok("연속 보기에서 스크롤하면 현재 쪽(4)이 따라온다", (await page.evaluate(() => STATE.currentPage)) === 4);
    ok("휴대폰 연속 보기에서도 화면 근처 쪽만 그린다", (await page.evaluate(() => CONTVIEW.views.filter((v) => v.rendered).length)) <= 5);

    ok("실행 중 자바스크립트 오류가 없다", errors.length === 0, errors);
  } catch (e) { fail++; console.log("❌ 시험 도중 오류: " + e.message); }
  await browser.close();
  console.log(`\n총 ${pass + fail}개 중 ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
