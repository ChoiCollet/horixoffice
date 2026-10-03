/* ui.js — 탭 드롭다운 메뉴 · 키보드 단축키 · 떠 있는(이동 가능한) 창 · 사용자 설정/스킨 */
const NEED = 1, DIS = 2;

/* ---- 사용자 설정 (localStorage에 저장돼서 다음에 열 때도 적용) ---- */
const PREFS_KEY = "horix_prefs_v1";
const PREFS = {
  data: Object.assign(
    { fit: "custom", thumbs: true, annoColor: "#e2231a", annoWidth: 4, skin: "#e2231a", skinMode: "light" },
    (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } })()
  ),
  save() { localStorage.setItem(PREFS_KEY, JSON.stringify(this.data)); },
  applySkin() {
    document.documentElement.style.setProperty("--brand", this.data.skin);
    document.documentElement.dataset.skinMode = this.data.skinMode || "light";
  },
};

function syncAnnoUI() {
  document.querySelectorAll(".rcolor[data-color]").forEach((b) => {
    if (!b.closest("#pref_annocolor_row") && !b.closest("#skinRow"))
      b.classList.toggle("selected", b.dataset.color === ANNOTATE.color);
  });
  $("strokeWidth").value = ANNOTATE.width;
}

function makeBlankPDF(orient) {
  return (async () => {
    showLoading("새 문서를 만드는 중…");
    try {
      const doc = await PDFLib.PDFDocument.create();
      doc.addPage(orient === "landscape" ? [841.89, 595.28] : [595.28, 841.89]);
      const bytes = await doc.save();
      await loadPDFFromFile(new File([bytes], "새 문서.pdf", { type: "application/pdf" }));
    } catch (e) { showToast("새 문서를 만드는 중 문제가 발생했어요."); } finally { hideLoading(); }
  })();
}

let pendingCloseAction = null;

function resetDocument() {
  STATE.pdfDoc = null; STATE.fileBytes = null; STATE.fileName = "제목 없음.pdf"; STATE.numPages = 0;
  STATE.currentPage = 1; STATE.pageRotations = {}; STATE.fitMode = "custom"; STATE.scale = 1.2;
  STATE.viewMode = "single"; CONTVIEW.destroy(); $("continuousWrap").hidden = true; $("continuousWrap").classList.remove("show");
  $("pageWrap").style.display = "none"; $("empty").style.display = "";
  $("pageTotal").textContent = "0"; $("pageInput").value = "0";
  $("thumbs").innerHTML = ""; $("thumbCount").textContent = "0";
  $("docTitle").textContent = "HorixOffice";
  $("docInfo").textContent = "파일을 열면 문서 정보가 표시됩니다.";
  setControlsEnabled(false);
  ANNOTATE.reset(0);
  showToast("문서를 닫았어요.");
}

async function attemptQuit() {
  try { window.close(); } catch (e) { /* 무시 */ }
  setTimeout(() => {
    if (!window.closed) showToast("브라우저 정책상 웹페이지가 스스로 탭을 닫을 수 없어요. 이 탭을 직접 닫아 주세요.");
  }, 250);
}

function withUnsavedCheck(proceed) {
  if (STATE.pdfDoc && ANNOTATE.hasAny()) {
    pendingCloseAction = proceed;
    $("confirmSaveMsg").textContent = `${STATE.fileName.replace(/\.pdf$/i, "")}을(를) 저장할까요?`;
    openModal("confirmSaveWin"); centerWin($("confirmSaveWin"));
  } else {
    proceed();
  }
}

Object.assign(ACT, {
  saveAs: () => {
    if (!STATE.fileBytes) return showToast("먼저 PDF를 열어주세요.");
    const base = STATE.fileName.replace(/\.pdf$/i, "");
    const name = prompt("저장할 파일 이름을 입력하세요.", base);
    if (!name) return;
    downloadBytes(STATE.fileBytes, name.replace(/\.pdf$/i, "") + ".pdf", "application/pdf");
  },
  newBlankP: () => makeBlankPDF("portrait"),
  newBlankL: () => makeBlankPDF("landscape"),
  openRecent: (name) => RECENT.openByName(name),
  closeDoc: () => { if (!STATE.pdfDoc) return; withUnsavedCheck(resetDocument); },
  quit: () => withUnsavedCheck(attemptQuit),
  settings: () => {
    $("pref_fit").value = PREFS.data.fit;
    $("pref_thumbs").checked = PREFS.data.thumbs;
    $("pref_annowidth").value = PREFS.data.annoWidth;
    document.querySelectorAll("#pref_annocolor_row .rcolor").forEach((b) =>
      b.classList.toggle("selected", b.dataset.color === PREFS.data.annoColor));
    openModal("settingsWin"); centerWin($("settingsWin"));
  },
  skin: () => {
    document.querySelector(`input[name=skinMode][value="${PREFS.data.skinMode || "light"}"]`).checked = true;
    $("skinCustomRow").hidden = (PREFS.data.skinMode || "light") !== "custom";
    document.querySelectorAll("#skinRow .rcolor").forEach((b) =>
      b.classList.toggle("selected", b.dataset.color === PREFS.data.skin));
    $("skinCustomPicker").value = PREFS.data.skin;
    openModal("skinWin"); centerWin($("skinWin"));
  },
});

/* ---- 찾기 ---- */
const FINDSTATE = { lastPage: null, query: null };
async function performFind() {
  if (!STATE.pdfDoc) return;
  const q = $("findText").value.trim();
  if (!q) return;
  const dir = document.querySelector('input[name="findDir"]:checked').value;
  const caseSensitive = $("findCaseSensitive").checked;
  const norm = (s) => (caseSensitive ? s : s.toLowerCase());
  const target = norm(q);
  const total = STATE.numPages;
  const start = FINDSTATE.query === q ? (FINDSTATE.lastPage || STATE.currentPage) : STATE.currentPage;
  let found = null;
  showLoading("찾는 중…");
  try {
    for (let step = 1; step <= total; step++) {
      const p = dir === "down"
        ? (((start - 1 + step) % total) + total) % total + 1
        : (((start - 1 - step) % total) + total) % total + 1;
      const page = await STATE.pdfDoc.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str).join(" ");
      if (norm(text).includes(target)) { found = p; break; }
    }
  } finally { hideLoading(); }
  if (found) {
    goToPage(found);
    FINDSTATE.lastPage = found; FINDSTATE.query = q;
    if (!Array.from($("findHistory").options).some((o) => o.value === q)) {
      const opt = document.createElement("option"); opt.value = q; $("findHistory").appendChild(opt);
    }
    showToast(`${found}쪽에서 찾았어요.`);
  } else {
    FINDSTATE.query = null;
    showToast("찾을 수 없어요.");
  }
}

/* ---- 작업창: 개요 / 첨부 파일 / 주석 속성 / 탐색 ---- */
const TOOL_LABEL = { line: "선", arrow: "화살표", rect: "직사각형", ellipse: "타원", free: "자유형", highlight: "강조", underline: "밑줄", strike: "취소선", note: "스티커노트" };
function showWorkpane(title, html) {
  $("rightPanel").hidden = false;
  $("workpaneSection").hidden = false;
  $("workpaneTitle").textContent = title;
  $("workpaneBody").innerHTML = html;
  refreshView();
}
async function resolveOutlinePage(dest) {
  try {
    let d = dest;
    if (typeof d === "string") d = await STATE.pdfDoc.getDestination(d);
    if (!d) return null;
    return (await STATE.pdfDoc.getPageIndex(d[0])) + 1;
  } catch (e) { return null; }
}
async function renderOutlineList(items, depth) {
  let html = "";
  for (const o of items) {
    const page = await resolveOutlinePage(o.dest);
    html += `<div class="wpItem" ${page ? `data-page="${page}"` : ""} style="padding-left:${depth * 14}px">
      <span class="wpMain">${escapeHtml(o.title || "(제목 없음)")}</span>${page ? `<span class="wpSub">${page}쪽</span>` : ""}</div>`;
    if (o.items && o.items.length) html += await renderOutlineList(o.items, depth + 1);
  }
  return html;
}

function applyViewMode(mode) {
  if (!STATE.pdfDoc || STATE.viewMode === mode) return;
  STATE.viewMode = mode;
  const cont = mode === "continuous";
  $("pageWrap").style.display = cont ? "none" : "block";
  $("continuousWrap").hidden = !cont;
  $("continuousWrap").classList.toggle("show", cont);
  if (cont) {
    ANNOTATE.setTool("select");
    if (CAPTURE.active) CAPTURE.toggle();
    CONTVIEW.renderAll().then(() => CONTVIEW.scrollToPage(STATE.currentPage));
    showToast("연속 보기에서는 주석 그리기·화면 캡처를 쓸 수 없어요. 한 쪽씩 보기로 돌아오면 다시 쓸 수 있어요.");
  } else {
    CONTVIEW.destroy();
    renderCurrentPage();
  }
}

Object.assign(ACT, {
  viewModeSingle: () => applyViewMode("single"),
  viewModeContinuous: () => applyViewMode("continuous"),
  viewModeToggle: () => applyViewMode(STATE.viewMode === "single" ? "continuous" : "single"),
  find: () => { if (!STATE.pdfDoc) return; openModal("findWin"); centerWin($("findWin")); $("findText").focus(); },
  rotateDialog: () => { if (!STATE.pdfDoc) return; openModal("rotateWin"); centerWin($("rotateWin")); },
  showOutline: async () => {
    if (!STATE.pdfDoc) return;
    showLoading("개요를 불러오는 중…");
    try {
      const outline = await STATE.pdfDoc.getOutline();
      const html = (!outline || !outline.length)
        ? '<div class="wpEmpty">이 PDF에는 개요(북마크)가 없어요.</div>'
        : await renderOutlineList(outline, 0);
      showWorkpane("개요", html);
    } catch (e) { showWorkpane("개요", '<div class="wpEmpty">개요를 불러오지 못했어요.</div>'); }
    finally { hideLoading(); }
  },
  showAttachments: async () => {
    if (!STATE.pdfDoc) return;
    showLoading("첨부 파일을 확인하는 중…");
    try {
      const atts = await STATE.pdfDoc.getAttachments();
      const keys = atts ? Object.keys(atts) : [];
      window.__attachments = atts;
      const html = !keys.length ? '<div class="wpEmpty">첨부된 파일이 없어요.</div>' :
        keys.map((k) => {
          const a = atts[k];
          const kb = a.content ? Math.round(a.content.length / 1024) : 0;
          return `<div class="wpItem" data-att="${escapeHtml(k)}"><span class="wpMain">${escapeHtml(a.filename || k)}</span><span class="wpSub">${kb} KB</span></div>`;
        }).join("");
      showWorkpane("첨부 파일", html);
    } catch (e) { showWorkpane("첨부 파일", '<div class="wpEmpty">첨부 파일을 불러오지 못했어요.</div>'); }
    finally { hideLoading(); }
  },
  showAnnoProps: () => {
    if (!STATE.pdfDoc) return;
    const rows = [];
    Object.keys(ANNOTATE.byPage).forEach((p) => {
      ANNOTATE.byPage[p].forEach((s, i) => rows.push({ page: Number(p), idx: i, type: s.type, color: s.color }));
    });
    rows.sort((a, b) => a.page - b.page);
    const html = !rows.length ? '<div class="wpEmpty">추가된 주석이 없어요.</div>' :
      rows.map((r) => `<div class="wpItem" data-anno-page="${r.page}">
        <span class="wpMain"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${r.color};margin-right:6px"></span>${r.page}쪽 · ${TOOL_LABEL[r.type] || r.type}</span>
        <button class="wpDel" data-anno-del data-anno-page="${r.page}" data-anno-idx="${r.idx}">✕</button></div>`).join("");
    showWorkpane("주석 속성", html);
  },
  showNav: () => {
    if (!STATE.pdfDoc) return;
    $("leftPanel").style.display = "";
    showToast("왼쪽 페이지 탐색 패널을 열었어요.");
  },
  paneCloseAll: () => {
    $("workpaneSection").hidden = true;
    $("workpaneBody").innerHTML = "";
  },
});

function setTr(v) {
  $("transitionSelect").value = v;
  document.querySelectorAll(".tr").forEach((x) => x.classList.toggle("on", x.dataset.tr === v));
}
const fmtDate = (s) => {
  const m = /D:(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?(\d\d)?/.exec(s || "");
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}` : "-";
};
Object.assign(ACT, {
  rotateCCW: () => {
    setPageRotation(STATE.currentPage, getPageRotation(STATE.currentPage) + 270);
    THUMBS.rerenderOne(STATE.currentPage);
    refreshView();
  },
  zoomTo: () => {
    const v = parseInt(prompt("확대/축소 비율(%)", Math.round(STATE.scale * 100)), 10);
    if (v >= 25 && v <= 400) { STATE.fitMode = "custom"; STATE.scale = v / 100; refreshView(); }
  },
  trNone: () => setTr("none"), trSlide: () => setTr("slide"), trFade: () => setTr("fade"),
  docinfo: async () => {
    if (!STATE.pdfDoc) return showToast("먼저 PDF를 열어주세요.");
    const md = await STATE.pdfDoc.getMetadata().catch(() => ({ info: {} })), i = md.info || {};
    const perm = await STATE.pdfDoc.getPermissions().catch(() => null), F = pdfjsLib.PermissionFlag;
    const ok = (f) => (!perm || perm.includes(f) ? "허용" : "제한");
    const row = (k, v) => `<div class="drow"><label>${k}</label><div>${escapeHtml(v || "-")}</div></div>`;
    const n = STATE.fileBytes.byteLength;
    const modified = new Date(STATE.fileModified).toLocaleString("ko-KR");
    $("dp_g").innerHTML =
      `<div class="docTop"><div class="docIcon">PDF</div><div class="drow" style="flex:1"><div>${escapeHtml(STATE.fileName)}</div></div></div>` +
      row("종류", "PDF 문서") + row("위치", "브라우저에서 연 파일") +
      row("크기", `${(n / 1048576).toFixed(2)} MB (${n.toLocaleString()} Bytes)`) +
      '<hr style="border:0;border-top:1px solid #e3e5ea;margin:12px 0">' +
      row("만든 날짜", modified) + row("수정한 날짜", modified);
    $("dp_s").innerHTML = row("제목", i.Title) + row("주제", i.Subject) + row("지은이", i.Author) +
      `<div class="drow tall"><label>키워드</label><div>${escapeHtml(i.Keywords || "-")}</div></div>` +
      '<hr style="border:0;border-top:1px solid #e3e5ea;margin:12px 0">' +
      row("PDF 어플리케이션", i.Creator) + row("PDF 생산자", i.Producer);
    $("dp_c").innerHTML = row("보안 방식", perm ? "보안 있음" : "보안 없음") + row("인쇄", ok(F.PRINT)) +
      row("문서 구성", ok(F.ASSEMBLE)) + row("복사", ok(F.COPY)) + row("접근성을 위한 복사", ok(F.COPY_FOR_ACCESSIBILITY)) +
      row("주석 편집", ok(F.MODIFY_ANNOTATIONS)) + row("양식 필드 채우기", ok(F.FILL_INTERACTIVE_FORMS)) +
      row("서명", ok(F.FILL_INTERACTIVE_FORMS));
    openModal("docWin"); centerWin($("docWin"));
  },
});
["line", "arrow", "rect", "ellipse", "free", "note", "highlight", "underline", "strike"].forEach((t) => (ACT["tool_" + t] = () => ANNOTATE.setTool(t)));

/* ---- 탭 드롭다운 메뉴 (항목: [이름, 단축키 또는 ">", 동작 또는 하위메뉴, 플래그, 체크조건]) ---- */
const CONV = [["HWP로 변환하기(P)…", "", "convert"], ["DOCX로 변환하기(F)…", "", "convert"], ["PPTX로 변환하기(G)…", "", "convert"], ["XLSX로 변환하기(I)…", "", "convert"], ["그림으로 변환하기(J)…", "", "convert"]];
const ROTATE_ITEMS = [
  ["왼쪽으로 90도 회전(R)", "", "rotateCCW", NEED],
  ["오른쪽으로 90도 회전(A)", "", "rotate", NEED],
  "-",
  ["회전하기(B)…", "", "rotateDialog", NEED],
];
const PANE_ITEMS = [
  ["개요 보기(A)", "", "showOutline", NEED],
  ["첨부 파일 보기(B)", "", "showAttachments", NEED],
  ["주석 속성(C)", "", "showAnnoProps", NEED],
  ["탐색(D)", "", "showNav", NEED],
  ["번역(E)", "", "soon"],
  "-",
  ["모두 닫기(F)", "", "paneCloseAll"],
];
const PAGEVIEW_ITEMS = [
  ["한 쪽씩 보기", "", "viewModeSingle", NEED, () => STATE.viewMode === "single"],
  ["연속 보기", "", "viewModeContinuous", NEED, () => STATE.viewMode === "continuous"],
];
const MENUS = {
  home: [["복사하기(C)", "Ctrl+C", "soon", NEED], ["모두 선택(S)", "Ctrl+A", "soon", NEED], "-", ["찾기(F)…", "Ctrl+F", "find", NEED]],
  view: [["프레젠테이션(S)", "F5", "presentStart", NEED],
    ["쪽 보기(V)", ">", PAGEVIEW_ITEMS],
    ["회전(A)", ">", ROTATE_ITEMS], "-",
    ["작업 창(B)", ">", PANE_ITEMS], ["확대/축소(Z)…", "", "zoomTo", NEED], "-",
    ["주석 표시(T)", "Ctrl+J", "annoToggle", 0, () => ANNOTATE.visible], "-",
    ["도구 상자(C)", ">", [["준비 중", "", "soon"]]]],
  pageViewMenu: PAGEVIEW_ITEMS,
  rotateMenu: ROTATE_ITEMS,
  paneMenu: PANE_ITEMS,
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
    const r = b.getBoundingClientRect();
    dd.style.left = Math.round(r.left) + "px";
    dd.style.top = Math.round(r.bottom + 2) + "px";
    dd.hidden = false;
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

  // 도움말(?) 자리표시자
  document.querySelectorAll(".fhelp").forEach((h) => h.addEventListener("click", () => showToast("도움말은 준비 중이에요.")));

  // 주석 기본 색상 / 스킨 강조 색상 스와치 — 위임 방식(나중에 추가되는 사용자 정의 색도 동작하도록)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#pref_annocolor_row .rcolor, #skinRow .rcolor");
    if (!b) return;
    b.parentElement.querySelectorAll(".rcolor").forEach((x) => x.classList.remove("selected"));
    b.classList.add("selected");
    if (b.closest("#skinRow")) {
      document.documentElement.style.setProperty("--brand", b.dataset.color);
      $("skinCustomPicker").value = b.dataset.color;
    }
  });

  // 스킨 설정: 모드 라디오(즉시 미리보기) / 사용자 정의 색 추가·삭제 / 배경 그림
  document.querySelectorAll('input[name="skinMode"]').forEach((r) => r.addEventListener("change", () => {
    document.documentElement.dataset.skinMode = r.value;
    $("skinCustomRow").hidden = r.value !== "custom";
  }));
  $("skinCustomPicker").addEventListener("input", (e) => {
    document.documentElement.style.setProperty("--brand", e.target.value);
    document.querySelectorAll("#skinRow .rcolor").forEach((x) => x.classList.toggle("selected", x.dataset.color === e.target.value));
  });
  $("skinAddCustom").addEventListener("click", () => {
    const c = $("skinCustomPicker").value;
    if (document.querySelector(`#skinRow [data-color="${c}"]`)) return showToast("이미 있는 색이에요.");
    const btn = document.createElement("button");
    btn.className = "rcolor selected"; btn.style.background = c; btn.dataset.color = c;
    document.querySelectorAll("#skinRow .rcolor").forEach((x) => x.classList.remove("selected"));
    $("skinRow").appendChild(btn);
  });
  $("skinRemoveCustom").addEventListener("click", () => {
    const sel = document.querySelector("#skinRow .rcolor.selected");
    if (sel) sel.remove(); else showToast("삭제할 색을 먼저 선택해 주세요.");
  });
  $("skinFilePick").addEventListener("click", () => $("skinFileInput").click());
  $("skinFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $("skinFileName").value = file.name;
      $("skinPreviewBox").style.backgroundImage = `url(${reader.result})`;
      $("skinPreviewBox").textContent = "";
      $("ribbon").style.backgroundImage = `url(${reader.result})`;
    };
    reader.readAsDataURL(file);
  });
  $("skinFileClear").addEventListener("click", () => {
    $("skinFileName").value = ""; $("skinFileInput").value = "";
    $("skinPreviewBox").style.backgroundImage = ""; $("skinPreviewBox").textContent = "";
    $("ribbon").style.backgroundImage = "";
  });
  $("skinSave").addEventListener("click", () => {
    PREFS.data.skinMode = document.querySelector('input[name="skinMode"]:checked').value;
    const sel = document.querySelector("#skinRow .rcolor.selected");
    if (sel) PREFS.data.skin = sel.dataset.color;
    else if (PREFS.data.skinMode === "custom") PREFS.data.skin = $("skinCustomPicker").value;
    PREFS.save();
    PREFS.applySkin();
    closeModal("skinWin");
    showToast("스킨을 적용했어요.");
  });
  // 취소/닫기를 누르면 저장 안 된 미리보기를 되돌림
  $("skinWin").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) PREFS.applySkin(); });

  // 저장 여부 확인 창 (문서 닫기 / 끝 전에 주석 등 변경사항이 있을 때)
  $("confirmSaveYes").addEventListener("click", async () => {
    closeModal("confirmSaveWin");
    await ANNOTATE.exportPDF();
    const fn = pendingCloseAction; pendingCloseAction = null;
    if (fn) fn();
  });
  $("confirmSaveNo").addEventListener("click", () => {
    closeModal("confirmSaveWin");
    const fn = pendingCloseAction; pendingCloseAction = null;
    if (fn) fn();
  });
  $("confirmSaveCancel").addEventListener("click", () => {
    closeModal("confirmSaveWin");
    pendingCloseAction = null;
  });

  // 찾기
  $("findText").addEventListener("input", () => { $("findExecute").disabled = !$("findText").value.trim(); });
  $("findText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("findExecute").disabled) performFind(); });
  $("findExecute").addEventListener("click", performFind);

  // 회전하기
  $("rotateApply").addEventListener("click", () => {
    const deg = Number(document.querySelector('input[name="rotDeg"]:checked').value);
    const range = document.querySelector('input[name="rotRange"]:checked').value;
    if (range === "all") {
      for (let p = 1; p <= STATE.numPages; p++) setPageRotation(p, getPageRotation(p) + deg);
      THUMBS.els.forEach((_, idx) => THUMBS.rerenderOne(idx + 1));
    } else {
      setPageRotation(STATE.currentPage, getPageRotation(STATE.currentPage) + deg);
      THUMBS.rerenderOne(STATE.currentPage);
    }
    refreshView();
    closeModal("rotateWin");
  });

  // 작업창 결과 목록 클릭 (개요 이동 / 첨부파일 다운로드 / 주석 삭제)
  $("workpaneBody").addEventListener("click", (e) => {
    const del = e.target.closest("[data-anno-del]");
    if (del) {
      const p = Number(del.dataset.annoPage), i = Number(del.dataset.annoIdx);
      if (ANNOTATE.byPage[p]) ANNOTATE.byPage[p].splice(i, 1);
      if (p === STATE.currentPage) ANNOTATE.redraw();
      ACT.showAnnoProps();
      return;
    }
    const att = e.target.closest(".wpItem[data-att]");
    if (att && window.__attachments) {
      const a = window.__attachments[att.dataset.att];
      if (a && a.content) downloadBytes(a.content, a.filename || att.dataset.att, "application/octet-stream");
      return;
    }
    const pageItem = e.target.closest(".wpItem[data-page]");
    if (pageItem) goToPage(Number(pageItem.dataset.page));
  });

  // 떠 있는 창 제목줄의 투명도 슬라이더
  document.querySelectorAll(".fopacity").forEach((s) => s.addEventListener("input", (e) => {
    const win = e.target.closest(".fwin");
    if (win) win.style.opacity = Number(e.target.value) / 100;
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
  "ctrl+j": "annoToggle", "shift+q": "select", "ctrl+shift+c": "capture", "shift+a": "capture", "alt+x": "quit", "ctrl+f4": "closeDoc" };
let chord = 0;
document.addEventListener("keydown", (e) => {
  if ($("presentOverlay").classList.contains("open")) return;
  const mod = e.ctrlKey || e.altKey, key = e.key.toLowerCase();
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
  if (typing && !mod && !/^f\d+$/.test(key)) return;
  if (chord && Date.now() - chord < 1500 && key === "i" && !mod) { chord = 0; e.preventDefault(); return ACT.docinfo(); }
  if (e.ctrlKey && key === "q") { chord = Date.now(); e.preventDefault(); return; }
  const k = (e.ctrlKey ? "ctrl+" : "") + (e.altKey ? "alt+" : "") + (e.shiftKey ? "shift+" : "") + key;
  if (SC[k]) { e.preventDefault(); if (STATE.pdfDoc || SC[k] === "open" || SC[k] === "quit") ACT[SC[k]](); return; }
  if (!mod && STATE.pdfDoc && key === "arrowleft") ACT.prev();
  if (!mod && STATE.pdfDoc && key === "arrowright") ACT.next();
});
