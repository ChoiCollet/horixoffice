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
    $("fileRecent").innerHTML = items.map((i, n) => `<button class="mi dim" data-a="openRecent" data-name="${escapeHtml(i.name)}"><span>${n + 1}  ${escapeHtml(i.name)}</span></button>`).join("");
    if (!items.length) {
      wrap.innerHTML = '<div class="propText" style="color:#9aa0a8">아직 연 파일이 없어요.</div>';
      return;
    }
    wrap.innerHTML = items.map((i) => {
      const d = new Date(i.at);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return `<button class="recentItem" data-a="openRecent" data-name="${escapeHtml(i.name)}" title="${escapeHtml(i.name)}">
        <div class="rmeta">
          <div class="rname">${escapeHtml(i.name)}</div>
          <div class="rdate">${i.pages}쪽 · ${dateStr}</div>
        </div>
      </button>`;
    }).join("");
  },
};

document.addEventListener("DOMContentLoaded", () => RECENT.render());

/* ---- 파일 시스템 접근 API로 "최근 파일 다시 열기" 지원 (지원 브라우저 한정) ---- */
const FSA_SUPPORTED = "showOpenFilePicker" in window;

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("horix-files", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("handles", { keyPath: "name" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPutHandle(name, handle) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put({ name, handle });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* 저장 실패해도 열람 자체는 계속 동작 */ }
}
async function idbGetHandle(name) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const rq = db.transaction("handles", "readonly").objectStore("handles").get(name);
      rq.onsuccess = () => res(rq.result && rq.result.handle);
      rq.onerror = () => rej(rq.error);
    });
  } catch (e) { return null; }
}
RECENT.saveHandle = (name, handle) => idbPutHandle(name, handle);
RECENT.openByName = async (name) => {
  if (!FSA_SUPPORTED) return showToast("이 브라우저는 파일 자동 재열기를 지원하지 않아요. '열기'로 다시 선택해 주세요.");
  const handle = await idbGetHandle(name);
  if (!handle) return showToast("이 파일은 다시 열 수 있는 정보가 없어요. '열기'로 다시 선택해 주세요.");
  try {
    if ((await handle.queryPermission({ mode: "read" })) !== "granted") {
      if ((await handle.requestPermission({ mode: "read" })) !== "granted")
        return showToast("파일 접근 권한이 없어서 열 수 없어요.");
    }
    const file = await handle.getFile();
    await loadPDFFromFile(file);
    STATE.fileHandle = handle;
  } catch (e) {
    showToast("원본 파일을 찾을 수 없어요. 이동했거나 삭제된 것 같아요.");
  }
};

