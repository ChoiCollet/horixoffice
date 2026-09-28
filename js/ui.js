/* ui.js — 탭 드롭다운 메뉴 · 키보드 단축키 · 떠 있는(이동 가능한) 창 */
const NEED = 1, DIS = 2;
function setTr(v) {
  $("transitionSelect").value = v;
  document.querySelectorAll(".tr").forEach((x) => x.classList.toggle("on", x.dataset.tr === v));
}
const fmtDate = (s) => {
  const m = /D:(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?(\d\d)?/.exec(s || "");
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}` : "-";
};
Object.assign(ACT, {
  rotateCCW: () => { STATE.rotation = (STATE.rotation + 270) % 360; renderCurrentPage(); },
  zoomTo: () => {
    const v = parseInt(prompt("확대/축소 비율(%)", Math.round(STATE.scale * 100)), 10);
    if (v >= 25 && v <= 400) { STATE.fitMode = "custom"; STATE.scale = v / 100; renderCurrentPage(); }
  },
  trNone: () => setTr("none"), trSlide: () => setTr("slide"), trFade: () => setTr("fade"),
  docinfo: async () => {
    if (!STATE.pdfDoc) return showToast("먼저 PDF를 열어주세요.");
    const md = await STATE.pdfDoc.getMetadata().catch(() => ({ info: {} })), i = md.info || {};
    const perm = await STATE.pdfDoc.getPermissions().catch(() => null), F = pdfjsLib.PermissionFlag;
    const ok = (f) => (!perm || perm.includes(f) ? "허용" : "제한");
    const row = (k, v) => `<div class="drow"><label>${k}</label><div>${escapeHtml(v || "-")}</div></div>`;
    const n = STATE.fileBytes.byteLength;
    $("dp_g").innerHTML = row("파일 이름", STATE.fileName) + row("종류", "PDF 문서") + row("위치", "브라우저에서 연 파일") +
      row("크기", `${(n / 1048576).toFixed(2)} MB (${n.toLocaleString()} Bytes)`) +
      row("수정한 날짜", new Date(STATE.fileModified).toLocaleString("ko-KR"));
    $("dp_s").innerHTML = row("제목", i.Title) + row("작성자", i.Author) + row("주제", i.Subject) + row("키워드", i.Keywords) +
      row("만든 프로그램", i.Creator) + row("PDF 생성기", i.Producer) + row("PDF 버전", i.PDFFormatVersion) +
      row("만든 날짜", fmtDate(i.CreationDate)) + row("고친 날짜", fmtDate(i.ModDate)) + row("쪽수", STATE.numPages + "쪽");
    $("dp_c").innerHTML = row("암호/권한 제한", perm ? "있음" : "없음") + row("인쇄", ok(F.PRINT)) + row("복사", ok(F.COPY)) +
      row("내용 수정", ok(F.MODIFY_CONTENTS)) + row("주석 수정", ok(F.MODIFY_ANNOTATIONS));
    openModal("docWin"); centerWin($("docWin"));
  },
});
["line", "arrow", "rect", "ellipse", "free", "note", "highlight", "underline", "strike"].forEach((t) => (ACT["tool_" + t] = () => ANNOTATE.setTool(t)));

/* ---- 탭 드롭다운 메뉴 (항목: [이름, 단축키 또는 ">", 동작 또는 하위메뉴, 플래그, 체크조건]) ---- */
const CONV = [["HWP로 변환하기(P)…", "", "convert"], ["DOCX로 변환하기(F)…", "", "convert"], ["PPTX로 변환하기(G)…", "", "convert"], ["XLSX로 변환하기(I)…", "", "convert"], ["그림으로 변환하기(J)…", "", "convert"]];
const MENUS = {
  home: [["복사하기(C)", "Ctrl+C", "soon", NEED], ["모두 선택(S)", "Ctrl+A", "soon", NEED], "-", ["찾기(F)…", "Ctrl+F", "soon", NEED]],
  view: [["프레젠테이션(S)", "F5", "presentStart", NEED],
    ["쪽 보기(V)", ">", [["한 쪽씩 보기", "", "soon"], ["연속 보기", "", "soon"]]],
    ["회전(A)", ">", [["시계 방향 90° 회전", "", "rotate", NEED], ["반시계 방향 90° 회전", "", "rotateCCW", NEED]]], "-",
    ["작업 창(B)", ">", [["문서 정보·최근 파일 표시", "", "pane"]]], ["확대/축소(Z)…", "", "zoomTo", NEED], "-",
    ["주석 표시(T)", "Ctrl+J", "annoToggle", 0, () => ANNOTATE.visible], "-",
    ["도구 상자(C)", ">", [["준비 중", "", "soon"]]]],
  annot: [["주석 표시(T)", "Ctrl+J", "annoToggle", 0, () => ANNOTATE.visible], "-",
    ...[["line", "선 그리기"], ["arrow", "화살표 그리기"], ["rect", "직사각형 그리기"], ["ellipse", "타원 그리기"], ["free", "자유형 그리기"],
      ["note", "스티커노트"], ["highlight", "강조"], ["underline", "밑줄"], ["strike", "취소선"]]
      .map(([t, l]) => [l, "", "tool_" + t, NEED, () => ANNOTATE.tool === t])],
  present: [["처음부터(S)", "F5", "presentStart", NEED], ["현재 쪽부터(A)", "Shift+F5", "present", NEED], "-",
    ["화면 전환(B)", ">", [["없음", "", "trNone", 0, () => $("transitionSelect").value === "none"], ["밀어내기", "", "trSlide", 0, () => $("transitionSelect").value === "slide"], ["밝기 변화", "", "trFade", 0, () => $("transitionSelect").value === "fade"]]],
    ["효과 설정(C)", ">", [["준비 중", "", "soon"]], DIS]],
  tools: [["선택(S)", "Shift+Q", "select", 0, () => ANNOTATE.tool === "select"], ["손도구(H)", "Shift+W", "soon"],
    ["화면 캡처(A)", "Ctrl+Shift+C", "capture", NEED], ["선택 영역 내보내기(E)", "Shift+A", "capture", NEED], "-",
    ["한컴 사전(D)…", "F12", "soon"], "-", ["실시간 검색 설정(B)…", "", "soon"], "-",
    ["쪽 추출하기(C)…", "", "extract", NEED], ["PDF 병합(M)…", "", "merge"], "-", ...CONV],
};
function itemHtml(it) {
  if (it === "-") return "<hr>";
  const [l, k, a, f = 0, chk] = it, sub = Array.isArray(a), dis = (f & DIS) || ((f & NEED) && !STATE.pdfDoc);
  return `<div class="mi${sub ? " has-sub" : ""}${dis ? " dis" : ""}"${sub || dis ? "" : ` data-act="${a}"`}><em>${chk && chk() ? "✓" : ""}</em><span>${l}</span><kbd>${sub ? "›" : k}</kbd>${sub ? `<div class="sub">${a.map(itemHtml).join("")}</div>` : ""}</div>`;
}
const closeDD = () => { $("dd").hidden = true; };
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tabv").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = $("dd"), id = b.dataset.dd, same = !dd.hidden && dd.dataset.cur === id;
    window.closeFileMenu && window.closeFileMenu(); closeDD();
    if (same) return;
    dd.innerHTML = MENUS[id].map(itemHtml).join(""); dd.dataset.cur = id;
    dd.style.left = b.parentElement.offsetLeft + "px"; dd.hidden = false;
  }));
  $("dd").addEventListener("click", (e) => {
    const it = e.target.closest("[data-act]");
    if (it) { closeDD(); ACT[it.dataset.act](); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#dd,.tabv")) closeDD(); });
  $("fileBtn").addEventListener("click", closeDD);
  document.querySelectorAll(".dt").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".dt").forEach((x) => x.classList.toggle("active", x === t));
    ["g", "s", "c"].forEach((k) => ($("dp_" + k).hidden = k !== t.dataset.dt));
  }));
});

/* ---- 떠 있는 창: 드래그로 이동, 클릭하면 맨 앞으로 ---- */
let zTop = 80;
function centerWin(w) {
  if (w.dataset.placed) return;
  w.style.left = Math.max(20, (innerWidth - w.offsetWidth) / 2) + "px"; w.style.top = "70px"; w.dataset.placed = 1;
}
document.querySelectorAll(".fwin").forEach((w) => {
  const h = w.querySelector(".fhead"); let d = null;
  w.addEventListener("pointerdown", () => { w.style.zIndex = ++zTop; });
  h.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    d = { x: e.clientX - w.offsetLeft, y: e.clientY - w.offsetTop }; h.setPointerCapture(e.pointerId);
  });
  h.addEventListener("pointermove", (e) => {
    if (!d) return;
    w.style.left = Math.min(innerWidth - 80, Math.max(80 - w.offsetWidth, e.clientX - d.x)) + "px";
    w.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - d.y)) + "px";
  });
  h.addEventListener("pointerup", () => { d = null; });
});

/* ---- 단축키 ---- */
const SC = { "ctrl+o": "open", "ctrl+p": "print", "ctrl+s": "save", "alt+v": "save", "f5": "presentStart", "shift+f5": "present",
  "ctrl+j": "annoToggle", "shift+q": "select", "ctrl+shift+c": "capture", "shift+a": "capture" };
let chord = 0;
document.addEventListener("keydown", (e) => {
  if ($("presentOverlay").classList.contains("open")) return;
  const mod = e.ctrlKey || e.altKey, key = e.key.toLowerCase();
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
  if (typing && !mod && !/^f\d+$/.test(key)) return;
  if (chord && Date.now() - chord < 1500 && key === "i" && !mod) { chord = 0; e.preventDefault(); return ACT.docinfo(); }
  if (e.ctrlKey && key === "q") { chord = Date.now(); e.preventDefault(); return; }
  const k = (e.ctrlKey ? "ctrl+" : "") + (e.altKey ? "alt+" : "") + (e.shiftKey ? "shift+" : "") + key;
  if (SC[k]) { e.preventDefault(); if (STATE.pdfDoc || SC[k] === "open") ACT[SC[k]](); return; }
  if (!mod && STATE.pdfDoc && key === "arrowleft") ACT.prev();
  if (!mod && STATE.pdfDoc && key === "arrowright") ACT.next();
});
