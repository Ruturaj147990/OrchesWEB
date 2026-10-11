import crypto from "node:crypto";
import { ImportedDocument } from "./importer.js";

export interface CandidateRequirement {
  id: string;
  projectId: string;
  blueprintId?: string;
  title: string;
  description: string;
  provenanceKind: "explicit" | "inferred";
  sourceReference: string;
  status: "candidate" | "approved" | "rejected";
  proposedAcceptanceTest: string;
  createdAt: string;
}

export class RequirementExtractor {
  public extractFromDocument(projectId: string, doc: ImportedDocument): CandidateRequirement[] {
    const text = doc.extractedText;
    const requirements: CandidateRequirement[] = [];
    const lines = text.split(/\r?\n/);
    let reqIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const isHeading = /^#{1,4}\s+/.test(line);
      const isBullet = /^[-*]\s+/.test(line);
      const isNumbered = /^\d+\.\s+/.test(line);
      const lower = line.toLowerCase();
      const hasRequirementKeyword =
        lower.includes("must ") ||
        lower.includes("shall ") ||
        lower.includes("require") ||
        lower.includes("feature:") ||
        lower.includes("objective:") ||
        lower.includes("acceptance criteria");

      if ((isHeading || isBullet || isNumbered || hasRequirementKeyword) && line.length > 8) {
        // Strip prefixes
        const cleanTitle = line.replace(/^[#\-*\d.\s:]+/, "").trim();
        if (cleanTitle.length < 5 || cleanTitle.toLowerCase().startsWith("table of contents")) continue;

        const isExplicit = hasRequirementKeyword || lower.includes("must") || lower.includes("shall") || lower.includes("required");

        requirements.push({
          id: `REQ-${String(reqIndex++).padStart(3, "0")}`,
          projectId,
          blueprintId: doc.id,
          title: cleanTitle.slice(0, 150),
          description: `Extracted from ${doc.filename} (Line ${i + 1}): ${cleanTitle}`,
          provenanceKind: isExplicit ? "explicit" : "inferred",
          sourceReference: `${doc.filename}:Line ${i + 1}`,
          status: "candidate",
          proposedAcceptanceTest: `Automated test verifying that '${cleanTitle.slice(0, 80)}' functions as specified.`,
          createdAt: new Date().toISOString(),
        });

        if (requirements.length >= 50) break; // Bounded extraction
      }
    }

    if (requirements.length === 0) {
      requirements.push({
        id: "REQ-001",
        projectId,
        blueprintId: doc.id,
        title: `Fulfill objective of ${doc.filename}`,
        description: `Implement core functionality fulfilling the specification in ${doc.filename}.`,
        provenanceKind: "inferred",
        sourceReference: doc.filename,
        status: "candidate",
        proposedAcceptanceTest: "Run project test suite and verify clean build fulfilling blueprint specifications.",
        createdAt: new Date().toISOString(),
      });
    }

    return requirements;
  }
}
