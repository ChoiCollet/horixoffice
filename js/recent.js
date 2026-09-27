/* =========================================================
   recent.js — 최근 연 파일 목록 (localStorage)
   브라우저 보안 정책상 실제 파일을 다시 불러올 수는 없어서
   파일명·쪽수·연 시각만 기록해 "최근 작업 이력"으로 보여줍니다.
   ========================================================= */

const RECENT_KEY = "pdfstudio_recent_v1";

const RECENT = {
  list() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
    catch (e) { return []; }
  },

  add(name, pages) {
    let items = this.list().filter((i) => i.name !== name);
    items.unshift({ name, pages, at: Date.now() });
    items = items.slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(items));
    this.render();
  },

  clear() {
    localStorage.removeItem(RECENT_KEY);
    this.render();
  },

  render() {
    const wrap = $("recentList");
    const items = this.list();
    if (!items.length) {
      wrap.innerHTML = '<div class="propText" style="color:#9aa0a8">아직 연 파일이 없어요.</div>';
      return;
    }
    wrap.innerHTML = items.map((i) => {
      const d = new Date(i.at);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return `<div class="recentItem" title="${escapeHtml(i.name)}">
        <div class="rmeta">
          <div class="rname">${escapeHtml(i.name)}</div>
          <div class="rdate">${i.pages}쪽 · ${dateStr}</div>
        </div>
      </div>`;
    }).join("");
  },
};

document.addEventListener("DOMContentLoaded", () => RECENT.render());
