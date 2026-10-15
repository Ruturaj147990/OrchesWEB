import crypto from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";

export interface ImportedDocument {
  id: string;
  filename: string;
  extension: string;
  sha256: string;
  byteSize: number;
  extractedText: string;
  warnings: string[];
  importedAt: string;
}

/** Upper bound on extracted text kept per document (a warning is added when it is exceeded). */
const MAX_EXTRACTED_CHARS = 400_000;

export class BlueprintImporter {
  public static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  public static readonly ALLOWED_EXTENSIONS = [".md", ".txt", ".json", ".yaml", ".yml", ".pdf", ".docx"];

  public async importFile(rawFilename: string, buffer: Buffer): Promise<ImportedDocument> {
    // Never trust a client-supplied name as a path: it is later used to name temporary upload files.
    const filename = path.basename(String(rawFilename).replace(/\\/g, "/")).replace(/[<>:"|?*\u0000-\u001f]/g, "_") || "document.txt";
    const ext = path.extname(filename).toLowerCase();
    const warnings: string[] = [];

    if (!BlueprintImporter.ALLOWED_EXTENSIONS.includes(ext)) {
      warnings.push(`Extension '${ext}' is not officially supported. Extracted text may be incomplete.`);
    }

    if (buffer.length > BlueprintImporter.MAX_FILE_SIZE) {
      throw new Error(`File '${filename}' exceeds maximum allowed size of ${BlueprintImporter.MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    let extractedText = "";

    if (ext === ".md" || ext === ".txt" || ext === ".yaml" || ext === ".yml") {
      extractedText = buffer.toString("utf8");
    } else if (ext === ".json") {
      try {
        const parsed = JSON.parse(buffer.toString("utf8"));
        extractedText = JSON.stringify(parsed, null, 2);
      } catch {
        extractedText = buffer.toString("utf8");
        warnings.push("File is not valid JSON; raw text preserved.");
      }
    } else if (ext === ".pdf") {
      extractedText = await extractPdfText(buffer);
      if (extractedText.replace(/\s/g, "").length < 20) {
        throw new Error(`No text could be extracted from '${filename}'. It may be a scanned (image-only) PDF; OCR is not supported. Export it as text or Markdown and import that instead.`);
      }
    } else if (ext === ".docx") {
      extractedText = extractDocxText(buffer);
      if (extractedText.replace(/\s/g, "").length < 1) {
        throw new Error(`No text could be extracted from '${filename}'. Check that it is a valid Word (.docx) document.`);
      }
    } else {
      extractedText = buffer.toString("utf8");
    }

    // Sanitize non-printable control characters except newline and tab
    extractedText = extractedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    if (extractedText.length > MAX_EXTRACTED_CHARS) {
      warnings.push(`Extracted text was truncated to ${MAX_EXTRACTED_CHARS.toLocaleString()} characters (document has ${extractedText.length.toLocaleString()}).`);
      extractedText = extractedText.slice(0, MAX_EXTRACTED_CHARS);
    }

    return {
      id: `doc-${crypto.randomUUID()}`,
      filename,
      extension: ext,
      sha256,
      byteSize: buffer.length,
      extractedText,
      warnings,
      importedAt: new Date().toISOString(),
    };
  }
}

/** Text of every page, in reading order, using Mozilla pdf.js (handles compressed streams and font encodings). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await doc.destroy();
  }
}

/** Reads one entry from a ZIP archive (stored or deflated) without any third-party library. */
function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  // End-of-central-directory record: scan back over a possible trailing comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a ZIP archive (end of central directory not found)");
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let e = 0; e < entries; e++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("corrupt ZIP local header");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`unsupported ZIP compression method ${method}`);
  }
  return null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Paragraph text of word/document.xml (plus footnotes when present). */
function extractDocxText(buffer: Buffer): string {
  const parts: string[] = [];
  for (const entry of ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]) {
    const xml = readZipEntry(buffer, entry);
    if (!xml) {
      if (entry === "word/document.xml") throw new Error("word/document.xml not found; this is not a Word .docx file");
      continue;
    }
    let out = "";
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>|<\/w:p>/g;
    let m: RegExpExecArray | null;
    const text = xml.toString("utf8");
    while ((m = re.exec(text)) !== null) {
      if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
      else if (m[0] === "<w:tab/>") out += "\t";
      else out += "\n";
    }
    parts.push(out.replace(/\n{3,}/g, "\n\n").trim());
  }
  return parts.filter(Boolean).join("\n\n");
}
