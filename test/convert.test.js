// 변환 결과를 진짜 pdf.js로 읽은 글자로 만들고, python-docx / openpyxl / python-pptx로 열어서 검증
const fs = require("fs"), path = require("path"), cp = require("child_process");
const PL = require("pdf-lib"), pdfjs = require("pdfjs-dist/legacy/build/pdf.js"), { createCanvas } = require("canvas");
const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const mod = new Function("window", "document", J("zip.js") + J("pptx_parts.js") + J("convert.js") + J("templates.js") +
  "\nreturn { ZIP, buildDocxBytes, buildXlsxBytes, buildPptxBytes, extractLines, lineText, lineCells, buildTemplatePDF };")({}, {});
const results = []; const ok = (n, c, d) => results.push({ n, pass: !!c, d });
const out = "/tmp/hx_convert"; fs.mkdirSync(out, { recursive: true });

(async () => {
  const src = await PL.PDFDocument.create(); const f = await src.embedFont(PL.StandardFonts.Helvetica);
  const p = src.addPage([595, 842]);
  p.drawText("Quarterly Report", { x: 72, y: 760, size: 20, font: f });
  p.drawText("Name", { x: 72, y: 700, size: 12, font: f }); p.drawText("Score", { x: 300, y: 700, size: 12, font: f }); p.drawText("Grade", { x: 450, y: 700, size: 12, font: f });
  p.drawText("Kim", { x: 72, y: 680, size: 12, font: f }); p.drawText("93", { x: 300, y: 680, size: 12, font: f }); p.drawText("A", { x: 450, y: 680, size: 12, font: f });
  src.addPage([595, 842]).drawText("Second page text", { x: 72, y: 700, size: 14, font: f });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await src.save()), useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= 2; i++) pages.push(mod.extractLines(await (await doc.getPage(i)).getTextContent()));

  ok("글줄이 위에서 아래로 정렬된다", pages[0][0].base > pages[0][1].base && lineT(pages[0][0]) === "Quarterly Report");
  function lineT(l) { return mod.lineText(l); }
  const row = mod.lineCells(pages[0][1]);
  ok("표 같은 줄은 칸 3개로 나뉜다 (Name | Score | Grade)", row.length === 3 && row[0].text === "Name" && row[2].text === "Grade", JSON.stringify(row));
  ok("본문 한 줄 안의 띄어쓰기는 한 칸으로 유지된다", mod.lineCells(pages[0][0]).length === 1);

  fs.writeFileSync(`${out}/t.docx`, mod.buildDocxBytes(pages.map((ls) => ls.map(lineT)).concat([[]])));
  fs.writeFileSync(`${out}/t.xlsx`, mod.buildXlsxBytes(pages.map((ls, i) => ({ name: `${i + 1}쪽`, rows: ls.map((l) => mod.lineCells(l).map((c) => c.text)) }))));
  const mk = (c) => { const cv = createCanvas(400, 560); const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 400, 560); return { png: new Uint8Array(cv.toBuffer("image/png")), w: 400, h: 560 }; };
  fs.writeFileSync(`${out}/t.pptx`, mod.buildPptxBytes([mk("#cc3333"), mk("#3366cc"), mk("#33aa66")]));
  fs.writeFileSync(`${out}/t.zip`, mod.ZIP.build([{ name: "a.txt", data: "hello 안녕" }, { name: "b/c.bin", data: new Uint8Array([1, 2, 3, 250]) }]));

  const tpl = {};
  for (const k of ["lined", "grid", "dots", "cornell", "staff"]) {
    const bytes = await mod.buildTemplatePDF(PL, k);
    const d = await PL.PDFDocument.load(bytes);
    const pg = await (await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise).getPage(1);
    const ops = await pg.getOperatorList();
    tpl[k] = { pages: d.getPageCount(), ops: ops.fnArray.length };
  }
  ok("서식 문서 5종이 모두 1쪽짜리 PDF로 만들어진다", Object.values(tpl).every((t) => t.pages === 1), JSON.stringify(tpl));
  ok("서식 문서에 실제로 선·점이 그려져 있다", Object.values(tpl).every((t) => t.ops > 20), JSON.stringify(tpl));

  const py = cp.spawnSync("python3", ["-c", `
import docx, openpyxl, pptx, zipfile, json
out="${out}"
d=docx.Document(out+"/t.docx"); paras=[p.text for p in d.paragraphs if p.text]
x=openpyxl.load_workbook(out+"/t.xlsx"); ws=x.worksheets[0]
pr=pptx.Presentation(out+"/t.pptx")
z=zipfile.ZipFile(out+"/t.zip"); 
print(json.dumps({"paras":paras,"sheets":x.sheetnames,"row2":[c.value for c in ws[2]],"nslides":len(pr.slides),"shapes":[len(s.shapes) for s in pr.slides],"w":pr.slide_width,"h":pr.slide_height,
 "pic":[s.shapes[0].shape_type==13 for s in pr.slides],"zip":z.testzip(),"zipnames":z.namelist(),"txt":z.read("a.txt").decode()},ensure_ascii=False))
`], { encoding: "utf8" });
  if (py.status !== 0) { console.log(py.stderr); ok("python 라이브러리로 열기", false, py.stderr.slice(-300)); }
  else {
    const r = JSON.parse(py.stdout);
    ok("DOCX가 Word 호환 라이브러리(python-docx)로 열리고 글자가 들어 있다", r.paras.includes("Quarterly Report") && r.paras.includes("Second page text"), JSON.stringify(r.paras));
    ok("XLSX가 openpyxl로 열리고 쪽마다 시트가 있다", r.sheets.join() === "1쪽,2쪽", r.sheets.join());
    ok("XLSX의 표 줄이 칸으로 나뉘어 들어간다", r.row2[0] === "Name" && r.row2.includes("Score") && r.row2.includes("Grade"), JSON.stringify(r.row2));
    ok("PPTX가 python-pptx로 열리고 슬라이드가 3장이다", r.nslides === 3, r.nslides);
    ok("각 슬라이드에 그림 한 장이 들어 있다", r.shapes.every((n) => n === 1) && r.pic.every(Boolean), JSON.stringify([r.shapes, r.pic]));
    ok("슬라이드 비율이 쪽 비율(400:560)을 따른다", Math.abs(r.h / r.w - 1.4) < 0.01, `${r.w}x${r.h}`);
    ok("ZIP이 손상 없이 풀리고 한글 내용이 보존된다", r.zip === null && r.zipnames.join() === "a.txt,b/c.bin" && r.txt === "hello 안녕", JSON.stringify(r));
  }
  console.log("\n=== 변환 검증 ===");
  let fail = 0; for (const r of results) { console.log((r.pass ? "✅" : "❌") + " " + r.n + (!r.pass && r.d !== undefined ? "  → " + String(r.d).slice(0, 200) : "")); if (!r.pass) fail++; }
  console.log(`\n총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
