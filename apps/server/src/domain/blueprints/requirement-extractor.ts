import crypto from "node:crypto";
import { ImportedDocument } from "./importer.js";

export interface CandidateRequirement {
  id: string;
  projectId: string;
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

    // Extract headers or bullet points as candidate requirements
    const lines = text.split("\n");
    let reqIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for requirement-like lines: lines with "must", "shall", "feature", or markdown headings
      if (
        (line.startsWith("## ") || line.startsWith("- ") || line.startsWith("* ")) &&
        line.length > 10 &&
        !line.toLowerCase().includes("instructions")
      ) {
        const title = line.replace(/^[#\-*\d.\s]+/, "").trim();
        if (title.length < 5) continue;

        const isExplicit = line.toLowerCase().includes("must") || line.toLowerCase().includes("require");

        requirements.push({
          id: `REQ-${String(reqIndex++).padStart(3, "0")}`,
          projectId,
          title,
          description: `Extracted from ${doc.filename}: ${title}`,
          provenanceKind: isExplicit ? "explicit" : "inferred",
          sourceReference: `${doc.filename}:Line ${i + 1}`,
          status: "candidate",
          proposedAcceptanceTest: `Automated test verifying that '${title}' functions as specified.`,
          createdAt: new Date().toISOString(),
        });

        if (requirements.length >= 25) break; // Bounded extraction
      }
    }

    if (requirements.length === 0) {
      // Inferred starter requirement if no explicit bullets found
      requirements.push({
        id: "REQ-001",
        projectId,
        title: "Baseline Project Specification Fulfillment",
        description: `Implement core functionality fulfilling the objective of ${doc.filename}`,
        provenanceKind: "inferred",
        sourceReference: doc.filename,
        status: "candidate",
        proposedAcceptanceTest: "Run project test suite and verify clean build.",
        createdAt: new Date().toISOString(),
      });
    }

    return requirements;
  }
}
