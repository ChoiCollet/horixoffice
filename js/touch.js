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
  // 두 손가락 사이 가운데를 기준으로 커지고, 손을 떼면 그 자리 그대로 선명하게 다시 그려요
  let pz = null, praf = 0;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const mid = (e) => [(e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2];
  const target = () => (isMultiView() ? $("continuousWrap") : $("pageWrap"));
  viewer.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2 && STATE.pdfDoc) {
      const [mx, my] = mid(e), r = target().getBoundingClientRect();
      pz = { d: dist(e), s: STATE.scale, ratio: 1, mx, my, ox: mx - r.left, oy: my - r.top };
      ANNOTATE.cur = null; ANNOTATE.drag = null; ANNOTATE.redraw();
      const t = target(); t.style.transformOrigin = `${pz.ox}px ${pz.oy}px`; t.style.willChange = "transform";
    }
  }, { passive: true });
  viewer.addEventListener("touchmove", (e) => {
    if (!pz || e.touches.length !== 2) return;
    e.preventDefault();
    pz.ratio = Math.max(0.25 / pz.s, Math.min(4 / pz.s, dist(e) / pz.d));
    const [mx, my] = mid(e); pz.mx = mx; pz.my = my;
    if (!praf) praf = requestAnimationFrame(() => { praf = 0; if (pz) target().style.transform = `scale(${pz.ratio})`; });
  }, { passive: false });
  const endPinch = (e) => {
    if (!pz || (e && e.touches && e.touches.length >= 2)) return;
    const p = pz; pz = null;
    if (praf) { cancelAnimationFrame(praf); praf = 0; }
    const t = target();
    t.style.transform = ""; t.style.transformOrigin = ""; t.style.willChange = "";
    const r = t.getBoundingClientRect();
    // 처음 손가락 가운데에 있던 내용이, 늘어난 모습 그대로 그 자리에 남게
    if (Math.abs(p.ratio - 1) > 0.02) zoomTo(p.s * p.ratio, r.left + p.ox, r.top + p.oy, [p.ox / r.width, p.oy / r.height]);
  };
  viewer.addEventListener("touchend", endPinch); viewer.addEventListener("touchcancel", endPinch);

  // Ctrl + 휠(노트북 터치패드 두 손가락 오므리기도 이걸로 와요): 마우스가 있는 곳을 기준으로 확대/축소
  let wheelAcc = 1, wheelPt = null, wheelBusy = false, wheelTm = null;
  viewer.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !STATE.pdfDoc) return;
    e.preventDefault();
    wheelAcc *= Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
    wheelPt = [e.clientX, e.clientY];
    const t = target(), r = t.getBoundingClientRect();
    if (!wheelBusy) {
      t.style.transformOrigin = `${e.clientX - r.left}px ${e.clientY - r.top}px`;
      t.style.transform = `scale(${wheelAcc})`;
    }
    clearTimeout(wheelTm);
    wheelTm = setTimeout(async () => {
      if (wheelBusy) return;
      const k = wheelAcc; wheelAcc = 1; wheelBusy = true;
      const tt = target(); tt.style.transform = ""; tt.style.transformOrigin = "";
      try { await zoomTo(STATE.scale * k, wheelPt[0], wheelPt[1]); } finally { wheelBusy = false; }
    }, 140);
  }, { passive: false });

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
