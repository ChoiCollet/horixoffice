// 쪽 추출 / 영역 잘라내기 / 영역 글자 — 진짜 pdf-lib · pdf.js로 결과물을 열어서 확인
const fs = require("fs"), path = require("path");
const PL = require("pdf-lib"), pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const m = new Function("window", "document", J("zip.js") + J("pptx_parts.js") + J("convert.js") + J("tools.js") + J("annotate.js") +
  "\nreturn { regionText, buildCroppedPDF, buildExtractedPDF, buildAnnotatedPDF, ZIP };")({}, {});
const results = []; const ok = (n, c, d) => results.push({ n, pass: !!c, d });
(async () => {
  const src = await PL.PDFDocument.create(); const f = await src.embedFont(PL.StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) { const p = src.addPage([595, 842]); p.drawText(`Page ${i} Title`, { x: 72, y: 760, size: 24, font: f }); p.drawText(`Body text of page ${i}`, { x: 72, y: 700, size: 14, font: f }); p.drawText("Footer note", { x: 72, y: 80, size: 12, font: f }); }
  const bytes = await src.save();
  const open = (b) => pdfjs.getDocument({ data: new Uint8Array(b), useSystemFonts: true }).promise;
  const txt = async (d, n) => (await (await d.getPage(n)).getTextContent()).items.map((i) => i.str).join(" ");

  // 쪽 추출 (한 파일)
  let out = await m.buildExtractedPDF(PL, bytes, [2, 4]); let d = await open(out);
  ok("2·4쪽을 추출하면 2쪽짜리 PDF가 된다", d.numPages === 2);
  ok("추출된 쪽의 내용이 맞다 (Page 2, Page 4)", (await txt(d, 1)).includes("Page 2") && (await txt(d, 2)).includes("Page 4"));
  ok("추출한 쪽의 글자는 그대로 선택·검색 가능하다", (await txt(d, 1)).includes("Body text of page 2"));
  // 쪽마다 파일 → ZIP
  const files = []; for (const n of [1, 3]) files.push({ name: `t_${n}쪽.pdf`, data: await m.buildExtractedPDF(PL, bytes, [n]) });
  const zip = m.ZIP.build(files); fs.writeFileSync("/tmp/hx_extract.zip", zip);
  const py = require("child_process").spawnSync("python3", ["-c", `
import zipfile; from pypdf import PdfReader
z=zipfile.ZipFile('/tmp/hx_extract.zip'); print(z.testzip(), z.namelist())
import io; print([len(PdfReader(io.BytesIO(z.read(n))).pages) for n in z.namelist()])`], { encoding: "utf8" });
  ok("쪽마다 파일 ZIP이 풀리고 각각 1쪽짜리 PDF다", py.stdout.includes("None") && py.stdout.includes("[1, 1]"), py.stdout + py.stderr);
  // 주석·회전을 반영한 뒤 추출
  const withAnno = await m.buildAnnotatedPDF(PL, bytes, { 3: [{ type: "line", color: "#ff0000", width: 3, p1: [10, 10], p2: [100, 100] }] }, { 3: 90 }, {});
  out = await m.buildExtractedPDF(PL, withAnno, [3]);
  const re = await PL.PDFDocument.load(out);
  ok("회전을 반영하고 추출하면 그 쪽이 90도 돌아가 있다", re.getPage(0).getRotation().angle === 90, re.getPage(0).getRotation().angle);
  const ops = await (await (await open(out)).getPage(1)).getOperatorList();
  ok("주석(선)도 같이 들어 있다", ops.fnArray.includes(pdfjs.OPS.constructPath) && ops.fnArray.includes(pdfjs.OPS.stroke));

  // 영역 글자
  const page = await (await open(bytes)).getPage(1); const content = await page.getTextContent();
  const title = m.regionText(content, [60, 740, 400, 800]);
  ok("영역 안의 글자만 뽑는다 (제목 영역 → 'Page 1 Title')", title === "Page 1 Title", JSON.stringify(title));
  const both = m.regionText(content, [60, 690, 400, 800]);
  ok("두 줄에 걸친 영역은 줄바꿈으로 이어진다 (위→아래)", both === "Page 1 Title\nBody text of page 1", JSON.stringify(both));
  ok("글자가 없는 영역은 빈 문자열이다", m.regionText(content, [400, 300, 500, 400]) === "");
  ok("영역 가장자리에 걸친 글자 조각은 가운데가 영역 밖이면 빼고 안이면 넣는다", m.regionText(content, [72, 740, 100, 800]) === "" && m.regionText(content, [72, 740, 300, 800]).includes("Page 1"));

  // 영역 PDF 잘라내기
  const rect = [60, 740, 400, 800];
  const cropped = await m.buildCroppedPDF(PL, bytes, 0, rect); const cd = await open(cropped); const cp = await cd.getPage(1);
  const [vx0, vy0, vx1, vy1] = cp.view;
  ok("잘라낸 PDF는 1쪽이다", cd.numPages === 1);
  ok(`잘라낸 쪽의 크기가 선택한 영역과 같다 (${vx1 - vx0}×${vy1 - vy0})`, Math.abs(vx0 - 60) < 0.01 && Math.abs(vy0 - 740) < 0.01 && Math.abs((vx1 - vx0) - 340) < 0.01 && Math.abs((vy1 - vy0) - 60) < 0.01, JSON.stringify(cp.view));
  ok("잘라낸 PDF에도 글자가 벡터로 남아 있다", (await txt(cd, 1)).includes("Page 1 Title"));
  ok("잘라낸 PDF는 원본(4쪽)보다 훨씬 작다", cropped.length < bytes.length, `${bytes.length} → ${cropped.length}`);

  console.log("\n=== 도구 탭(쪽 추출·영역 내보내기) 검증 ==="); let fail = 0;
  for (const r of results) { console.log((r.pass ? "✅" : "❌") + " " + r.n + (!r.pass && r.d !== undefined ? "  → " + String(r.d).slice(0, 200) : "")); if (!r.pass) fail++; }
  console.log(`총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
