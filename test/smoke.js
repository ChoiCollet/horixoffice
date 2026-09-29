// jsdom 스모크 테스트: pdf.js/pdf-lib는 스텁으로 대체하고,
// 실제 index.html + js/*.js를 "인라인 스크립트"로 심어 브라우저와 동일하게
// DOMContentLoaded가 정확히 한 번만 자연스럽게 발생하도록 만든다.
// (전에는 스크립트를 나중에 별도로 eval하고 DOMContentLoaded를 수동으로 또 쏴서
//  리스너가 두 번 등록되는 테스트 도구 자체의 버그가 있었음 — 아래에서 고침)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

html = html.replace(/<script src="https:\/\/cdnjs[^>]*><\/script>\s*/g, "");
html = html.replace(/<script>\s*pdfjsLib\.GlobalWorkerOptions[\s\S]*?<\/script>\s*/, "");

const localScripts = [...html.matchAll(/<script src="js\/([a-zA-Z]+\.js)"><\/script>/g)].map((m) => m[1]);
let inline = localScripts
  .map((f) => `<script>\n${fs.readFileSync(path.join(ROOT, "js", f), "utf8")}\n</script>`)
  .join("\n");
// 테스트 전용 브릿지: let/const 전역은 window의 속성이 아니라 공유 렉시컬 스코프에만
// 있으므로, Node 쪽에서 상태를 읽고 조작할 수 있게 참조를 한 번 담아둔다.
inline += `\n<script>window.__t = { STATE, ANNOTATE, ACT, PREFS, RECENT, MERGE, CAPTURE, PRESENT, PRINTMOD, THUMBS, showToast };</script>\n`;
html = html.replace(/<script src="js\/[a-zA-Z]+\.js"><\/script>\s*/g, "");
html = html.replace("</body>", inline + "</body>");

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

const dom = new JSDOM(html, {
  url: "http://localhost/",
  pretendToBeVisual: true,
  runScripts: "dangerously",
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new window.Blob(["fake"], { type: "image/png" })); };
    window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
    window.URL.createObjectURL = () => "blob:fake";
    window.URL.revokeObjectURL = () => {};
    window.Element.prototype.scrollIntoView = () => {}; // jsdom 미구현 (실제 브라우저엔 모두 있음)
    function fakeViewport(w, h) {
      return { width: w, height: h, convertToPdfPoint: (x, y) => [x, y], convertToViewportPoint: (x, y) => [x, y] };
    }
    function fakePage() {
      return {
        getViewport: ({ scale = 1 } = {}) => fakeViewport(595 * scale, 842 * scale),
        render: () => ({ promise: Promise.resolve() }),
      };
    }
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      PermissionFlag: { PRINT: 4, COPY: 16, MODIFY_CONTENTS: 8, MODIFY_ANNOTATIONS: 32 },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 3,
          getPage: () => Promise.resolve(fakePage()),
          getMetadata: () => Promise.resolve({ info: { Title: "테스트 문서", Author: "최서원" } }),
          getPermissions: () => Promise.resolve(null),
        }),
      }),
    };
    window.PDFLib = {
      PDFDocument: {
        create: () => Promise.resolve({ addPage: () => {}, save: () => Promise.resolve(new Uint8Array([1, 2, 3])) }),
        load: () => Promise.resolve({ getPageIndices: () => [0] }),
      },
    };
  },
});
const { window } = dom;

function fire(el, type) { el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })); }
function click(el) { fire(el, "click"); }

async function main() {
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") resolve();
    else window.document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
  const T = window.__t;
  const $ = (id) => window.document.getElementById(id);
  const q = (sel) => window.document.querySelector(sel);

  // 1) 파일 버튼 → 드롭다운 열림
  click($("fileBtn"));
  ok("파일 메뉴가 열린다", $("fileMenu").hidden === false);

  // 2) "다른 이름으로 저장" — 파일이 없을 때 안내 토스트가 뜨는지
  T.STATE.fileBytes = null;
  const saveAsBtn = q('#fileMenu [data-a="saveAs"]');
  ok("파일 메뉴에 다른 이름으로 저장 항목이 있다", !!saveAsBtn);
  click($("fileBtn"));
  if (saveAsBtn) click(saveAsBtn);
  await new Promise((r) => setTimeout(r, 10));
  ok("파일 없이 '다른 이름으로 저장' 클릭 시 안내 토스트가 뜬다", $("toast").textContent.includes("먼저 PDF"), $("toast").textContent);

  // 3) 문서 시작 도우미 하위메뉴 → 빈 문서 만들기(세로)
  const blankBtn = q('#fileMenu [data-a="newBlankP"]');
  ok("문서 시작 도우미 하위메뉴에 '빈 문서 만들기(세로)'가 있다", !!blankBtn);
  if (blankBtn) {
    click($("fileBtn"));
    click(blankBtn);
    await new Promise((r) => setTimeout(r, 30));
    ok("빈 문서 생성 후 STATE.pdfDoc이 설정된다", !!T.STATE.pdfDoc);
    ok("빈 문서 생성 후 페이지 수가 표시된다", $("pageTotal").textContent === "3", $("pageTotal").textContent);
    ok("빈 문서 생성 후 empty 안내가 숨겨진다", $("empty").style.display === "none");
  }

  // 4) 문서 정보 창
  const docinfoBtn = q('#fileMenu [data-a="docinfo"]');
  if (docinfoBtn) {
    click($("fileBtn"));
    click(docinfoBtn);
    await new Promise((r) => setTimeout(r, 10));
    ok("문서 정보 창이 열린다", $("docWin").classList.contains("open"));
    ok("문서 요약에 제목(Title)이 반영된다", $("dp_s").innerHTML.includes("테스트 문서"), $("dp_s").innerHTML.slice(0, 120));
  }

  // 5) 사용자 설정 창
  const settingsBtn = q('#fileMenu [data-a="settings"]');
  click($("fileBtn"));
  click(settingsBtn);
  ok("사용자 설정 창이 열린다", $("settingsWin").classList.contains("open"));
  $("pref_fit").value = "page";
  $("pref_thumbs").checked = false;
  click($("prefSave"));
  const saved = JSON.parse(window.localStorage.getItem("horix_prefs_v1") || "{}");
  ok("설정 저장 시 localStorage에 fit 값이 반영된다", saved.fit === "page", JSON.stringify(saved));
  ok("설정 저장 시 leftPanel 표시가 즉시 반영된다", $("leftPanel").style.display === "none");
  ok("설정 저장 후 창이 닫힌다", !$("settingsWin").classList.contains("open"));

  // 6) 스킨 설정 창
  const skinBtn = q('#fileMenu [data-a="skin"]');
  click($("fileBtn"));
  click(skinBtn);
  const blueSwatch = q('#skinRow [data-color="#2f6fed"]');
  ok("스킨 설정 창에 파랑 스와치가 있다", !!blueSwatch);
  if (blueSwatch) {
    click(blueSwatch);
    click($("skinSave"));
    const v = window.document.documentElement.style.getPropertyValue("--brand").trim();
    ok("스킨 적용 시 --brand 값이 바뀐다", v === "#2f6fed", v);
  }

  // 7) 탭 ∨ 드롭다운 (보기 탭)
  const viewDD = q('.tabv[data-dd="view"]');
  click(viewDD);
  ok("보기 탭 ∨ 드롭다운이 열린다", $("dd").hidden === false);
  ok("보기 탭 드롭다운에 '주석 표시' 항목이 있다", $("dd").innerHTML.includes("주석 표시(T)"));

  // 8) 단축키 — Ctrl+S 처리 중 예외 없이 실행되는지
  let threw = null;
  try {
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  } catch (e) { threw = e; }
  ok("Ctrl+S 단축키 처리 중 예외가 발생하지 않는다", !threw, threw && threw.stack);

  // 9) 다른 이름으로 저장 — 이번엔 문서가 있는 상태에서 실제로 파일 다운로드(가짜 URL 생성)까지 가는지
  const origPrompt = window.prompt;
  window.prompt = () => "내가 지정한 이름";
  let anchorClicked = false;
  const origCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const el = origCreateElement(tag);
    if (tag === "a") { const oc = el.click.bind(el); el.click = () => { anchorClicked = true; oc(); }; }
    return el;
  };
  click($("fileBtn"));
  if (saveAsBtn) click(saveAsBtn);
  ok("PDF가 열려 있을 때 '다른 이름으로 저장'을 누르면 다운로드가 트리거된다", anchorClicked);
  window.prompt = origPrompt;

  // 10) 빈 문서 만들기(가로) — 두 번째 항목도 정상 동작하는지
  const blankBtnL = q('#fileMenu [data-a="newBlankL"]');
  if (blankBtnL) {
    click($("fileBtn"));
    click(blankBtnL);
    await new Promise((r) => setTimeout(r, 30));
    ok("빈 문서 만들기(가로)도 문서를 새로 연다", T.STATE.fileName === "새 문서.pdf" && T.STATE.numPages === 3);
  }

  // 11) 최근 파일 — 항목 추가 후 파일 메뉴/우측 패널에 클릭 가능한 버튼으로 나타나는지
  T.RECENT.add("샘플.pdf", 5);
  await new Promise((r) => setTimeout(r, 10));
  const recentBtn = q('#fileMenu [data-a="openRecent"]');
  ok("최근 파일을 추가하면 파일 메뉴에 클릭 가능한 항목이 생긴다", !!recentBtn && recentBtn.dataset.name === "샘플.pdf", recentBtn && recentBtn.outerHTML);
  const rightRecentBtn = q('#recentList [data-a="openRecent"]');
  ok("우측 패널 최근 파일 목록도 클릭 가능한 버튼이다", rightRecentBtn && rightRecentBtn.tagName === "BUTTON");

  // 12) 이 브라우저(jsdom)는 File System Access API 미지원 → 최근 파일 클릭 시 안내만 뜨고 에러는 없어야 함
  if (recentBtn) {
    click($("fileBtn"));
    click(recentBtn);
    await new Promise((r) => setTimeout(r, 10));
    ok(
      "FSA 미지원 환경에서 최근 파일을 클릭하면 재오픈 대신 안내 토스트가 뜬다",
      $("toast").textContent.includes("불러오기") || $("toast").textContent.includes("다시 선택"),
      $("toast").textContent
    );
  }

  // 13) Ctrl+O 단축키 — showOpenFilePicker가 없는 환경에서도 예외 없이 폴백되는지
  let openThrew = null;
  try {
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
  } catch (e) { openThrew = e; }
  ok("Ctrl+O 단축키가 FSA 미지원 환경에서도 예외 없이 폴백된다", !openThrew, openThrew && openThrew.stack);

  // 14) 문서 정보 — 새로 추가된 필드(만든 날짜, PDF 어플리케이션, 문서 구성 등)가 채워지는지
  click($("fileBtn"));
  click(docinfoBtn);
  await new Promise((r) => setTimeout(r, 10));
  ok("문서 정보(일반)에 '만든 날짜' 행이 추가됐다", $("dp_g").innerHTML.includes("만든 날짜"));
  ok("문서 요약에 'PDF 어플리케이션' 라벨이 쓰인다 (기존 '만든 프로그램' 대신)", $("dp_s").innerHTML.includes("PDF 어플리케이션"));
  ok("문서 보안에 '문서 구성' 항목이 있다", $("dp_c").innerHTML.includes("문서 구성"));
  ok("문서 보안에 '접근성을 위한 복사' 항목이 있다", $("dp_c").innerHTML.includes("접근성을 위한 복사"));
  click($("docWin").querySelector('[data-close="docWin"]'));

  // 15) 인쇄 미리보기 페이지 이동 (선택 범위와 무관하게 문서 전체를 넘겨볼 수 있어야 함)
  click($("fileBtn"));
  const printBtn = q('#fileMenu [data-a="print"]');
  click(printBtn);
  await new Promise((r) => setTimeout(r, 10));
  ok("인쇄 창에 페이지 이동 슬라이더가 있다", $("previewSlider").max === "3", $("previewSlider").max);
  click($("nextPreviewPage"));
  await new Promise((r) => setTimeout(r, 10));
  ok("인쇄 미리보기에서 다음 쪽으로 넘어간다", $("previewPageLabel").textContent === "2 / 3", $("previewPageLabel").textContent);
  click($("printWin").querySelector('[data-close="printWin"]'));

  // 16) 문서 닫기 — 주석 등 변경사항이 없을 때는 바로 닫혀야 함
  click($("fileBtn"));
  const closeDocBtn = q('#fileMenu [data-a="closeDoc"]');
  ok("파일 메뉴에 '문서 닫기'가 있다", !!closeDocBtn);
  click(closeDocBtn);
  await new Promise((r) => setTimeout(r, 10));
  ok("변경사항이 없으면 문서 닫기가 확인창 없이 바로 실행된다", !T.STATE.pdfDoc && $("empty").style.display === "" && !$("confirmSaveWin").classList.contains("open"));

  // 17) 문서 닫기 — 주석 등 변경사항이 있으면 저장할지 물어봐야 함 (저장 안 함 선택 시 그대로 닫힘)
  click($("fileBtn"));
  click(q('#fileMenu [data-a="newBlankP"]'));
  await new Promise((r) => setTimeout(r, 30));
  T.ANNOTATE.byPage[1].push({ type: "note", color: "#f2c200", width: 1, p1: [10, 10], text: "테스트" });
  click($("fileBtn"));
  click(q('#fileMenu [data-a="closeDoc"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("주석이 있는 상태에서 문서 닫기를 누르면 저장 여부 확인창이 뜬다", $("confirmSaveWin").classList.contains("open"));
  ok("확인창에 파일명이 들어간 안내 문구가 표시된다", $("confirmSaveMsg").textContent.includes("저장할까요"), $("confirmSaveMsg").textContent);
  click($("confirmSaveNo"));
  await new Promise((r) => setTimeout(r, 10));
  ok("'저장 안 함'을 누르면 확인창이 닫히고 문서도 닫힌다", !$("confirmSaveWin").classList.contains("open") && !T.STATE.pdfDoc);

  // 18) 취소를 누르면 문서가 닫히지 않아야 함
  click($("fileBtn"));
  click(q('#fileMenu [data-a="newBlankP"]'));
  await new Promise((r) => setTimeout(r, 30));
  T.ANNOTATE.byPage[1].push({ type: "note", color: "#f2c200", width: 1, p1: [10, 10], text: "테스트2" });
  click($("fileBtn"));
  click(q('#fileMenu [data-a="closeDoc"]'));
  await new Promise((r) => setTimeout(r, 10));
  click($("confirmSaveCancel"));
  await new Promise((r) => setTimeout(r, 10));
  ok("확인창에서 '취소'를 누르면 문서가 그대로 열려 있다", !!T.STATE.pdfDoc);

  // 19) 끝(quit) — window.close()를 시도하고, 실패하면 안내 토스트를 띄운다
  click($("fileBtn"));
  const quitBtn = q('#fileMenu [data-a="quit"]');
  ok("파일 메뉴에 '끝'이 있다", !!quitBtn);
  let closeCalled = false;
  window.close = () => { closeCalled = true; };
  click(quitBtn); // 이 시점엔 주석이 남아있어(위 18번) 확인창이 먼저 떠야 함
  await new Promise((r) => setTimeout(r, 10));
  ok("끝을 눌러도 저장 여부 확인창이 먼저 뜬다", $("confirmSaveWin").classList.contains("open"));
  click($("confirmSaveNo"));
  await new Promise((r) => setTimeout(r, 400));
  ok("'저장 안 함' 이후 실제로 window.close()가 호출된다", closeCalled);
  ok("탭을 닫지 못하는 환경에서는 안내 토스트가 뜬다", $("toast").textContent.includes("직접 닫아"), $("toast").textContent);

  // 20) 스킨 모드 — 연한 회색/어둡게로 바꾸면 html[data-skin-mode]가 즉시 바뀌는지
  click($("fileBtn"));
  click(q('#fileMenu [data-a="skin"]'));
  const darkRadio = q('input[name="skinMode"][value="dark"]');
  darkRadio.checked = true;
  fire(darkRadio, "change");
  ok("스킨 모드를 '어둡게'로 바꾸면 즉시 미리보기가 반영된다", window.document.documentElement.dataset.skinMode === "dark");
  click($("skinSave"));
  const savedSkin = JSON.parse(window.localStorage.getItem("horix_prefs_v1") || "{}");
  ok("스킨 모드 저장 시 localStorage에도 반영된다", savedSkin.skinMode === "dark", JSON.stringify(savedSkin));
  console.log("\n=== 결과 ===");
  let fail = 0;
  for (const r of results) {
    console.log((r.pass ? "✅" : "❌") + " " + r.name + (r.detail && !r.pass ? `  → ${String(r.detail).slice(0, 200)}` : ""));
    if (!r.pass) fail++;
  }
  console.log(`\n총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("테스트 실행 중 오류:", e); process.exit(1); });
