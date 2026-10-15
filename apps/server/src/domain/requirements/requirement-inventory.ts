import type { ImportedDocument } from "../blueprints/importer.js";
import type { CandidateRequirement } from "../blueprints/requirement-extractor.js";

export type RequirementClassification =
  | "mandatory_requirement"
  | "optional_requirement"
  | "explicit_constraint"
  | "acceptance_criterion"
  | "reasonable_inference"
  | "unresolved_contradiction";

export type RequirementImportance = "critical" | "high" | "medium" | "low";

export type RequirementScopeStatus =
  | "in_scope"
  | "out_of_scope"
  | "deferred"
  | "safety_conflict"
  | "unresolved";

export type RequirementStatus =
  | "not_started"
  | "in_progress"
  | "implemented_unverified"
  | "verified"
  | "blocked";

export interface ProjectRequirement {
  /** Stable identifier for the run: R-n (requirement), C-n (constraint), AC-n (acceptance criterion), Q-n (open question). */
  id: string;
  title: string;
  description: string;
  classification: RequirementClassification;
  importance: RequirementImportance;
  sourceReference: string;
  phase?: string;
  dependencies?: string[];
  status: RequirementStatus;
  scopeStatus?: RequirementScopeStatus;
  scopeConflictReason?: string;
  evidence?: string[];
  notes?: string;
  contradictionDetails?: {
    conflictingText: string;
    conflictingSource: string;
  };
  /** Acceptance criteria only: the requirement/constraint IDs this criterion verifies. */
  covers?: string[];
  /** Open questions only: the assumption to use unless the user decides otherwise. */
  assumption?: string;
  /** Where the item came from: the reasoning model's requirements analysis, or Orches' scan of the user's sources. */
  origin?: "analysis" | "source";
}

export interface RequirementInventory {
  requirements: ProjectRequirement[];
  summary: {
    total: number;
    mandatory: number;
    constraints: number;
    optional: number;
    acceptanceCriteria: number;
    inferences: number;
    contradictions: number;
    phases: string[];
    byStatus: Record<RequirementStatus, number>;
    /** Extraction notes (truncation, ignored rejected items, …); never silent. */
    warnings?: string[];
  };
  /** One-paragraph goal (present when the register came from the reasoning model's analysis). */
  goal?: string;
  /** "analysis" (reasoning model, checked by Orches), "cache" (an earlier identical analysis) or "source" (Orches' scan only). */
  origin?: "analysis" | "cache" | "source";
}

export interface InventoryBuildInput {
  taskText: string;
  projectObjective?: string;
  blueprintDocuments?: ImportedDocument[];
  /** Requirements recorded at blueprint import; ones the user REJECTED are excluded everywhere. */
  candidateRequirements?: CandidateRequirement[];
}

// --------------------------------------------------------------------------------------------------
// Source scanning: understands document structure (headings, sections, lists, tables, code blocks).
// It is the fallback register when the reasoning model's analysis is unavailable, and the completeness
// checklist the analysis is verified against.
// --------------------------------------------------------------------------------------------------

type SectionKind = "requirements" | "constraints" | "criteria" | "out_of_scope" | "deferred" | "optional" | "info" | "general";

/** What a heading says about the lines under it. */
export function sectionKind(heading: string): SectionKind {
  const h = heading.toLowerCase();
  if (/out[- ]of[- ]scope|non[- ]?goals?|not in scope|exclusions?|excluded|won'?t (do|have|build)|will not (do|build)/.test(h)) return "out_of_scope";
  if (/\bphase\s*([2-9]|\d{2,})\b|milestone\s*([2-9]|\d{2,})\b|\bfuture\b|\blater\b|roadmap|backlog|post[- ]?mvp|\bv2\b|next (release|version)|deferred/.test(h)) return "deferred";
  if (/acceptance|criteria|definition of done|verification|test (plan|cases|scenarios)|testing|\bqa\b/.test(h)) return "criteria";
  if (/optional|nice[- ]to[- ]have|stretch|bonus|could have/.test(h)) return "optional";
  if (/constraint|tech(nical)?\s*(stack|requirements|choices)?|technology|\bstack\b|non[- ]?functional|\brules\b|guidelines|security|performance|platform|environment|deployment|infrastructure|architecture|conventions|limitations/.test(h)) return "constraints";
  if (/requirement|feature|functional|user stor|\bscope\b|must[- ]have|deliverable|\bmvp\b|phase\s*1\b|milestone\s*1\b|\bcore\b|functionality|capabilit|use cases?|workflows?|endpoints?|\bapi\b|screens?|pages?|data model/.test(h)) return "requirements";
  if (/note|reference|background|overview|introduction|context|about|summary|appendix|glossary|faq|setup|install|readme|changelog|links|resources|motivation|history|credits|license|contact/.test(h)) return "info";
  return "general";
}

const MODAL = /\b(must|shall|should|required|requires|needs? to|has to|have to|never|always|only|cannot|can't|do not|don't|must not|may not|is not allowed|forbidden|prohibited)\b/i;
const IMPERATIVE_START = /^(create|build|add|implement|make|write|develop|design|support|provide|allow|enable|ensure|use|include|expose|return|store|save|display|show|validate|handle|integrate|deploy|configure|generate|send|log|track|calculate|compute|prevent|reject|accept|keep|remove|replace|refactor|fix|update|migrate|test)\b/i;
const CONSTRAINT_TEXT = /\b(must not|shall not|do not|don't|never|cannot|can't|may not|not allowed|forbidden|prohibited|only use|must use|shall use|use only|written in|must be (?:written|built|implemented) (?:in|with)|no external dependenc|zero (?:external )?dependenc|standard library only|without (?:any )?(?:external|third[- ]party)|version\s+\d|port\s+\d+|compatible with|must run on|must support (?:windows|linux|mac|node|python))\b/i;
const CRITERION_TEXT = /^(verify that|assert that|test that|check that|ensure that tests|given\b|when\b.*\bthen\b|scenario:)/i;
const OPTIONAL_TEXT = /\b(optional|nice to have|if time permits|could also|stretch goal|bonus)\b/i;
const DEFERRED_TEXT = /\b(phase\s*[2-9]|future (phase|release|version)|later release|post[- ]mvp|deferred|in a later version)\b/i;
const OUT_OF_SCOPE_TEXT = /\b(out of scope|not in scope|explicitly excluded|not required|is excluded|will not be implemented)\b/i;

interface ScannedItem {
  text: string;
  kind: "requirement" | "constraint" | "criterion" | "optional";
  scope: RequirementScopeStatus;
  phase?: string;
  source: string;
  strength: number; // modal / structural signal, used to filter noise in completeness checks
}

function stripMarkup(s: string): string {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^\s*\[[ xX]\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRequirementText(s: string): string {
  return stripMarkup(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((s) => s.trim()).filter(Boolean);
}

/** Scans one source text into requirement-like statements with their section context. */
export function scanSource(rawText: string, sourceLabel: string, activePhase?: string): ScannedItem[] {
  const out: ScannedItem[] = [];
  const lines = rawText.split(/\r?\n/);
  // Heading stack: level → { title, kind, phase }
  const stack: Array<{ level: number; title: string; kind: SectionKind; phase?: string }> = [];
  let inCode = false;
  let tableHeaderPending = false;

  const current = () => {
    let kind: SectionKind = "general";
    let phase: string | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (kind === "general" && stack[i].kind !== "general") kind = stack[i].kind;
      if (!phase && stack[i].phase) phase = stack[i].phase;
    }
    const title = stack.length ? stack[stack.length - 1].title : "";
    return { kind, phase, title };
  };

  const push = (text: string, lineNo: number, structural: boolean) => {
    const clean = stripMarkup(text);
    if (clean.length < 6 || /^table of contents/i.test(clean)) return;
    const { kind: section, phase, title } = current();
    if (section === "info") return;
    const modal = MODAL.test(clean);
    const imperative = IMPERATIVE_START.test(clean);
    // Plain prose in a general section counts only when it states something required.
    if (!structural && section === "general" && !modal && !imperative) return;

    let kind: ScannedItem["kind"] = "requirement";
    if (section === "criteria" || CRITERION_TEXT.test(clean)) kind = "criterion";
    else if (section === "optional" || OPTIONAL_TEXT.test(clean)) kind = "optional";
    else if (section === "constraints" || CONSTRAINT_TEXT.test(clean) || /^use\s+\w/i.test(clean)) kind = "constraint";

    let scope: RequirementScopeStatus = "in_scope";
    if (section === "out_of_scope" || OUT_OF_SCOPE_TEXT.test(clean)) scope = "out_of_scope";
    else if (section === "deferred" || DEFERRED_TEXT.test(clean)) scope = "deferred";
    // When the task names a phase, that phase is the active scope and other phases are deferred.
    if (phase && activePhase) scope = phase.toLowerCase() === activePhase.toLowerCase() ? (scope === "deferred" ? "in_scope" : scope) : "deferred";

    out.push({
      text: clean,
      kind,
      scope,
      phase,
      source: `${sourceLabel}${title ? ` › ${title}` : ""} (line ${lineNo})`,
      strength: (modal ? 2 : 0) + (imperative ? 1 : 0) + (section === "requirements" || section === "constraints" || section === "criteria" ? 2 : 0) + (structural ? 1 : 0),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !line) {
      tableHeaderPending = false;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/) || (i + 1 < lines.length && /^(=+|-+)\s*$/.test(lines[i + 1].trim()) && !/^[-*•]/.test(line) ? ["", lines[i + 1].trim().startsWith("=") ? "#" : "##", line] : null);
    if (heading) {
      const level = heading[1].length;
      const title = stripMarkup(heading[2]).replace(/:$/, "");
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const phaseMatch = title.match(/\b(phase\s*\d+|milestone\s*\d+|sprint\s*\d+)\b/i);
      stack.push({ level, title, kind: sectionKind(title), phase: phaseMatch ? phaseMatch[1].replace(/\s+/g, " ") : undefined });
      if (heading[0] === "") i++; // setext underline consumed
      continue;
    }
    // Bold-only line acting as a heading: "**Constraints**" / "Constraints:"
    const pseudo = line.match(/^(?:\*\*|__)?([A-Za-z][A-Za-z0-9 /&()-]{2,60}?)(?:\*\*|__)?\s*:?\s*$/);
    if (pseudo && (/^\*\*|^__/.test(line) || /:$/.test(line)) && sectionKind(pseudo[1]) !== "general") {
      while (stack.length && stack[stack.length - 1].level >= 7) stack.pop();
      stack.push({ level: 7, title: pseudo[1].trim(), kind: sectionKind(pseudo[1]) });
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        tableHeaderPending = false;
        continue;
      }
      if (!tableHeaderPending && i + 1 < lines.length && /^\|\s*:?-{2,}/.test(lines[i + 1].trim())) {
        tableHeaderPending = true; // header row
        continue;
      }
      const text = cells.filter(Boolean).join(" — ");
      if (text) push(text, i + 1, true);
      continue;
    }

    const bullet = line.match(/^([-*•+]|\d+[.)]|[a-z][.)])\s+(.*)$/i);
    if (bullet) {
      push(bullet[2], i + 1, true);
      continue;
    }
    // Prose: each sentence separately.
    for (const s of sentences(line)) push(s, i + 1, false);
  }
  return out;
}

const KIND_RANK: Record<ScannedItem["kind"], number> = { criterion: 4, constraint: 3, requirement: 2, optional: 1 };

function toClassification(kind: ScannedItem["kind"]): RequirementClassification {
  return kind === "criterion" ? "acceptance_criterion" : kind === "constraint" ? "explicit_constraint" : kind === "optional" ? "optional_requirement" : "mandatory_requirement";
}

function emptyStatusCounts(): Record<RequirementStatus, number> {
  return { not_started: 0, in_progress: 0, implemented_unverified: 0, verified: 0, blocked: 0 };
}

/** Recomputes the summary counts of an inventory (call after changing items). */
export function summarizeInventory(requirements: ProjectRequirement[], warnings: string[] = []): RequirementInventory["summary"] {
  const byStatus = emptyStatusCounts();
  const count = (c: RequirementClassification) => requirements.filter((r) => r.classification === c).length;
  for (const r of requirements) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return {
    total: requirements.length,
    mandatory: count("mandatory_requirement"),
    constraints: count("explicit_constraint"),
    optional: count("optional_requirement"),
    acceptanceCriteria: count("acceptance_criterion"),
    inferences: count("reasonable_inference"),
    contradictions: requirements.filter((r) => r.contradictionDetails || r.classification === "unresolved_contradiction").length,
    phases: [...new Set(requirements.map((r) => r.phase).filter((p): p is string => Boolean(p)))],
    byStatus,
    warnings,
  };
}

const MAX_SCANNED_ITEMS = 400;

/**
 * Builds the requirement register from the user's own words (task, project specification, blueprints),
 * without a model. Order of precedence when the same statement appears twice: the task text, then the
 * project specification, then blueprints; the strongest classification wins (criterion > constraint >
 * requirement > optional).
 */
export function buildRequirementInventory(input: InventoryBuildInput): RequirementInventory {
  const warnings: string[] = [];
  // A phase is active only when the task explicitly asks for it ("implement phase 2"), not because the
  // pasted specification contains a "Phase 2" heading.
  const phaseInTask = input.taskText
    .match(/\b(?:implement|build|do|work on|start|complete|deliver|continue with|proceed with|focus on)\b[^.\n#]{0,40}?\b((?:phase|milestone|sprint)\s*\d+)\b/i)?.[1]
    ?.replace(/\s+/g, " ");
  const rejected = new Set(
    (input.candidateRequirements ?? []).filter((c) => c.status === "rejected").map((c) => normalizeRequirementText(c.title))
  );
  if (rejected.size) warnings.push(`${rejected.size} blueprint requirement(s) you rejected were left out.`);

  const hasOtherSources = Boolean(input.projectObjective?.trim()) || (input.blueprintDocuments ?? []).some((d) => d.extractedText?.trim());
  // "Implement X as described in the attached spec" points at the sources; it is not a requirement of its own.
  const pointsAtSources = (t: string) =>
    /\b(described|specified|defined|outlined|detailed)\s+in\b|\b(attached|the)\s+(spec|specification|blueprint|prd)\b/i.test(t);
  const scanned: ScannedItem[] = [
    ...scanSource(input.taskText, "Task", phaseInTask).filter((it) => !(hasOtherSources && pointsAtSources(it.text))),
    ...(input.projectObjective?.trim() ? scanSource(input.projectObjective, "Project specification", phaseInTask) : []),
    ...(input.blueprintDocuments ?? []).flatMap((d) => scanSource(d.extractedText, `Blueprint ${d.filename}`, phaseInTask)),
  ];

  // Merge duplicates (keep first source, strongest kind, in-scope wins over deferred for the same text).
  const merged = new Map<string, ScannedItem>();
  for (const item of scanned) {
    const key = normalizeRequirementText(item.text);
    if (!key || rejected.has(key)) continue;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...item });
      continue;
    }
    if (KIND_RANK[item.kind] > KIND_RANK[prev.kind]) prev.kind = item.kind;
    if (prev.scope !== "in_scope" && item.scope === "in_scope" && item.source.startsWith("Task")) prev.scope = "in_scope";
    prev.strength = Math.max(prev.strength, item.strength);
  }

  let items = [...merged.values()];
  if (items.length > MAX_SCANNED_ITEMS) {
    warnings.push(`The sources contain ${items.length} requirement-like statements; the register keeps the first ${MAX_SCANNED_ITEMS}. The full text is still sent verbatim.`);
    items = items.slice(0, MAX_SCANNED_ITEMS);
  }

  const counters = { R: 0, C: 0, AC: 0 };
  const requirements: ProjectRequirement[] = items.map((it) => {
    const prefix = it.kind === "criterion" ? "AC" : it.kind === "constraint" ? "C" : "R";
    const id = `${prefix}-${++counters[prefix]}`;
    return {
      id,
      title: it.text.slice(0, 160),
      description: it.text,
      classification: toClassification(it.kind),
      importance: it.kind === "constraint" ? "critical" : it.kind === "optional" ? "low" : /\b(should|may|ideally|preferably|nice to have)\b/i.test(it.text) ? "medium" : "high",
      sourceReference: it.source,
      phase: it.phase,
      status: "not_started",
      scopeStatus: it.scope,
      scopeConflictReason: it.scope === "deferred" ? "Deferred (later phase / future work in the sources)." : it.scope === "out_of_scope" ? "Marked out of scope in the sources." : undefined,
      origin: "source",
    };
  });

  // Nothing structured at all (e.g. a one-line task): the task itself is the requirement.
  if (!requirements.some((r) => r.scopeStatus === "in_scope" && r.classification !== "acceptance_criterion")) {
    const text = stripMarkup(input.taskText).slice(0, 2000) || "Implement the task objective.";
    requirements.unshift({
      id: `R-${++counters.R}`,
      title: text.split(/(?<=[.!?])\s/)[0].slice(0, 160),
      description: text,
      classification: "mandatory_requirement",
      importance: "high",
      sourceReference: "Task",
      status: "not_started",
      scopeStatus: "in_scope",
      origin: "source",
    });
  }

  markConflicts(requirements);
  return { requirements, summary: summarizeInventory(requirements, warnings), origin: "source" };
}

/**
 * Flags constraint pairs that look contradictory (e.g. different database engines or ports). They stay
 * in scope — the conflict is surfaced for the reasoning model to resolve, never resolved silently.
 */
function markConflicts(requirements: ProjectRequirement[]): void {
  const constraints = requirements.filter((r) => r.classification === "explicit_constraint" && r.scopeStatus === "in_scope");
  const testOnly = (t: string) => /\b(test|tests|testing|dev|development|local|in[- ]memory|ci)\b/i.test(t);
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const a = constraints[i];
      const b = constraints[j];
      const la = a.description.toLowerCase();
      const lb = b.description.toLowerCase();
      const db = (t: string) => (/\bpostgres(ql)?\b/.test(t) ? "postgres" : /\bmysql\b/.test(t) ? "mysql" : /\bsqlite\b/.test(t) ? "sqlite" : /\bmongo(db)?\b/.test(t) ? "mongodb" : null);
      const port = (t: string) => t.match(/\bport\s+(\d{2,5})\b/)?.[1] ?? null;
      const conflict =
        (db(la) && db(lb) && db(la) !== db(lb) && !testOnly(la) && !testOnly(lb)) || (port(la) && port(lb) && port(la) !== port(lb));
      if (conflict) {
        a.contradictionDetails = { conflictingText: b.description, conflictingSource: b.sourceReference };
        b.contradictionDetails = { conflictingText: a.description, conflictingSource: a.sourceReference };
      }
    }
  }
}

/**
 * Updates requirement statuses from real evidence. Acceptance criteria take the reviewer's per-criterion
 * verdict; requirements and constraints take the verdicts of the criteria that cover them. Nothing is
 * marked verified merely because files changed or some check passed.
 */
export function updateRequirementStatuses(
  inventory: RequirementInventory,
  evidence: {
    filesChanged: string[];
    passedChecks: string[];
    failedChecks: string[];
    /** Reviewer per-criterion results (id → passed | failed | unverified). */
    criteriaResults?: Array<{ id: string; status: string }>;
    /** Whether the reviewer accepted the attempt as a whole. */
    reviewerAccepted?: boolean;
    /** Acceptance criteria of the run with the IDs they cover. */
    acceptanceCriteria?: Array<{ id: string; covers?: string[]; requirementId?: string }>;
    /** @deprecated kept for compatibility; ignored. */
    criticVerified?: string[];
    /** @deprecated kept for compatibility; ignored. */
    criticFailed?: string[];
  }
): RequirementInventory {
  const norm = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const results = new Map((evidence.criteriaResults ?? []).map((c) => [norm(c.id), c.status]));
  const coveredBy = new Map<string, string[]>();
  for (const ac of evidence.acceptanceCriteria ?? []) {
    for (const target of [...(ac.covers ?? []), ...(ac.requirementId ? [ac.requirementId] : [])]) {
      const key = norm(target);
      coveredBy.set(key, [...(coveredBy.get(key) ?? []), ac.id]);
    }
  }
  const worked = evidence.filesChanged.length > 0;
  const checksOk = evidence.failedChecks.length === 0;

  for (const req of inventory.requirements) {
    if (req.scopeStatus && req.scopeStatus !== "in_scope") continue;
    let verdicts: string[] = [];
    if (req.classification === "acceptance_criterion") {
      const v = results.get(norm(req.id));
      if (v) verdicts = [v];
    } else {
      verdicts = (coveredBy.get(norm(req.id)) ?? []).map((acId) => results.get(norm(acId))).filter((v): v is string => Boolean(v));
    }
    if (verdicts.some((v) => v === "failed")) {
      req.status = "in_progress";
      req.notes = "The reviewer found a covering acceptance criterion not met.";
    } else if (verdicts.length && verdicts.every((v) => v === "passed") && checksOk) {
      req.status = "verified";
      req.notes = "Covering acceptance criteria passed review and project checks passed.";
    } else if (!verdicts.length && evidence.reviewerAccepted && checksOk && worked) {
      req.status = "verified";
      req.notes = "The reviewer accepted the attempt; project checks passed.";
    } else if (worked && req.status === "not_started") {
      req.status = "implemented_unverified";
    }
  }
  inventory.summary = summarizeInventory(inventory.requirements, inventory.summary.warnings ?? []);
  return inventory;
}
