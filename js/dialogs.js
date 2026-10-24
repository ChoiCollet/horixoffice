/* =========================================================
   dialogs.js — 브라우저 기본 prompt/confirm 대신 쓰는 한PDF 모양 작은 창
   (비밀번호는 가려서 입력, 휴대폰에서도 같은 모양)
   ========================================================= */
const DLG = {
  _el: null,
  _build() {
    if (this._el) return this._el;
    const w = document.createElement("div");
    w.className = "fwin fwin2"; w.id = "dlgWin"; w.style.width = "420px";
    w.innerHTML = `<div class="fhead"><span id="dlgTitle">HorixOffice</span><span class="fgrow"></span><button class="x" id="dlgX" title="닫기">✕</button></div>
      <div class="fbody2"><div class="fmain"><div id="dlgMsg" class="dlgMsg"></div>
      <div class="field" id="dlgField"><input id="dlgInput" autocomplete="off"></div></div>
      <div class="factions"><button class="btn primary" id="dlgOk">확인(D)</button><button class="btn" id="dlgCancel">취소</button></div></div>`;
    document.body.appendChild(w);
    if (typeof bindFloatingWin === "function") bindFloatingWin(w);
    this._el = w;
    return w;
  },
  // kind: 'text' | 'password' | 'confirm'
  open({ title = "HorixOffice", msg = "", kind = "confirm", value = "", ok = "확인(D)", cancel = "취소" }) {
    const w = this._build();
    return new Promise((resolve) => {
      $("dlgTitle").textContent = title; $("dlgMsg").textContent = msg;
      $("dlgField").hidden = kind === "confirm";
      const inp = $("dlgInput"); inp.type = kind === "password" ? "password" : "text"; inp.value = value;
      $("dlgOk").textContent = ok; $("dlgCancel").textContent = cancel;
      const done = (v) => { w.classList.remove("open"); cleanup(); resolve(v); };
      const onOk = () => done(kind === "confirm" ? true : inp.value);
      const onCancel = () => done(kind === "confirm" ? false : null);
      const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); onOk(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } };
      const cleanup = () => { $("dlgOk").removeEventListener("click", onOk); $("dlgCancel").removeEventListener("click", onCancel); $("dlgX").removeEventListener("click", onCancel); w.removeEventListener("keydown", onKey); };
      $("dlgOk").addEventListener("click", onOk); $("dlgCancel").addEventListener("click", onCancel); $("dlgX").addEventListener("click", onCancel);
      w.addEventListener("keydown", onKey);
      w.classList.add("open");
      delete w.dataset.placed; centerWin(w);
      setTimeout(() => (kind === "confirm" ? $("dlgOk") : inp).focus(), 30);
      if (kind !== "confirm") inp.select();
    });
  },
  confirm(msg, opts) { return this.open(Object.assign({ msg, kind: "confirm" }, opts)); },
  prompt(msg, value, opts) { return this.open(Object.assign({ msg, kind: "text", value }, opts)); },
  password(msg, opts) { return this.open(Object.assign({ msg, kind: "password", title: "암호 입력" }, opts)); },
};
