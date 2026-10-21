// 최종 점검: 화면에 있는 모든 버튼·메뉴·창이 실제 기능과 연결돼 있는지 정적으로 훑는다
const fs = require("fs"), path = require("path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
html = html.replace(/<script src="https:\/\/cdnjs[^>]*><\/script>\s*/g, "").replace(/<script>\s*pdfjsLib\.GlobalWorkerOptions[\s\S]*?<\/script>\s*/, "");
const names = [...html.matchAll(/<script src="js\/([a-zA-Z_]+\.js)"><\/script>/g)].map((m) => m[1]);
html = html.replace(/<script src="js\/[a-zA-Z_]+\.js"><\/script>\s*/g, "");
html = html.replace("</body>", names.map((f) => `<script>\n${fs.readFileSync(path.join(ROOT, "js", f), "utf8")}\n</script>`).join("\n") + "\n<script>window.__t={ACT,MENUS,SC,HELP_TEXT,TRANS_TYPES};</script></body>");
const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously", beforeParse(w) {
  w.pdfjsLib = { GlobalWorkerOptions: {} }; w.PDFLib = {}; w.IntersectionObserver = class { observe() {} disconnect() {} };
} });
const w = dom.window, d = w.document, T = w.__t;
const results = []; const ok = (n, c, d2) => results.push({ n, pass: !!c, d: d2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(50);
  const actNames = new Set(); const menuActs = [];
  const walk = (items) => items.forEach((it) => { if (it === "-") return; const [, , a] = it; if (Array.isArray(a)) walk(a); else menuActs.push(a); });
  Object.values(T.MENUS).forEach(walk);
  d.querySelectorAll("[data-a]").forEach((el) => actNames.add(el.dataset.a));
  const missingBtn = [...actNames].filter((a) => typeof T.ACT[a] !== "function");
  ok(`화면의 모든 버튼(${actNames.size}종)이 실제 기능과 연결돼 있다`, !missingBtn.length, missingBtn.join(", "));
  const missingMenu = [...new Set(menuActs)].filter((a) => typeof T.ACT[a] !== "function");
  ok(`모든 메뉴 항목(${new Set(menuActs).size}종)이 실제 기능과 연결돼 있다`, !missingMenu.length, missingMenu.join(", "));
  const missingSC = Object.entries(T.SC).filter(([, a]) => typeof T.ACT[a] !== "function");
  ok(`모든 단축키(${Object.keys(T.SC).length}개)가 실제 기능과 연결돼 있다`, !missingSC.length, JSON.stringify(missingSC));
  const dds = [...d.querySelectorAll("[data-dd]")].map((e) => e.dataset.dd);
  ok("모든 ∨ 메뉴 버튼이 메뉴 목록과 연결돼 있다", dds.every((k) => Array.isArray(T.MENUS[k])), dds.filter((k) => !T.MENUS[k]).join());
  const closes = [...d.querySelectorAll("[data-close]")].map((e) => e.dataset.close);
  ok("모든 닫기 버튼이 실제 창을 가리킨다", closes.every((id) => d.getElementById(id)), closes.filter((id) => !d.getElementById(id)).join());
  const ids = [...d.querySelectorAll("[id]")].map((e) => e.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  ok("같은 id가 두 번 쓰이지 않는다", !dup.length, [...new Set(dup)].join());
  const tools = [...d.querySelectorAll("[data-tool]")].map((e) => e.dataset.tool);
  ok("주석 도구 이름이 모두 올바르다", tools.every((t) => ["select", "line", "arrow", "rect", "ellipse", "free", "highlight", "underline", "strike", "note"].includes(t)), tools.join());
  const mute = [...d.querySelectorAll("button")].filter((b) => !b.textContent.trim() && !b.title && !b.getAttribute("aria-label") && !b.classList.contains("rcolor") && !b.classList.contains("tabv") && !b.classList.contains("rcaret"));
  ok("글자 없는 버튼에는 모두 설명(title)이 있다", !mute.length, mute.map((b) => b.outerHTML.slice(0, 80)).join(" | "));
  const wins = [...d.querySelectorAll(".fwin")];
  ok(`떠 있는 창 ${wins.length}개가 모두 제목줄과 닫기 버튼을 갖췄다`, wins.every((x) => x.querySelector(".fhead") && x.querySelector(".x")), wins.filter((x) => !x.querySelector(".x")).map((x) => x.id).join());
  const helpless = wins.filter((x) => x.querySelector(".fhelp") && x.id !== "helpWin" && !T.HELP_TEXT[x.id]).map((x) => x.id);
  ok("'?'가 있는 모든 창에 전용 도움말이 있다", !helpless.length, helpless.join());
  const src = names.map((f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8")).join("\n") + fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("'준비 중' 같은 자리표시자 문구가 남아 있지 않다", !/준비 중|아직 준비|추후 지원|TODO|FIXME/.test(src), (src.match(/.{20}(준비 중|아직 준비|TODO|FIXME).{20}/) || [""])[0]);
  ok("전환 효과 9종이 갤러리·메뉴·설정 창에 모두 있다", d.querySelectorAll(".panel[data-panel='present'] .tr").length === 9 && d.querySelectorAll("#effType option").length === 9 && T.TRANS_TYPES.length === 9);
  const tabs = [...d.querySelectorAll(".tab")].map((t) => t.dataset.tab);
  ok("리본 탭 5개(홈·보기·주석·프레젠테이션·도구)에 각각 내용이 있다", tabs.length === 5 && tabs.every((t) => d.querySelector(`.panel[data-panel="${t}"] .rb`)));
  const pages = ["about.html", "contact.html", "privacy.html"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  ok("소개·문의 페이지에 '아직 지원하지 않아요' 같은 옛 안내가 남아 있지 않다", !/아직은 지원하지 않아요|구현할 수 없어요|YOUR-DOMAIN/.test(pages + fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8") + fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8")), (pages.match(/.{15}(아직은 지원하지 않아요|구현할 수 없어요).{10}/) || [""])[0]);
  console.log("\n=== 최종 점검 (연결 상태) ==="); let fail = 0;
  for (const r of results) { console.log((r.pass ? "✅" : "❌") + " " + r.n + (!r.pass && r.d ? "  → " + String(r.d).slice(0, 240) : "")); if (!r.pass) fail++; }
  console.log(`총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
