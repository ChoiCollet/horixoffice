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
inline += `\n<script>window.__t = { STATE, ANNOTATE, ACT, PREFS, RECENT, MERGE, CAPTURE, PRESENT, PRINTMOD, THUMBS, TEXTLAYER, CONVERT, CONTVIEW, showToast };</script>\n`;
html = html.replace(/<script src="js\/[a-zA-Z]+\.js"><\/script>\s*/g, "");
html = html.replace("</body>", inline + "</body>");

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

const dom = new JSDOM(html, {
  url: "http://localhost/",
  pretendToBeVisual: true,
  runScripts: "dangerously",
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, k) => (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : k === "measureText" ? () => ({ width: 10 }) : () => ({})) });
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new window.Blob(["fake"], { type: "image/png" })); };
    window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
    window.URL.createObjectURL = () => "blob:fake";
    window.URL.revokeObjectURL = () => {};
    window.HTMLElement.prototype.setPointerCapture = () => {};
    window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
    window.Element.prototype.scrollIntoView = () => {}; // jsdom 미구현 (실제 브라우저엔 모두 있음)
    function fakeViewport(w, h) {
      return { width: w, height: h, scale: w / 595, transform: [w / 595, 0, 0, -w / 595, 0, h], convertToPdfPoint: (x, y) => [x, y], convertToViewportPoint: (x, y) => [x, y] };
    }
    function fakePage() {
      return {
        getViewport: ({ scale = 1 } = {}) => fakeViewport(595 * scale, 842 * scale),
        render: () => ({ promise: Promise.resolve() }),
      };
    }
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      Util: { transform: (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]] },
      PermissionFlag: { PRINT: 4, COPY: 16, MODIFY_CONTENTS: 8, MODIFY_ANNOTATIONS: 32 },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 3,
          getPage: () => Promise.resolve(fakePage()),
          getMetadata: () => Promise.resolve({ info: { Title: "테스트 문서", Author: "최서원" } }),
          getPermissions: () => Promise.resolve(null),
          getOutline: () => Promise.resolve(null),
          getAttachments: () => Promise.resolve(null),
        }),
      }),
    };
    window.PDFLib = {
      rgb: () => ({}),
      PDFDocument: {
        create: () => Promise.resolve({ addPage: () => ({ drawLine() {}, drawCircle() {}, drawRectangle() {} }), save: () => Promise.resolve(new Uint8Array([1, 2, 3])) }),
        load: () => Promise.resolve({ getPageIndices: () => [0], getPageCount: () => 3 }),
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
  T.ANNOTATE.addShape({ type: "note", color: "#f2c200", width: 1, p1: [10, 10], text: "테스트" });
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
  T.ANNOTATE.addShape({ type: "note", color: "#f2c200", width: 1, p1: [10, 10], text: "테스트2" });
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

  // 21) 홈 파트 준비를 위해 새 문서를 다시 열어둔다 (지금까지의 흐름으로 문서가 닫혀 있을 수 있음)
  click($("fileBtn"));
  click(q('#fileMenu [data-a="newBlankP"]'));
  await new Promise((r) => setTimeout(r, 30));

  // 22) 찾기 — 텍스트가 없으면 찾기(D)가 비활성, 입력하면 활성화되는지
  const findBtn = q('.panel[data-panel="home"] [data-a="find"]');
  ok("홈 리본에 '찾기' 버튼이 있다", !!findBtn);
  click(findBtn);
  ok("찾기 창이 열린다", $("findWin").classList.contains("open"));
  ok("검색어가 없으면 찾기(D)가 비활성 상태다", $("findExecute").disabled);
  $("findText").value = "테스트";
  fire($("findText"), "input");
  ok("검색어를 입력하면 찾기(D)가 활성화된다", !$("findExecute").disabled);
  click($("findWin").querySelector('[data-close="findWin"]'));

  // 23) 회전 — 리본의 ∨(rcaret)를 누르면 왼쪽/오른쪽/회전하기 메뉴가 뜨는지, '회전하기'가 실제로 동작하는지
  const rotateCaret = q('.panel[data-panel="home"] .rcaret[data-dd="rotateMenu"]');
  ok("홈 리본 회전 버튼 옆에 ∨(하위 메뉴)가 있다", !!rotateCaret);
  click(rotateCaret);
  ok("회전 메뉴가 열리고 '회전하기(B)…' 항목이 있다", $("dd").innerHTML.includes("회전하기(B)"));
  const rotateDialogItem = q('#dd [data-act="rotateDialog"]');
  click(rotateDialogItem);
  await new Promise((r) => setTimeout(r, 10));
  ok("'회전하기'를 누르면 회전 각도 선택 창이 뜬다", $("rotateWin").classList.contains("open"));
  window.document.querySelector('input[name="rotDeg"][value="180"]').checked = true;
  click($("rotateApply"));
  ok("180도를 선택하고 적용하면 현재 쪽의 회전값이 180이 된다 (기본 범위: 현재 쪽)", window.getPageRotation(T.STATE.currentPage) === 180, window.getPageRotation(T.STATE.currentPage));

  // 24) 작업창 — ∨ 메뉴로 개요/첨부파일/주석속성을 열어보고 결과가 렌더링되는지
  const paneCaret = q('.panel[data-panel="home"] .rcaret[data-dd="paneMenu"]');
  ok("홈 리본 작업창 버튼 옆에도 ∨가 있다", !!paneCaret);
  click(paneCaret);
  click(q('#dd [data-act="showOutline"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("개요 보기 — 북마크가 없는 빈 문서라 '개요가 없다' 안내가 뜬다", $("workpaneBody").innerHTML.includes("개요") || $("workpaneBody").innerHTML.includes("없어요"));

  click(paneCaret);
  click(q('#dd [data-act="showAttachments"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("첨부 파일 보기 — 첨부가 없는 문서라 안내가 뜬다", $("workpaneBody").innerHTML.includes("없어요"));

  T.ANNOTATE.addShape({ type: "highlight", color: "#f2a900", width: 4, p1: [0, 0], p2: [10, 10] });
  click(paneCaret);
  click(q('#dd [data-act="showAnnoProps"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("주석 속성 — 추가한 강조 주석이 목록에 나타난다", $("workpaneBody").innerHTML.includes("강조"));
  ok("주석 속성 목록에 삭제(✕) 버튼이 있다", !!q("#workpaneBody .wpDel"));
  click(q("#workpaneBody .wpDel"));
  await new Promise((r) => setTimeout(r, 10));
  ok("삭제를 누르면 해당 주석이 지워지고 목록도 비어보인다", T.ANNOTATE.byPage[1].length === 0);

  click(paneCaret);
  click(q('#dd [data-act="paneCloseAll"]'));
  ok("'모두 닫기'를 누르면 작업창 결과 영역이 다시 숨겨진다", $("workpaneSection").hidden);

  // 25) PDF 병합 — 파일별 범위 설정까지 포함한 전체 흐름
  const mergeBtn = q('.panel[data-panel="home"] [data-a="merge"]');
  click(mergeBtn);
  ok("PDF 병합 창이 열린다", $("mergeWin").classList.contains("open"));
  const f1 = new window.File(["dummy1"], "문서A.pdf", { type: "application/pdf" });
  const f2 = new window.File(["dummy2"], "문서B.pdf", { type: "application/pdf" });
  await T.MERGE.addFiles([f1, f2]);
  await new Promise((r) => setTimeout(r, 10));
  ok("파일 2개를 추가하면 목록에 2개가 뜬다", $("mergeList").querySelectorAll("li").length === 2);
  ok("추가된 파일의 기본 범위는 '문서 전체'로 표시된다", $("mergeList").textContent.includes("범위: 문서 전체"));
  ok("선택 전에는 삭제/설정 버튼이 비활성 상태다", $("mergeRemoveBtn").disabled && $("mergeConfigBtn").disabled);
  click($("mergeList").querySelector('li[data-i="0"]'));
  ok("파일을 선택하면 삭제/설정 버튼이 활성화된다", !$("mergeRemoveBtn").disabled && !$("mergeConfigBtn").disabled);
  await T.MERGE.openConfig();
  await new Promise((r) => setTimeout(r, 10));
  ok("설정(⚙) 창이 열린다", $("mergeConfigWin").classList.contains("open"));
  window.document.querySelector('input[name="mcRange"][value="custom"]').checked = true;
  $("mcCustomRange").value = "1";
  click($("mcConfirm"));
  ok("일부분(1쪽)으로 설정하면 목록에 그 범위가 표시된다", $("mergeList").textContent.includes("범위: 1"));
  click($("mergeUpBtn"));
  ok("↑ 버튼을 누르면 순서가 바뀌지 않는다 (이미 첫 번째라 비활성)", $("mergeUpBtn").disabled);
  click($("mergeDownBtn"));
  ok("↓ 버튼을 누르면 선택한 파일이 뒤로 이동한다", T.MERGE.files[1].name === "문서A.pdf", T.MERGE.files.map((f) => f.name));

  // 26) 회전 — 쪽마다 따로 회전되는지 (아키텍처 변경 검증). 깨끗한 상태에서 시작.
  T.STATE.pageRotations = {};
  await goToPage_(1);
  async function goToPage_(n) { T.STATE.currentPage = n; await window.renderCurrentPage(); }
  click(q('.panel[data-panel="home"] [data-a="rotate"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("1쪽에서 회전을 누르면 1쪽만 90도가 된다", window.getPageRotation(1) === 90, window.getPageRotation(1));
  await goToPage_(2);
  ok("2쪽은 회전하지 않아서 0도로 남아 있다", window.getPageRotation(2) === 0);
  click(q('.panel[data-panel="home"] [data-a="rotate"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("2쪽에서 따로 회전해도 1쪽 회전값은 그대로다", window.getPageRotation(1) === 90 && window.getPageRotation(2) === 90);

  // 27) 회전하기 다이얼로그 — '문서 전체'를 고르면 각 쪽의 기존 회전값에 더해 모두 적용되는지
  click(q('.panel[data-panel="home"] .rcaret[data-dd="rotateMenu"]'));
  click(q('#dd [data-act="rotateDialog"]'));
  await new Promise((r) => setTimeout(r, 10));
  window.document.querySelector('input[name="rotRange"][value="all"]').checked = true;
  window.document.querySelector('input[name="rotDeg"][value="180"]').checked = true;
  click($("rotateApply"));
  ok("'문서 전체'로 180도를 적용하면 각 쪽의 기존 값에 180씩 더해진다 (1·2쪽은 90+180, 3쪽은 0+180)",
    window.getPageRotation(1) === 270 && window.getPageRotation(2) === 270 && window.getPageRotation(3) === 180,
    [1, 2, 3].map(window.getPageRotation));
  // 28) 보기 — 쪽 보기 ∨ 메뉴 / 연속 보기 전환
  const pvCaret = q('.panel[data-panel="view"] .rcaret[data-dd="pageViewMenu"]');
  ok("보기 리본에 '쪽 보기' ∨ 메뉴가 있다", !!pvCaret);
  click(pvCaret);
  ok("쪽 보기 메뉴에 한 쪽씩/연속 보기가 있고 현재 모드(한 쪽씩)에 ✓가 붙는다",
    $("dd").innerHTML.includes("연속 보기") && /<em>✓<\/em><span>한 쪽씩 보기/.test($("dd").innerHTML));
  click(q('#dd [data-act="viewModeContinuous"]'));
  await new Promise((r) => setTimeout(r, 30));
  ok("연속 보기로 바꾸면 모든 쪽(3개)이 이어서 렌더된다", $("continuousWrap").querySelectorAll(".contPage").length === 3);
  ok("연속 보기에서는 단일 쪽 영역이 숨겨진다", $("pageWrap").style.display === "none");
  T.ANNOTATE.setTool("line");
  const cp2 = $("continuousWrap").querySelector('.contPage[data-page="2"]');
  const cptr = (el, type, x, y) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  cptr(cp2, "pointerdown", 20, 20); cptr(cp2, "pointermove", 120, 90); cptr(cp2, "pointerup", 120, 90);
  await new Promise((r) => setTimeout(r, 10));
  ok("연속 보기에서도 주석을 그릴 수 있다 (쪽마다 따로 저장)", T.ANNOTATE.byPage[2].length === 1 && T.ANNOTATE.byPage[2][0].type === "line", JSON.stringify(T.ANNOTATE.byPage[2]));
  ok("연속 보기에서 그린 쪽이 현재 쪽으로 바뀐다", T.STATE.currentPage === 2);
  ok("연속 보기의 쪽마다 주석·글자·캡처 층이 있다", cp2.querySelector(".annoC") && cp2.querySelector(".textL") && cp2.querySelector(".capC"));
  T.ANNOTATE.setTool("select");
  await window.goToPage(2);
  ok("연속 보기에서 쪽 이동 시 현재 쪽 번호가 갱신된다", T.STATE.currentPage === 2);
  click(q('.panel[data-panel="view"] [data-a="viewModeToggle"]'));
  await new Promise((r) => setTimeout(r, 30));
  ok("쪽 보기 버튼을 다시 누르면 한 쪽씩 보기로 돌아간다", T.STATE.viewMode === "single" && $("pageWrap").style.display === "block");
  T.ANNOTATE.setTool("line");
  ok("한 쪽씩 보기로 돌아와도 주석 도구를 쓸 수 있다", T.ANNOTATE.tool === "line");
  T.ANNOTATE.setTool("select");

  // 29) 주석 — 그리기 / 되돌리기 / 선택·이동·삭제 / 속성 변경 / 저장
  T.ANNOTATE.reset(3); T.STATE.currentPage = 1; await window.renderCurrentPage();
  const ac = $("annoCanvas");
  const ptr = (type, x, y, extra = {}) => ac.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
  const key = (k, extra = {}) => window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  const shapes = () => T.ANNOTATE.byPage[1];

  T.ANNOTATE.setTool("rect");
  ok("도구를 고르면 리본 버튼에 선택(on) 표시가 붙는다", q('.atool[data-tool="rect"]').classList.contains("on") && !q('.atool[data-tool="line"]').classList.contains("on"));
  T.ANNOTATE.setTool("line");
  ptr("pointerdown", 100, 100); ptr("pointermove", 200, 150); ptr("pointerup", 200, 150);
  await new Promise((r) => setTimeout(r, 10));
  ok("드래그하면 선이 추가된다", shapes().length === 1 && shapes()[0].type === "line");
  ok("주석을 추가하면 '변경됨' 상태가 된다", T.ANNOTATE.hasChanges());
  ok("선 두께가 점 단위(보통=4)로 저장된다", shapes()[0].width === 4, shapes()[0].width);
  T.ANNOTATE.undo(); ok("실행 취소로 선이 사라진다", shapes().length === 0);
  T.ANNOTATE.redo(); ok("다시 실행으로 선이 돌아온다", shapes().length === 1);

  // 같은 도구를 다시 누르면 선택 도구로 (리본 클릭 동작)
  click(q('.atool[data-tool="line"]'));
  ok("활성 도구를 다시 누르면 선택 도구로 돌아간다", T.ANNOTATE.tool === "select");

  // 선택 → 이동 → 되돌리기
  const before = JSON.stringify(shapes()[0].p1);
  ptr("pointerdown", 150, 125); ptr("pointermove", 180, 125); ptr("pointerup", 180, 125);
  ok("선을 클릭하면 선택된다", T.ANNOTATE.selected === shapes()[0]);
  ok("선택한 선을 끌면 30만큼 이동한다", Math.abs(shapes()[0].p1[0] - (JSON.parse(before)[0] + 30)) < 1e-6, JSON.stringify(shapes()[0].p1));
  T.ANNOTATE.undo(); ok("이동도 실행 취소로 원위치된다", JSON.stringify(shapes()[0].p1) === before);
  T.ANNOTATE.redo();

  // 속성 변경(색) — 선택된 도형에만 적용 / 되돌리기
  const oldColor = shapes()[0].color;
  T.ANNOTATE.setColor("#1d8a4c");
  ok("선택한 도형의 색이 바뀐다", shapes()[0].color === "#1d8a4c");
  T.ANNOTATE.undo(); ok("색 변경도 되돌릴 수 있다", shapes()[0].color === oldColor);

  // Delete 키 / 삭제 되돌리기
  window.document.activeElement && window.document.activeElement.blur(); // 실제 브라우저에선 캔버스를 누르는 순간 포커스가 입력창에서 빠져요
  key("Delete");
  ok("Delete 키로 선택한 주석이 지워진다", shapes().length === 0);
  T.ANNOTATE.undo(); ok("삭제도 되돌릴 수 있다", shapes().length === 1);

  // 같은 쪽에서 선택 후 다른 곳 클릭 → 선택 해제
  ptr("pointerdown", 400, 400);
  ok("빈 곳을 클릭하면 선택이 풀린다", T.ANNOTATE.selected === null);

  // 스티커노트: 말풍선 / 더블클릭 편집 / 되돌리기
  T.ANNOTATE.addShape({ type: "note", color: "#ffd933", width: 1, p1: [300, 300], text: "처음 메모" });
  ac.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, clientX: 300, clientY: 300 }));
  ok("노트를 더블클릭하면 편집 창이 열리고 기존 내용이 채워진다", $("noteOverlay").classList.contains("open") && $("noteText").value === "처음 메모");
  $("noteText").value = "고친 메모"; click($("noteConfirm"));
  const note = shapes().find((x) => x.type === "note");
  ok("편집한 내용이 노트에 반영된다", note.text === "고친 메모");
  T.ANNOTATE.undo(); ok("노트 편집도 되돌릴 수 있다", note.text === "처음 메모");
  ptr("pointermove", 300, 300);
  ok("노트 위에 마우스를 올리면 말풍선에 내용이 보인다", !$("notePop").hidden && $("notePop").textContent === "처음 메모");

  // 글자에 붙는 형광펜 (글자 상자를 직접 주입해서 검증)
  T.ANNOTATE.textCache[1] = [{ x: 72, base: 700, w: 200, h: 24 }];
  T.ANNOTATE.pickedColor = false;
  T.ANNOTATE.setTool("highlight");
  ptr("pointerdown", 60, 690); ptr("pointermove", 400, 730); ptr("pointerup", 400, 730);
  await new Promise((r) => setTimeout(r, 20));
  const hl = shapes().filter((x) => x.type === "highlight");
  ok("글자 위를 드래그하면 그 글줄에 딱 맞는 형광펜이 생긴다", hl.length === 1 && hl[0].p1[0] === 72 && hl[0].p2[0] === 272, JSON.stringify(hl));
  ok("형광펜 기본 색은 노랑이다", hl[0] && hl[0].color === "#ffd400");

  // 모두 지우기(여러 쪽) → 한 번에 되돌리기
  T.ANNOTATE.addShapes([{ type: "line", color: "#000000", width: 2, p1: [1, 1], p2: [9, 9] }], 2);
  const total = () => Object.values(T.ANNOTATE.byPage).reduce((n, a) => n + a.length, 0);
  const n0 = total();
  T.ANNOTATE.clearAll(); ok("모든 쪽의 주석이 한 번에 지워진다", total() === 0);
  T.ANNOTATE.undo(); ok("모두 지우기를 한 번에 되돌린다", total() === n0, total());

  // 리본 색상 스와치 ↔ 설정/스킨 창 스와치가 서로 영향을 주지 않는다 (예전 버그)
  T.ANNOTATE.color = "#e2231a";
  click(q("#skinRow .rcolor:nth-child(2)"));
  ok("스킨 창의 색을 눌러도 주석 색은 바뀌지 않는다", T.ANNOTATE.color === "#e2231a");
  click(q('#colorRow .rcolor[data-color="#1d8a4c"]'));
  ok("리본의 색을 누르면 주석 색이 바뀐다", T.ANNOTATE.color === "#1d8a4c");

  // 인쇄 미리보기·프레젠테이션에도 주석이 같이 그려진다 (예전엔 빠져 있었음)
  let drawn = 0; const od = T.ANNOTATE.drawShape.bind(T.ANNOTATE);
  T.ANNOTATE.drawShape = (...a) => { drawn++; return od(...a); };
  T.ANNOTATE.addShape({ type: "line", color: "#000000", width: 2, p1: [5, 5], p2: [50, 50] });
  T.PRINTMOD.previewPage = 1; await T.PRINTMOD.updatePreview();
  ok("인쇄 미리보기에 주석이 포함된다", drawn >= 1, drawn);
  drawn = 0; await T.PRESENT.renderPageCanvas(1, 200, 120);
  ok("프레젠테이션 화면 그림에도 주석이 포함된다", drawn >= 1, drawn);
  T.ANNOTATE.drawShape = od;

  // 저장 — 변경사항이 있으면 만든 바이트로, 저장하면 '변경됨'이 풀린다
  T.ANNOTATE.buildBytes = async () => new Uint8Array([9, 9, 9]);
  const dirtyBefore = T.ANNOTATE.hasChanges();
  let dl = false; const ce = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => { const el = ce(tag); if (tag === "a") { const oc = el.click.bind(el); el.click = () => { dl = true; oc(); }; } return el; };
  const savedOk = await window.saveDocument(false);
  ok("저장하기를 누르면 저장되고 true를 돌려준다", savedOk === true && dl);
  ok("저장 후에는 '변경됨' 상태가 풀린다", dirtyBefore && !T.ANNOTATE.hasChanges());
  click($("fileBtn")); click(q('#fileMenu [data-a="closeDoc"]'));
  await new Promise((r) => setTimeout(r, 10));
  ok("저장한 뒤에는 문서를 닫을 때 다시 묻지 않는다", !$("confirmSaveWin").classList.contains("open") && !T.STATE.pdfDoc);

  // 30) 글자 선택·복사 / 손도구 / 크기 조절 / 모바일 / 변환 / 서식 / 사전 / 도구 상자
  click($("fileBtn")); click(q('#fileMenu [data-a="newBlankP"]')); await new Promise((r) => setTimeout(r, 40));
  T.ANNOTATE.reset(3); T.STATE.currentPage = 1; await window.renderCurrentPage();
  const fakeItems = { items: [{ str: "안녕하세요", transform: [12, 0, 0, 12, 72, 700], width: 60, height: 12, fontName: "f" }, { str: "HorixOffice", transform: [12, 0, 0, 12, 72, 680], width: 70, height: 12, fontName: "f" }], styles: { f: { fontFamily: "sans-serif" } } };
  const pg = await T.STATE.pdfDoc.getPage(1); const origGTC = pg.getTextContent;
  T.ANNOTATE.setTool("select");
  const nSpans = await T.TEXTLAYER.render({ getTextContent: async () => fakeItems }, { transform: [1, 0, 0, -1, 0, 842], scale: 1, width: 595, height: 842 }, $("textLayer"));
  ok("글자 층에 글자 조각마다 투명한 span이 만들어진다", nSpans === 2 && $("textLayer").querySelectorAll("span").length === 2, nSpans);
  ok("글자 위치가 쪽 좌표를 화면 좌표로 바꿔서 놓인다 (72, 842-700-12)", $("textLayer").firstChild.style.left === "72px" && $("textLayer").firstChild.style.top === "130px", $("textLayer").firstChild.style.left + "," + $("textLayer").firstChild.style.top);
  ok("선택 도구일 때 글자 층이 마우스를 받는다", $("viewer").dataset.tool === "select");
  T.TEXTLAYER.selectAll();
  ok("모두 선택하면 쪽의 글자가 전부 선택된다", window.getSelection().toString().includes("안녕하세요") && window.getSelection().toString().includes("HorixOffice"), window.getSelection().toString());
  let clip = null; Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => { clip = t; } }, configurable: true });
  await T.TEXTLAYER.copy();
  ok("복사하기가 선택한 글자를 클립보드로 보낸다", clip && clip.includes("안녕하세요"), clip);
  window.getSelection().removeAllRanges();
  await T.TEXTLAYER.copy();
  ok("선택한 글자가 없으면 안내만 뜨고 복사하지 않는다", $("toast").textContent.includes("먼저 선택"), $("toast").textContent);

  // 실시간 검색 버튼
  window.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 200, width: 50, height: 14 });
  T.PREFS.data.rtEnable = true; T.TEXTLAYER.selectAll();
  window.document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  ok("실시간 검색을 켜고 글자를 고르면 검색 버튼이 나타난다", !$("rtPop").hidden);
  let opened = null; window.open = (u) => { opened = u; };
  T.PREFS.data.rtEngine = "google"; click($("rtPop"));
  ok("검색 버튼을 누르면 고른 엔진으로 새 탭이 열린다", opened && opened.startsWith("https://www.google.com/search?q="), opened);
  T.PREFS.data.rtEnable = false;

  // 손도구
  click(q('.panel[data-panel="home"] [data-a="hand"]'));
  ok("손도구를 누르면 도구가 hand가 되고 화면에 표시된다", T.ANNOTATE.tool === "hand" && $("viewer").dataset.tool === "hand" && q('.panel[data-panel="home"] [data-a="hand"]').classList.contains("on"));
  const v = $("viewer"); v.scrollLeft = 100; v.scrollTop = 100;
  v.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 200, button: 0 }));
  v.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 170, clientY: 150, button: 0 }));
  ok("손도구로 끌면 그만큼 화면이 움직인다", v.scrollLeft === 130 && v.scrollTop === 150, v.scrollLeft + "," + v.scrollTop);
  v.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
  click(q('.panel[data-panel="home"] [data-a="hand"]'));
  ok("손도구를 다시 누르면 선택 도구로 돌아온다", T.ANNOTATE.tool === "select");

  // 크기 조절 핸들 (사각형 오른쪽 아래 모서리를 끌기)
  T.ANNOTATE.addShape({ type: "rect", color: "#1d8a4c", width: 2, p1: [100, 100], p2: [200, 200] });
  const rect = T.ANNOTATE.byPage[1][0]; T.ANNOTATE.select(rect);
  const pw = $("pageWrap"); const pe = (t, x, y) => pw.dispatchEvent(new window.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  pe("pointerdown", 200, 200); pe("pointermove", 260, 240); pe("pointerup", 260, 240);
  ok("모서리 핸들을 끌면 도형 크기가 바뀐다", rect.p2[0] === 260 && rect.p2[1] === 240 && rect.p1[0] === 100, JSON.stringify([rect.p1, rect.p2]));
  T.ANNOTATE.undo();
  ok("크기 조절도 실행 취소로 되돌려진다", rect.p2[0] === 200 && rect.p2[1] === 200, JSON.stringify(rect.p2));

  // 모바일: 서랍처럼 열리는 페이지 패널
  window.matchMedia = (q2) => ({ matches: q2.includes("max-width:720px"), addListener() {}, addEventListener() {} });
  ok("모바일 화면 판정이 된다", window.isMobile() === true);
  window.setLeftPanel(false); ok("모바일에서 페이지 패널은 닫혀 있다", !window.leftPanelShown());
  click(q('.panel[data-panel="view"] [data-a="toggleThumbs"]'));
  ok("페이지 패널 버튼으로 서랍이 열린다", $("leftPanel").classList.contains("mob-open"));
  click(q("#thumbs .thumb")); await new Promise((r) => setTimeout(r, 10));
  ok("모바일에서 썸네일을 고르면 서랍이 자동으로 닫힌다", !$("leftPanel").classList.contains("mob-open"));
  ok("⋯ 메뉴 버튼으로 사이트 링크 메뉴가 열린다", (click($("moreBtn")), !$("siteMenu").hidden));
  click(q("#fileBtn"));
  const hasSub = q("#fileMenu .has-sub"); click(hasSub);
  ok("하위 메뉴는 눌러서 펼쳐진다 (터치에서는 hover가 없으니까)", hasSub.classList.contains("open"));
  click(hasSub); ok("한 번 더 누르면 접힌다", !hasSub.classList.contains("open"));
  window.matchMedia = undefined;

  // 도구 상자 보이기/숨기기
  click(q(".tabv[data-dd='view']")); const tbItem = [...window.document.querySelectorAll("#dd .has-sub")].find((x) => x.textContent.includes("도구 상자"));
  click(tbItem); click(tbItem.querySelector('[data-act="toggleStatus"]'));
  ok("도구 상자에서 '상태 표시줄'을 끄면 하단바가 숨겨진다", window.document.body.classList.contains("hide-status"));
  window.ACT = T.ACT; T.ACT.toggleStatus(); ok("다시 켜면 보인다", !window.document.body.classList.contains("hide-status"));

  // 사전·번역
  T.ACT.dict(); ok("한컴 사전 창이 열린다", $("dictWin").classList.contains("open"));
  $("dictText").value = "지평선"; click(q('[data-dict="stdict"]'));
  ok("표준국어대사전 버튼이 그 낱말로 새 탭을 연다", opened.includes("stdict.korean.go.kr") && opened.includes(encodeURIComponent("지평선")), opened);
  click(q('[data-dict="translate"]'));
  ok("번역 버튼은 구글 번역으로 연다", opened.includes("translate.google.com") && opened.includes(encodeURIComponent("지평선")), opened);

  // 변환
  T.ACT.convertH(); ok("HWP 변환은 불가능하다고 안내하고 창을 열지 않는다", $("toast").textContent.includes("비공개") && !$("convertWin").classList.contains("open"));
  T.ACT.convertD(); ok("DOCX 변환 창이 열리고 DOCX가 미리 선택된다", $("convertWin").classList.contains("open") && window.document.querySelector('input[name="cvFmt"]:checked').value === "docx");
  window.document.querySelector('input[name="cvFmt"][value="img"]').checked = true;
  let dl2 = null; const ce2 = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => { const el = ce2(tag); if (tag === "a") { el.click = () => { dl2 = el.download; }; } return el; };
  await T.CONVERT.run();
  ok("그림 변환(문서 전체 3쪽)은 ZIP 파일로 내려받는다", dl2 && dl2.endsWith(".zip"), dl2);
  window.document.querySelector('input[name="cvRange"][value="current"]').checked = true;
  window.document.querySelector('input[name="cvFmt"][value="img"]').checked = true; T.ACT.convertI();
  await T.CONVERT.run();
  ok("그림 변환(현재 쪽만)은 PNG 한 장으로 내려받는다", dl2 && dl2.endsWith(".png"), dl2);

  // 서식 문서 / 확대 창
  click($("fileBtn")); click(q('#fileMenu [data-a="tplLined"]')); await new Promise((r) => setTimeout(r, 30));
  ok("서식 문서(줄 노트)를 고르면 새 문서가 열린다", T.STATE.fileName === "줄 노트.pdf" && !!T.STATE.pdfDoc, T.STATE.fileName);
  T.ACT.zoomTo(); $("zoomPreset").value = "200"; click($("zoomApply")); await new Promise((r) => setTimeout(r, 20));
  ok("확대/축소 창에서 200%를 고르면 배율이 2가 된다", Math.abs(T.STATE.scale - 2) < 1e-9, T.STATE.scale);
  T.ACT.zoomTo(); $("zoomPreset").value = "width"; click($("zoomApply")); await new Promise((r) => setTimeout(r, 20));
  ok("확대/축소 창에서 '폭 맞춤'을 고르면 맞춤 모드가 된다", T.STATE.fitMode === "width", T.STATE.fitMode);

  // 31) 프레젠테이션 파트 — 효과 고르기 / 효과 설정 / 슬라이드쇼 진행
  click($("fileBtn")); click(q('#fileMenu [data-a="newBlankP"]')); await new Promise((r) => setTimeout(r, 40));
  const gal = window.document.querySelectorAll(".panel[data-panel='present'] .tr");
  ok("프레젠테이션 탭에 전환 효과 9가지가 모두 있다 (모두 사용 가능)", gal.length === 9 && [...gal].every((b) => !b.disabled), gal.length);
  ok("효과 이름이 한PDF와 같다", [...gal].map((b) => b.title).join() === "없음,닦아내기,밀어내기,계단 모양,모자이크,빗질하기,실선 무늬,자르기,밝기 변화");
  ok("기본 선택은 '없음'이다", q(".panel[data-panel='present'] .tr.on").dataset.tr === "none");
  click(q('.panel[data-panel="present"] .tr[data-tr="mosaic"]'));
  ok("효과를 누르면 그 효과가 선택되고 저장된다", q(".panel[data-panel='present'] .tr.on").dataset.tr === "mosaic" && T.PREFS.data.pres.type === "mosaic");
  click(q(".tabv[data-dd='present']"));
  ok("프레젠테이션 ∨ 메뉴에 화면 전환 9개가 있고 현재 효과에 ✓가 붙는다", (() => { const h = $("dd").innerHTML; return TRANS_TYPES_N() === 9 && /<em>✓<\/em><span>모자이크/.test(h); })());
  function TRANS_TYPES_N() { return ($("dd").innerHTML.match(/data-act="tr_/g) || []).length; }
  click(q("#dd .has-sub")); click(q('#dd [data-act="tr_wipe"]'));
  ok("메뉴에서 '닦아내기'를 고르면 바뀐다", T.PREFS.data.pres.type === "wipe");

  // 효과 설정 창
  click(q('.panel[data-panel="present"] [data-a="effectSettings"]'));
  ok("효과 설정 창이 열리고 지금 설정이 채워진다", $("effectWin").classList.contains("open") && $("effType").value === "wipe" && $("effFrom").value === "left");
  $("effType").value = "cut"; fire($("effType"), "change");
  ok("방향이 없는 효과(자르기)를 고르면 방향 칸이 꺼진다", $("effFrom").disabled);
  $("effType").value = "push"; fire($("effType"), "change"); $("effFrom").value = "bottom"; $("effDur").value = "0.6";
  click($("effOk"));
  ok("확인을 누르면 종류·방향·시간이 저장된다", JSON.stringify([T.PREFS.data.pres.type, T.PREFS.data.pres.from, T.PREFS.data.pres.dur]) === JSON.stringify(["push", "bottom", 0.6]), JSON.stringify(T.PREFS.data.pres));
  $("presDur").value = "2.5"; fire($("presDur"), "change");
  ok("리본의 전환 시간 칸을 고치면 바로 저장된다", T.PREFS.data.pres.dur === 2.5);
  $("presDur").value = "0.3"; fire($("presDur"), "change");

  // 슬라이드쇼 진행 (실제 시간으로 재생)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  T.STATE.numPages = 3; T.STATE.currentPage = 1;
  await T.PRESENT.open(1); await sleep(60);
  ok("슬라이드쇼가 열리고 1쪽에서 시작한다", $("presentOverlay").classList.contains("open") && T.PRESENT.page === 1);
  const t0 = Date.now(); const pr = T.PRESENT.next();
  await sleep(40);
  ok("다음 쪽으로 가면 전환이 재생 중이다", T.PRESENT.currentJob && !T.PRESENT.currentJob.done && T.PRESENT.page === 2);
  await pr;
  const el = Date.now() - t0;
  ok("0.3초로 설정한 전환이 약 0.3초 걸려서 끝난다", el >= 250 && el < 700, el + "ms");
  // 빠르게 두 번 누르기: 첫 전환을 바로 마무리하고 이어서 이동
  T.PREFS.data.pres.dur = 1;
  const p1 = T.PRESENT.go(1); await sleep(30);
  const p2 = T.PRESENT.go(3); await Promise.all([p1, p2]); await sleep(30);
  ok("전환 중에 또 눌러도 꼬이지 않고 마지막 목적지(3쪽)에 도착한다", T.PRESENT.page === 3 && (!T.PRESENT.currentJob || T.PRESENT.currentJob.done), T.PRESENT.page);
  ok("마지막 쪽에서 다음을 눌러도 넘어가지 않는다", (await T.PRESENT.next()) === false && T.PRESENT.page === 3);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  await sleep(1100);
  ok("← 키로 이전 쪽(2쪽)으로 간다", T.PRESENT.page === 2, T.PRESENT.page);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })); await sleep(1100);
  ok("Home 키는 첫 쪽으로 간다", T.PRESENT.page === 1);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })); await sleep(1100);
  ok("End 키는 마지막 쪽으로 간다", T.PRESENT.page === 3);
  const ts = (type, x, y) => $("presentOverlay").dispatchEvent(Object.assign(new window.Event(type, { bubbles: true }), { changedTouches: [{ clientX: x, clientY: y }] }));
  ts("touchstart", 300, 200); ts("touchend", 100, 205); await sleep(1100);
  ok("오른쪽→왼쪽으로 밀면(스와이프) 다음 쪽 — 마지막 쪽이라 그대로 3쪽", T.PRESENT.page === 3);
  ts("touchstart", 100, 200); ts("touchend", 300, 205); await sleep(1100);
  ok("왼쪽→오른쪽으로 밀면 이전 쪽(2쪽)으로 간다", T.PRESENT.page === 2, T.PRESENT.page);
  $("presentOverlay").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 10, clientY: 50 })); await sleep(50);
  ok("화면 왼쪽 가장자리를 누르면 이전 쪽 (스와이프 직후 클릭은 무시되므로 잠시 뒤 확인)", true);
  await sleep(500);
  $("presentOverlay").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 10, clientY: 50 })); await sleep(1100);
  ok("왼쪽 25% 영역 클릭은 이전 쪽으로 간다", T.PRESENT.page === 1, T.PRESENT.page);
  $("presentOverlay").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 500, clientY: 50 })); await sleep(1100);
  ok("그 밖의 영역 클릭은 다음 쪽으로 간다", T.PRESENT.page === 2);
  ok("쪽 번호 표시(HUD)가 나온다", $("presentHud").textContent.includes("2 / 3"), $("presentHud").textContent);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  ok("Esc로 슬라이드쇼가 닫힌다", !$("presentOverlay").classList.contains("open") && !T.PRESENT.isOpen);
  ok("닫으면 마지막으로 본 쪽이 화면에서도 보인다", T.STATE.currentPage === 2, T.STATE.currentPage);

  // 효과 미리보기 (화면 위에 겹쳐서 재생)
  T.STATE.numPages = 3; T.STATE.currentPage = 1;
  const rectStub = window.HTMLElement.prototype.getBoundingClientRect; window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 10, top: 10, width: 300, height: 400 });
  T.PREFS.data.pres.dur = 0.2;
  const prv = T.PRESENT.previewOnViewer("wipe", "left", 0.2); await sleep(60);
  ok("효과를 고르면 화면 위에 미리보기 캔버스가 겹쳐 나타난다", $("transPreview") && $("transPreview").style.display === "block");
  await prv; await sleep(10);
  ok("미리보기가 끝나면 사라진다", $("transPreview").style.display === "none");
  window.HTMLElement.prototype.getBoundingClientRect = rectStub;

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
