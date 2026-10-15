import { ImportedDocument } from "./importer.js";
import { scanSource } from "../requirements/requirement-inventory.js";

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

/** Same bound as the requirement register's scan. */
const MAX_CANDIDATES = 400;

export class RequirementExtractor {
  /**
   * The document's in-scope requirement statements, found by the same scan the requirement register uses (so the
   * list the user reviews, and any item they reject, matches what the register sees). Headings, background,
   * out-of-scope and later-phase items are not candidates.
   */
  public extractFromDocument(projectId: string, doc: ImportedDocument): CandidateRequirement[] {
    const createdAt = new Date().toISOString();
    const seen = new Set<string>();
    const items = scanSource(doc.extractedText, doc.filename).filter((it) => {
      const key = it.text.toLowerCase();
      if (it.scope !== "in_scope" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length > MAX_CANDIDATES) {
      doc.warnings.push(`The document has ${items.length} requirement-like statements; the first ${MAX_CANDIDATES} are listed here. The full text is still used.`);
    }

    // Ids are unique per document (they are primary keys across every project and blueprint).
    const requirements: CandidateRequirement[] = items.slice(0, MAX_CANDIDATES).map((it, n) => ({
      id: `${doc.id}-REQ-${String(n + 1).padStart(3, "0")}`,
      projectId,
      blueprintId: doc.id,
      title: it.text.slice(0, 150),
      description: `${it.kind === "constraint" ? "Constraint" : it.kind === "criterion" ? "Acceptance criterion" : it.kind === "optional" ? "Optional" : "Requirement"} from ${it.source}: ${it.text}`,
      provenanceKind: it.strength >= 3 ? "explicit" : "inferred",
      sourceReference: it.source,
      status: "candidate",
      proposedAcceptanceTest: `Automated test verifying that '${it.text.slice(0, 80)}' functions as specified.`,
      createdAt,
    }));

    if (requirements.length === 0) {
      requirements.push({
        id: `${doc.id}-REQ-001`,
        projectId,
        blueprintId: doc.id,
        title: `Fulfill objective of ${doc.filename}`,
        description: `Implement core functionality fulfilling the specification in ${doc.filename}.`,
        provenanceKind: "inferred",
        sourceReference: doc.filename,
        status: "candidate",
        proposedAcceptanceTest: "Run project test suite and verify clean build fulfilling blueprint specifications.",
        createdAt,
      });
    }

    return requirements;
  }
}
