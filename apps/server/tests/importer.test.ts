import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { BlueprintImporter } from "../src/domain/blueprints/importer.js";

/** Builds a one-entry ZIP (deflated) — enough to stand in for a .docx. */
function zipOne(name: string, content: string): Buffer {
  const data = zlib.deflateRawSync(Buffer.from(content, "utf8"));
  const nameBuf = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(content), 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(Buffer.byteLength(content), 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

/** Minimal valid one-page PDF with a text object. */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

test("DOCX text is extracted with paragraphs and entities decoded", async () => {
  const xml = `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>REQ-1: store books &amp; members.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:r><w:t>paragraph</w:t></w:r></w:p></w:body></w:document>`;
  const doc = await new BlueprintImporter().importFile("spec.docx", zipOne("word/document.xml", xml));
  assert.equal(doc.extractedText, "REQ-1: store books & members.\nSecond paragraph");
});

test("PDF text is extracted", async () => {
  const doc = await new BlueprintImporter().importFile("spec.pdf", tinyPdf("Members can borrow 5 books"));
  assert.match(doc.extractedText, /Members can borrow 5 books/);
});

test("a path in the uploaded file name is reduced to its base name", async () => {
  const doc = await new BlueprintImporter().importFile("..\\..\\evil\\notes.md", Buffer.from("# hi"));
  assert.equal(doc.filename, "notes.md");
});

test("a non-docx archive is rejected with a clear error", async () => {
  await assert.rejects(new BlueprintImporter().importFile("x.docx", zipOne("other.xml", "<a/>")), /not a Word/);
});
