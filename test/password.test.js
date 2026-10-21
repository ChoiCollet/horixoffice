// 비밀번호가 걸린 PDF 열기 — 진짜 pdf.js로 (맞는 번호 / 틀렸다 맞음 / 취소)
const fs = require("fs"), path = require("path");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const { openPdfDocument } = new Function(fs.readFileSync(path.join(__dirname, "..", "js", "pdfopen.js"), "utf8") + "\nreturn { openPdfDocument };")();
const results = []; const ok = (n, c, d) => results.push({ n, pass: !!c, d });
const bytes = () => new Uint8Array(fs.readFileSync("/tmp/locked.pdf"));
(async () => {
  let asked = [];
  let doc = await openPdfDocument(pdfjs, bytes(), async (wrong) => { asked.push(wrong); return "1234"; });
  ok("맞는 비밀번호를 넣으면 열린다 (한 번만 물어봄)", doc.numPages === 1 && asked.length === 1 && asked[0] === false, JSON.stringify(asked));
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(" ");
  ok("열린 문서의 글자를 읽을 수 있다", text.includes("Restricted Document Text"), text);
  asked = []; const seq = ["wrong", "1234"];
  doc = await openPdfDocument(pdfjs, bytes(), async (wrong) => { asked.push(wrong); return seq.shift(); });
  ok("틀린 번호 다음에 다시 물을 때는 '틀렸다'고 알려준다 → 맞는 번호로 열린다", doc.numPages === 1 && JSON.stringify(asked) === "[false,true]", JSON.stringify(asked));
  let err = null; try { await openPdfDocument(pdfjs, bytes(), async () => null); } catch (e) { err = e; }
  ok("입력을 취소하면 '취소됨' 오류로 끝난다 (일반 오류와 구분)", err && err.cancelled === true, err && err.message);
  const plain = await openPdfDocument(pdfjs, new Uint8Array(fs.readFileSync("/tmp/plain.pdf")), async () => { throw new Error("묻지 말아야 함"); });
  ok("비밀번호가 없는 PDF는 묻지 않고 바로 열린다", plain.numPages === 1);
  err = null; try { await openPdfDocument(pdfjs, new Uint8Array([1, 2, 3, 4]), async () => "x"); } catch (e) { err = e; }
  ok("PDF가 아닌 파일은 일반 오류다 (취소와 다름)", err && !err.cancelled, err && err.message);
  console.log("\n=== 비밀번호 PDF 검증 ==="); let f = 0;
  for (const r of results) { console.log((r.pass ? "✅" : "❌") + " " + r.n + (!r.pass && r.d ? "  → " + r.d : "")); if (!r.pass) f++; }
  console.log(`총 ${results.length}개 중 ${results.length - f}개 통과, ${f}개 실패`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
