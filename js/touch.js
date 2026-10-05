/* =========================================================
   touch.js — 손도구 끌기 · 두 손가락 확대/축소 · 선택한 글자 바로 검색 버튼
   ========================================================= */
(function () {
  const viewer = $("viewer");

  // 손도구: 끌어서 화면 옮기기 (마우스)
  let hd = null;
  viewer.addEventListener("pointerdown", (e) => {
    if (isMobile() && leftPanelShown() && !e.target.closest("#leftPanel")) setLeftPanel(false);
    if (ANNOTATE.tool !== "hand" || e.button !== 0 || e.pointerType === "touch") return;
    hd = { x: e.clientX, y: e.clientY, sl: viewer.scrollLeft, st: viewer.scrollTop };
    viewer.classList.add("grabbing"); viewer.setPointerCapture(e.pointerId);
  });
  viewer.addEventListener("pointermove", (e) => {
    if (!hd) return;
    viewer.scrollLeft = hd.sl - (e.clientX - hd.x); viewer.scrollTop = hd.st - (e.clientY - hd.y);
  });
  const endHand = () => { hd = null; viewer.classList.remove("grabbing"); };
  viewer.addEventListener("pointerup", endHand); viewer.addEventListener("pointercancel", endHand);

  // 두 손가락 확대/축소: 손가락 사이가 벌어진 비율만큼 화면을 늘렸다가, 손을 떼면 선명하게 다시 그려요
  let pz = null;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const target = () => (STATE.viewMode === "continuous" ? $("continuousWrap") : $("pageWrap"));
  viewer.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2 && STATE.pdfDoc) { pz = { d: dist(e), s: STATE.scale, ratio: 1 }; ANNOTATE.cur = null; }
  }, { passive: true });
  viewer.addEventListener("touchmove", (e) => {
    if (!pz || e.touches.length !== 2) return;
    e.preventDefault();
    pz.ratio = Math.max(0.25 / pz.s, Math.min(4 / pz.s, dist(e) / pz.d));
    const t = target(); t.style.transformOrigin = "50% 0"; t.style.transform = `scale(${pz.ratio})`;
  }, { passive: false });
  const endPinch = (e) => {
    if (!pz || (e && e.touches && e.touches.length >= 2)) return;
    const r = pz.ratio, s0 = pz.s; pz = null;
    const t = target(); t.style.transform = ""; t.style.transformOrigin = "";
    if (Math.abs(r - 1) > 0.02) { STATE.fitMode = "custom"; STATE.scale = Math.max(0.25, Math.min(4, s0 * r)); refreshView(); }
  };
  viewer.addEventListener("touchend", endPinch); viewer.addEventListener("touchcancel", endPinch);

  // 선택한 글자 근처에 "검색" 버튼 (실시간 검색 설정을 켠 경우)
  const pop = document.createElement("button");
  pop.id = "rtPop"; pop.hidden = true; pop.textContent = "🔍 검색";
  document.body.appendChild(pop);
  let rtText = "";
  const check = () => {
    if (!PREFS.data.rtEnable) { pop.hidden = true; return; }
    const sel = window.getSelection();
    const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
    const node = sel && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!text || !node || !node.closest || !node.closest(".textL")) { pop.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    rtText = text.slice(0, 100);
    pop.style.left = Math.max(6, Math.min(r.left, innerWidth - 90)) + "px";
    pop.style.top = Math.max(6, r.top - 40) + "px";
    pop.hidden = false;
  };
  document.addEventListener("mouseup", () => setTimeout(check, 0));
  document.addEventListener("touchend", () => setTimeout(check, 250));
  document.addEventListener("keyup", () => setTimeout(check, 0));
  viewer.addEventListener("scroll", () => { pop.hidden = true; }, { passive: true });
  pop.addEventListener("mousedown", (e) => e.preventDefault());
  pop.addEventListener("click", () => {
    const eng = SEARCH_ENGINES[PREFS.data.rtEngine] || SEARCH_ENGINES.naver;
    openExternal(eng.url + encodeURIComponent(rtText)); pop.hidden = true;
  });
})();
