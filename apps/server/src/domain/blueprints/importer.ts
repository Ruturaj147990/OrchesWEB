import crypto from "node:crypto";
import path from "node:path";

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

export class BlueprintImporter {
  public static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  public static readonly ALLOWED_EXTENSIONS = [".md", ".txt", ".json", ".yaml", ".yml", ".pdf", ".docx"];

  public importFile(filename: string, buffer: Buffer): ImportedDocument {
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

    if (ext === ".md" || ext === ".txt") {
      extractedText = buffer.toString("utf8");
    } else if (ext === ".json") {
      try {
        const parsed = JSON.parse(buffer.toString("utf8"));
        extractedText = JSON.stringify(parsed, null, 2);
      } catch {
        extractedText = buffer.toString("utf8");
        warnings.push("File is not valid JSON; raw text preserved.");
      }
    } else if (ext === ".yaml" || ext === ".yml") {
      extractedText = buffer.toString("utf8");
    } else if (ext === ".pdf") {
      // Basic text stream extractor for machine-readable PDFs
      const raw = buffer.toString("latin1");
      const textMatches = raw.match(/\((.*?)\)\s*Tj/g);
      if (textMatches && textMatches.length > 0) {
        extractedText = textMatches.map((m) => m.replace(/^[()]|Tj$/g, "").trim()).join(" ");
      } else {
        extractedText = buffer.toString("utf8").replace(/[^\x20-\x7E\n]/g, " ").trim();
        if (extractedText.length < 20) {
          warnings.push("No machine-readable text stream found in PDF. Scanned image OCR is not supported in MVP.");
        }
      }
    } else if (ext === ".docx") {
      // Basic xml text extraction from docx container
      const raw = buffer.toString("utf8");
      const xmlMatches = raw.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
      if (xmlMatches && xmlMatches.length > 0) {
        extractedText = xmlMatches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
      } else {
        extractedText = raw.replace(/[^\x20-\x7E\n]/g, " ").slice(0, 5000);
        warnings.push("DOCX container parsed with basic text fallback.");
      }
    } else {
      extractedText = buffer.toString("utf8");
    }

    // Sanitize non-printable control characters except newline and tab
    extractedText = extractedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    return {
      id: `doc-${crypto.randomUUID()}`,
      filename,
      extension: ext,
      sha256,
      byteSize: buffer.length,
      extractedText: extractedText.slice(0, 100_000), // Bounded text extract (100k chars)
      warnings,
      importedAt: new Date().toISOString(),
    };
  }
}
