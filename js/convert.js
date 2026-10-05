/* =========================================================
   convert.js — PDF를 그림(PNG) / DOCX / PPTX / XLSX로 바꾸기 (모두 브라우저 안에서)
   HWP는 비공개 형식이라 만들 수 없어요.
   ========================================================= */

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// pdf.js textContent → 글줄들: [{ base, h, cells: [{ x, w, str }] }] (위→아래, 왼쪽→오른쪽)
function extractLines(content) {
  const items = [];
  for (const it of content.items || []) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const t = it.transform;
    items.push({ x: t[4], base: t[5], w: it.width || 0, h: Math.abs(it.height || t[3]) || 10, str: it.str });
  }
  items.sort((a, b) => (b.base - a.base) || (a.x - b.x));
  const lines = [];
  for (const it of items) {
    const ln = lines.find((l) => Math.abs(l.base - it.base) < Math.max(l.h, it.h) * 0.45);
    if (ln) { ln.cells.push(it); ln.h = Math.max(ln.h, it.h); } else lines.push({ base: it.base, h: it.h, cells: [it] });
  }
  lines.sort((a, b) => b.base - a.base);
  lines.forEach((l) => l.cells.sort((a, b) => a.x - b.x));
  return lines;
}

// 한 줄의 조각들을 이어 붙인 글자
function lineText(line) {
  let out = "", prevEnd = null;
  for (const c of line.cells) {
    if (prevEnd !== null && c.x - prevEnd > line.h * 0.25 && !out.endsWith(" ") && !c.str.startsWith(" ")) out += " ";
    out += c.str; prevEnd = c.x + c.w;
  }
  return out.trim();
}

// 한 줄을 표의 칸으로 나누기 (글자 사이가 크게 벌어진 곳에서 끊음)
function lineCells(line) {
  const cells = []; let cur = null;
  for (const c of line.cells) {
    if (cur && c.x - cur.end <= line.h * 1.2) { cur.text += (c.x - cur.end > line.h * 0.25 ? " " : "") + c.str; cur.end = c.x + c.w; }
    else { cur = { text: c.str, x: c.x, end: c.x + c.w }; cells.push(cur); }
  }
  return cells.map((c) => ({ text: c.text.trim(), x: c.x }));
}

/* ---------- DOCX ---------- */
function buildDocxBytes(pages) {
  const font = '<w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕"/></w:rPr>';
  let body = "";
  pages.forEach((lines, i) => {
    if (i > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (!lines.length) body += `<w:p><w:r>${font}<w:t>(이 쪽에는 글자가 없어요)</w:t></w:r></w:p>`;
    lines.forEach((t) => { body += `<w:p><w:r>${font}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`; });
  });
  const doc = XML_HEAD + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  return ZIP.build([
    { name: "[Content_Types].xml", data: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", data: doc },
  ]);
}

/* ---------- XLSX ---------- */
const colName = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// sheets: [{ name, rows: [[칸, ...], ...] }]
function buildXlsxBytes(sheets) {
  const files = [];
  const sheetXml = (rows) => XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.map((cells, r) => `<row r="${r + 1}">` + cells.map((t, c) => (t === "" || t == null) ? "" : `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(t)}</t></is></c>`).join("") + "</row>").join("") +
    "</sheetData></worksheet>";
  const names = sheets.map((s, i) => String(s.name || `Sheet${i + 1}`).replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 31));
  files.push({ name: "[Content_Types].xml", data: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>" });
  files.push({ name: "_rels/.rels", data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
  files.push({ name: "xl/workbook.xml", data: XML_HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + "</sheets></workbook>" });
  files.push({ name: "xl/_rels/workbook.xml.rels", data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: "xl/styles.xml", data: XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>' });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) }));
  return ZIP.build(files);
}

/* ---------- PPTX (쪽마다 그림 한 장) ---------- */
// slides: [{ png: Uint8Array, w, h }]   (w,h는 쪽 크기 비율용)
function buildPptxBytes(slides) {
  const P = PPTX_PARTS, EMU = 914400;
  const w0 = slides[0].w, h0 = slides[0].h;
  const cx = 9144000, cy = Math.round(9144000 * h0 / w0);
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = [];
  files.push({ name: "[Content_Types].xml", data: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") + "</Types>" });
  files.push({ name: "_rels/.rels", data: XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>` });
  files.push({ name: "ppt/presentation.xml", data: XML_HEAD + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` +
    slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("") + `</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/>${P.notesSz}${P.defaultTextStyle}</p:presentation>` });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join("") + "</Relationships>" });
  files.push({ name: "ppt/slideMasters/slideMaster1.xml", data: P.master });
  files.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: P.masterRels });
  files.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: P.layout });
  files.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: P.layoutRels });
  files.push({ name: "ppt/theme/theme1.xml", data: P.theme });
  slides.forEach((s, i) => {
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: XML_HEAD + `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
      `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${i + 1}쪽" descr="PDF ${i + 1}쪽"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>` });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/image" Target="../media/image${i + 1}.png"/></Relationships>` });
    files.push({ name: `ppt/media/image${i + 1}.png`, data: s.png });
  });
  return ZIP.build(files);
}

/* ---------- 변환 실행 (화면 쪽) ---------- */
const CONVERT = {
  pagesFromDialog() {
    const mode = document.querySelector('input[name="cvRange"]:checked').value;
    if (mode === "current") return [STATE.currentPage];
    if (mode === "custom") return parsePageRange($("cvCustom").value, STATE.numPages);
    return Array.from({ length: STATE.numPages }, (_, i) => i + 1);
  },

  async renderPNG(pageNum, scale) {
    const page = await STATE.pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale, rotation: getPageRotation(pageNum) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (ANNOTATE.visible) (ANNOTATE.byPage[pageNum] || []).forEach((s) => ANNOTATE.drawShape(ctx, s, vp));
    const png = await new Promise((res) => canvas.toBlob((b) => b.arrayBuffer().then(res), "image/png"));
    return { png: new Uint8Array(png), w: vp.width, h: vp.height };
  },

  async textLines(pageNum) {
    const page = await STATE.pdfDoc.getPage(pageNum);
    return extractLines(await page.getTextContent());
  },

  async run() {
    if (!STATE.pdfDoc) return;
    const fmt = document.querySelector('input[name="cvFmt"]:checked').value;
    const pages = this.pagesFromDialog();
    if (!pages.length) { showToast("변환할 쪽을 골라 주세요."); return; }
    const scale = Number($("cvScale").value) || 2;
    const base = STATE.fileName.replace(/\.pdf$/i, "");
    showLoading("변환하는 중…");
    try {
      let out, name, mime;
      if (fmt === "img") {
        const files = [];
        for (let i = 0; i < pages.length; i++) {
          $("loadingText").textContent = `그림으로 바꾸는 중… ${i + 1}/${pages.length}`;
          files.push({ name: `${base}_${String(pages[i]).padStart(3, "0")}.png`, data: (await this.renderPNG(pages[i], scale)).png });
        }
        if (files.length === 1) { out = files[0].data; name = files[0].name; mime = "image/png"; }
        else { out = ZIP.build(files); name = `${base}_그림.zip`; mime = "application/zip"; }
      } else if (fmt === "docx") {
        const texts = [];
        for (let i = 0; i < pages.length; i++) { $("loadingText").textContent = `글자를 읽는 중… ${i + 1}/${pages.length}`; texts.push((await this.textLines(pages[i])).map(lineText)); }
        out = buildDocxBytes(texts); name = `${base}.docx`; mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (fmt === "xlsx") {
        const sheets = [];
        for (let i = 0; i < pages.length; i++) {
          $("loadingText").textContent = `글자를 읽는 중… ${i + 1}/${pages.length}`;
          const rows = (await this.textLines(pages[i])).map(lineCells).map((cells) => {
            const row = []; cells.forEach((c, k) => row[k] = c.text); return row;
          });
          sheets.push({ name: `${pages[i]}쪽`, rows: rows.length ? rows : [["(이 쪽에는 글자가 없어요)"]] });
        }
        out = buildXlsxBytes(sheets); name = `${base}.xlsx`; mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else if (fmt === "pptx") {
        const slides = [];
        for (let i = 0; i < pages.length; i++) { $("loadingText").textContent = `슬라이드를 만드는 중… ${i + 1}/${pages.length}`; slides.push(await this.renderPNG(pages[i], scale)); }
        out = buildPptxBytes(slides); name = `${base}.pptx`; mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else { showToast("HWP는 비공개 형식이라 만들 수 없어요."); return; }
      downloadBytes(out, name, mime);
      showToast(`${name} 파일을 만들었어요.`);
      closeModal("convertWin");
    } catch (e) {
      console.error(e); showToast("변환하는 중 문제가 발생했어요.");
    } finally { hideLoading(); }
  },
};
