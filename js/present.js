/* =========================================================
   present.js — 프레젠테이션 (전체 화면 슬라이드쇼) · 전환 효과 재생 · 미리보기
   ========================================================= */

const PRES_DEFAULT = { type: "none", from: "left", dur: 1, monitor: "default" };
function presSettings() { return Object.assign({}, PRES_DEFAULT, (PREFS.data && PREFS.data.pres) || {}); }

const PRESENT = {
  isOpen: false, page: 1, W: 0, H: 0,
  anim: null, cache: new Map(), screens: [], previewToken: 0,

  /* ---------- 한 쪽을 화면 크기 캔버스에 그리기 (검은 바탕 + 가운데 맞춤 + 회전·주석 반영) ---------- */
  async renderPageCanvas(n, W, H) {
    const c = TRANS_ENV.createCanvas(W, H), ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const page = await STATE.pdfDoc.getPage(n), rotation = getPageRotation(n);
    const base = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(W / base.width, H / base.height);
    const vp = page.getViewport({ scale, rotation });
    const dx = Math.round((W - vp.width) / 2), dy = Math.round((H - vp.height) / 2);
    ctx.save(); ctx.translate(dx, dy);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, vp.width, vp.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (ANNOTATE.visible) (ANNOTATE.byPage[n] || []).forEach((sh) => ANNOTATE.drawShape(ctx, sh, vp));
    ctx.restore();
    return c;
  },

  async pageCanvas(n) {
    const key = `${n}|${this.W}x${this.H}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.renderPageCanvas(n, this.W, this.H));
      if (this.cache.size > 5) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  },

  prefetch(n) { if (n >= 1 && n <= STATE.numPages) this.pageCanvas(n).catch(() => {}); },

  /* ---------- 전환 한 번 재생: 끝나면 풀리는 약속(Promise) ---------- */
  play(ctx, A, B, type, opts, durSec) {
    return new Promise((resolve) => {
      const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!(durSec > 0) || type === "none" || reduce) { drawTransition(ctx, A, B, 1, "none", opts); resolve(); return; }
      const job = { A, B, ctx, type, opts, t0: null, dur: durSec * 1000, resolve, done: false };
      const step = (ts) => {
        if (job.done) return;
        if (job.t0 === null) job.t0 = ts;
        const p = Math.min(1, (ts - job.t0) / job.dur);
        drawTransition(ctx, A, B, p, type, opts);
        if (p >= 1) { job.done = true; resolve(); } else job.raf = requestAnimationFrame(step);
      };
      job.finish = () => { if (job.done) return; job.done = true; cancelAnimationFrame(job.raf); drawTransition(ctx, A, B, 1, "none", opts); resolve(); };
      job.raf = requestAnimationFrame(step);
      this.currentJob = job;
    });
  },

  /* ---------- 슬라이드쇼 ---------- */
  size() {
    const dpr = window.devicePixelRatio || 1;
    this.W = Math.max(2, Math.round(innerWidth * dpr)); this.H = Math.max(2, Math.round(innerHeight * dpr));
    const c = $("presentCanvas"); c.width = this.W; c.height = this.H;
  },

  async open(fromPage) {
    if (!STATE.pdfDoc || this.isOpen) return;
    this.isOpen = true;
    this.page = Math.max(1, Math.min(STATE.numPages, fromPage || 1));
    const ov = $("presentOverlay");
    ov.classList.add("open");
    this.size(); this.cache.clear();
    this._bind();
    this.requestFullscreen(ov);
    const ctx = $("presentCanvas").getContext("2d");
    try { drawTransition(ctx, await this.pageCanvas(this.page), await this.pageCanvas(this.page), 1, "none", {}); } catch (e) { /* 그림 실패해도 닫을 수 있게 */ }
    this.prefetch(this.page + 1); this.prefetch(this.page - 1);
    this.hud();
  },

  requestFullscreen(el) {
    const s = presSettings();
    try {
      const idx = s.monitor !== "default" ? Number(s.monitor) : -1;
      const opt = idx >= 0 && this.screens[idx] ? { screen: this.screens[idx] } : undefined;
      const p = el.requestFullscreen && el.requestFullscreen(opt);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 전체 화면을 못 써도 창 가득 보여줘요 */ }
  },

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.currentJob) this.currentJob.finish && this.currentJob.finish();
    this.anim = null;
    $("presentOverlay").classList.remove("open");
    this._unbind();
    this.cache.clear();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    // 슬라이드쇼에서 마지막으로 본 쪽을 화면에서도 보여줘요
    if (STATE.currentPage !== this.page) goToPage(this.page);
  },

  // 목표 쪽으로 이동(전환 효과 재생). 이미 재생 중이면 그 전환을 바로 끝내고 이어서 가요.
  async go(n) {
    if (!this.isOpen) return false;
    n = Math.max(1, Math.min(STATE.numPages, n));
    if (n === this.page) { this.hud(n === STATE.numPages ? "마지막 쪽이에요" : n === 1 ? "첫 쪽이에요" : ""); return false; }
    if (this.currentJob && !this.currentJob.done) this.currentJob.finish();
    const from = this.page; this.page = n;
    const ticket = this.ticket = (this.ticket || 0) + 1;
    const [A, B] = await Promise.all([this.pageCanvas(from), this.pageCanvas(n)]);
    if (ticket !== this.ticket || !this.isOpen) return true;
    const s = presSettings();
    // 뒤로 갈 때는 방향을 반대로 해서 "되감기" 느낌이 나게 해요
    const flip = { left: "right", right: "left", top: "bottom", bottom: "top" };
    const opts = { from: n > from ? s.from : flip[s.from] };
    await this.play($("presentCanvas").getContext("2d"), A, B, s.type, opts, s.dur);
    this.prefetch(n + 1); this.prefetch(n - 1);
    this.hud();
    return true;
  },
  next() { return this.go(this.page + 1); },
  prev() { return this.go(this.page - 1); },

  hud(msg) {
    const h = $("presentHud");
    h.textContent = (msg ? msg + "  ·  " : "") + `${this.page} / ${STATE.numPages}`;
    h.classList.add("show");
    clearTimeout(this._hudTm); this._hudTm = setTimeout(() => h.classList.remove("show"), 1800);
  },

  /* ---------- 입력 ---------- */
  _bind() {
    this._key = (e) => {
      if (!this.isOpen) return;
      const k = e.key;
      if (k === "Escape") { e.preventDefault(); this.close(); }
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(k)) { e.preventDefault(); this.next(); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(k)) { e.preventDefault(); this.prev(); }
      else if (k === "Home") { e.preventDefault(); this.go(1); }
      else if (k === "End") { e.preventDefault(); this.go(STATE.numPages); }
    };
    this._click = (e) => {
      if (e.target.closest("#presentExit")) return;
      const x = e.clientX / innerWidth;
      if (x < 0.25) this.prev(); else this.next();
    };
    let tx = 0, ty = 0, tt = 0;
    this._ts = (e) => { const t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY; tt = Date.now(); };
    this._te = (e) => {
      const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - tt < 800) {
        this._swiped = true; setTimeout(() => { this._swiped = false; }, 400);
        if (dx < 0) this.next(); else this.prev();
      }
    };
    this._clickGuard = (e) => { if (this._swiped) return; this._click(e); };
    this._wheel = (e) => {
      const now = Date.now(); if (now - (this._wt || 0) < 350) return; this._wt = now;
      if (e.deltaY > 0) this.next(); else if (e.deltaY < 0) this.prev();
    };
    this._move = () => this.hud();
    this._fs = () => { if (this.isOpen && !document.fullscreenElement && this._wasFs) this.close(); this._wasFs = !!document.fullscreenElement; };
    this._rs = () => {
      if (!this.isOpen) return;
      clearTimeout(this._rst);
      this._rst = setTimeout(async () => {
        this.size(); this.cache.clear();
        const B = await this.pageCanvas(this.page);
        $("presentCanvas").getContext("2d").drawImage(B, 0, 0);
      }, 150);
    };
    const ov = $("presentOverlay");
    document.addEventListener("keydown", this._key, true);
    ov.addEventListener("click", this._clickGuard);
    ov.addEventListener("touchstart", this._ts, { passive: true });
    ov.addEventListener("touchend", this._te, { passive: true });
    ov.addEventListener("wheel", this._wheel, { passive: true });
    ov.addEventListener("mousemove", this._move);
    document.addEventListener("fullscreenchange", this._fs);
    window.addEventListener("resize", this._rs);
    this._wasFs = false;
  },
  _unbind() {
    const ov = $("presentOverlay");
    document.removeEventListener("keydown", this._key, true);
    ov.removeEventListener("click", this._clickGuard);
    ov.removeEventListener("touchstart", this._ts);
    ov.removeEventListener("touchend", this._te);
    ov.removeEventListener("wheel", this._wheel);
    ov.removeEventListener("mousemove", this._move);
    document.removeEventListener("fullscreenchange", this._fs);
    window.removeEventListener("resize", this._rs);
  },

  /* ---------- 미리보기: 지금 쪽 → 다음(또는 이전) 쪽으로 효과를 한 번 보여줘요 ---------- */
  async previewOn(canvas, type, from, dur) {
    if (!STATE.pdfDoc || STATE.numPages < 1) return;
    const token = ++this.previewToken;
    const W = canvas.width, H = canvas.height, cur = STATE.currentPage;
    const other = cur < STATE.numPages ? cur + 1 : cur > 1 ? cur - 1 : cur;
    const [A, B] = await Promise.all([this.renderPageCanvas(cur, W, H), this.renderPageCanvas(other, W, H)]);
    if (token !== this.previewToken) return;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(A, 0, 0);
    await this.play(ctx, A, B, type, { from }, dur);
    if (token === this.previewToken) { await new Promise((r) => setTimeout(r, 350)); if (token === this.previewToken) ctx.drawImage(A, 0, 0); }
  },

  // 화면에 보이는 쪽 위에 겹쳐서 보여주는 미리보기 (갤러리에서 효과를 고를 때)
  async previewOnViewer(type, from, dur) {
    if (!STATE.pdfDoc || type === "none") return;
    const host = STATE.viewMode === "continuous" ? $("viewer") : $("pageWrap");
    const r = host.getBoundingClientRect();
    if (!(r.width > 20 && r.height > 20)) return;
    const dpr = window.devicePixelRatio || 1;
    let c = $("transPreview");
    if (!c) { c = document.createElement("canvas"); c.id = "transPreview"; document.body.appendChild(c); }
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    Object.assign(c.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", display: "block" });
    await this.previewOn(c, type, from, dur);
    if (c) c.style.display = "none";
  },
};
