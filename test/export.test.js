// 실제 pdf-lib / pdf.js로 "저장 결과물"을 검증한다 (jsdom 스텁이 아니라 진짜 라이브러리 사용)
const fs = require("fs"), path = require("path"), vm = require("vm");
const PL = require("pdf-lib");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

// 같은 영역(realm)에서 실행해야 pdf-lib의 타입 검사가 정상 동작한다
const code = fs.readFileSync(path.join(__dirname, "..", "js", "annotate.js"), "utf8");
const fns = new Function("window", "document", code + "\n;return { buildAnnotatedPDF, textItemsFromContent, textLinesInSelection, detectHorixSession };")({}, {});
const { buildAnnotatedPDF, textItemsFromContent, textLinesInSelection, detectHorixSession } = fns;

const results = [];
const ok = (n, c, d) => results.push({ n, pass: !!c, d });

(async () => {
  // 원본: 2쪽 (1쪽은 세로 글자, 2쪽은 가로)
  const src = await PL.PDFDocument.create();
  const font = await src.embedFont(PL.StandardFonts.Helvetica);
  const p1 = src.addPage([595, 842]); p1.drawText("Hello Annotation World", { x: 72, y: 700, size: 24, font });
  p1.drawText("Second line of text", { x: 72, y: 660, size: 18, font });
  src.addPage([842, 595]);
  const srcBytes = await src.save();

  const byPage = {
    1: [
      { type: "line", color: "#e2231a", width: 3, p1: [50, 50], p2: [200, 120] },
      { type: "arrow", color: "#2f6fed", width: 2, p1: [50, 150], p2: [200, 150] },
      { type: "rect", color: "#1d8a4c", width: 2, p1: [300, 100], p2: [400, 200] },
      { type: "ellipse", color: "#f2a900", width: 2, p1: [300, 250], p2: [420, 330] },
      { type: "free", color: "#000000", width: 3, points: [[10, 10], [20, 30], [40, 20], [60, 60]] },
      { type: "highlight", color: "#ffd400", width: 0, p1: [72, 695], p2: [300, 722] },
      { type: "underline", color: "#e2231a", width: 1, p1: [72, 697], p2: [300, 697] },
      { type: "strike", color: "#e2231a", width: 1, p1: [72, 708], p2: [300, 708] },
      { type: "note", color: "#ffd933", width: 1, p1: [500, 700], text: "한글 메모 테스트 ✓" },
    ],
    2: [],
  };
  const out = await buildAnnotatedPDF(PL, srcBytes, byPage, { 2: 90 });

  const re = await PL.PDFDocument.load(out);
  ok("저장 결과가 2쪽이다", re.getPageCount() === 2);
  ok("2쪽에 준 회전(90도)이 파일에 실제로 반영된다", re.getPage(1).getRotation().angle === 90, re.getPage(1).getRotation().angle);
  ok("회전 안 한 1쪽은 0도다", re.getPage(0).getRotation().angle === 0);

  const annots = re.getPage(0).node.lookupMaybe(PL.PDFName.of("Annots"), PL.PDFArray);
  ok("스티커노트가 진짜 PDF 메모(Text 주석)로 들어간다", annots && annots.size() === 1);
  if (annots) {
    const dict = annots.lookup(0, PL.PDFDict);
    const contents = dict.lookup(PL.PDFName.of("Contents"));
    ok("메모 내용(한글 포함)이 그대로 보존된다", contents.decodeText() === "한글 메모 테스트 ✓", contents.decodeText());
  }

  // 글자는 그대로 남아 있어야 한다 (이미지로 굽지 않았다는 증거)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(out), useSystemFonts: true, disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((i) => i.str).join(" ");
  ok("저장 후에도 원본 글자가 선택·검색 가능하다 (래스터화되지 않음)", text.includes("Hello Annotation World"), text);
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS;
  const has = (code) => ops.fnArray.includes(code);
  ok("도형이 벡터 경로로 그려져 있다", has(O.constructPath) && has(O.stroke));
  ok("이미지가 삽입되지 않았다", !has(O.paintImageXObject) && !has(O.paintInlineImageXObject));
  ok("파일 크기가 원본 대비 터무니없이 커지지 않는다", out.length < srcBytes.length + 20000, `${srcBytes.length} → ${out.length}`);

  // 사각형 안이 칠해지지 않는지(테두리만): 사각형 하나만 있는 PDF를 따로 만들어 확인
  const only = await buildAnnotatedPDF(PL, srcBytes, { 1: [{ type: "rect", color: "#000000", width: 2, p1: [10, 10], p2: [100, 100] }] }, {});
  const od = await pdfjs.getDocument({ data: new Uint8Array(only), useSystemFonts: true }).promise;
  const oops = await (await od.getPage(1)).getOperatorList();
  ok("직사각형은 테두리만 그려진다 (안을 칠하는 fill 연산이 없다)", !oops.fnArray.includes(O.fill) && !oops.fnArray.includes(O.eoFill) && !oops.fnArray.includes(O.fillStroke), [...new Set(oops.fnArray)].join(","));

  // 글자 상자 추출 + 드래그 영역 → 줄 단위 묶기
  const items = textItemsFromContent(await page.getTextContent());
  ok("글자 상자가 추출된다", items.length >= 2, items.length);
  const lines = textLinesInSelection(items, [60, 690], [450, 730]);
  ok("첫 줄 위를 드래그하면 그 줄만 선택된다", lines.length === 1 && Math.abs(lines[0].base - 700) < 1, JSON.stringify(lines));
  ok("선택 줄의 가로 범위가 글자를 덮는다 (72 ~ 끝)", lines[0] && lines[0].x0 <= 73 && lines[0].x1 > 200, JSON.stringify(lines[0]));
  const two = textLinesInSelection(items, [60, 650], [450, 730]);
  ok("두 줄에 걸쳐 드래그하면 줄이 둘로 나뉜다 (위에서 아래 순서)", two.length === 2 && two[0].base > two[1].base, JSON.stringify(two));
  ok("글자 없는 곳을 드래그하면 아무것도 선택되지 않는다", textLinesInSelection(items, [400, 100], [500, 200]).length === 0);

  // 빈 주석이면 원본과 똑같이 로드된다 + 이미 90도 돌아간 쪽에 더해지는지
  const base = await PL.PDFDocument.create(); const bp = base.addPage([300, 300]); bp.setRotation(PL.degrees(90));
  const o2 = await buildAnnotatedPDF(PL, await base.save(), {}, { 1: 90 });
  ok("원본이 이미 90도인 쪽에 90도를 더하면 180도가 된다", (await PL.PDFDocument.load(o2)).getPage(0).getRotation().angle === 180);

  // 저장한 파일을 다시 열면 원본과 주석을 꺼내서 계속 편집할 수 있어야 한다
  const embedded = await buildAnnotatedPDF(PL, srcBytes, byPage, { 2: 90 }, { embed: { original: new Uint8Array(srcBytes), session: { v: 1, byPage, rotations: { 2: 90 } } } });
  const ed = await pdfjs.getDocument({ data: new Uint8Array(embedded), useSystemFonts: true }).promise;
  const found = await detectHorixSession(ed);
  ok("저장한 파일에서 편집 데이터를 찾아낸다", !!found && found.session.v === 1);
  ok("꺼낸 원본이 처음 열었던 파일과 바이트까지 같다", found && Buffer.compare(Buffer.from(found.original), Buffer.from(srcBytes)) === 0);
  ok("꺼낸 주석이 모두 그대로다 (9개 + 한글 메모)", found && found.session.byPage[1].length === 9 && found.session.byPage[1][8].text === "한글 메모 테스트 ✓");
  ok("쪽 회전 정보도 함께 복원된다", found && found.session.rotations[2] === 90);
  ok("일반 PDF에서는 편집 데이터를 찾지 않는다", (await detectHorixSession(await pdfjs.getDocument({ data: new Uint8Array(srcBytes) }).promise)) === null);
  ok("원본을 품은 파일도 처음보다 용량이 크게 늘지 않는다 (원본 1배 + 주석)", embedded.length < srcBytes.length * 2 + 20000, `${srcBytes.length} → ${embedded.length}`);

  console.log("\n=== 저장 결과 검증 ===");
  let fail = 0;
  for (const r of results) { console.log((r.pass ? "✅" : "❌") + " " + r.n + (!r.pass && r.d !== undefined ? "  → " + String(r.d).slice(0, 160) : "")); if (!r.pass) fail++; }
  console.log(`\n총 ${results.length}개 중 ${results.length - fail}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("테스트 오류:", e); process.exit(1); });
