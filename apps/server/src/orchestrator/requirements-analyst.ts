import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ReasoningProvider } from "../providers/reasoning/provider.js";
import type { ImportedDocument } from "../domain/blueprints/importer.js";
import type { CandidateRequirement } from "../domain/blueprints/requirement-extractor.js";
import type { ProjectProfile } from "../workspace/project-inspector.js";
import {
  buildRequirementInventory,
  normalizeRequirementText,
  summarizeInventory,
  type ProjectRequirement,
  type RequirementInventory,
} from "../domain/requirements/requirement-inventory.js";
import { analyzeRefusal } from "../prompts/refusal-detector.js";

/**
 * Requirements analysis: the reasoning model turns everything the user provided into a numbered register
 * (requirements, constraints, testable acceptance criteria, out of scope, open questions). Orches checks
 * it against its own scan of the sources so no stated requirement is silently dropped, caches it per
 * identical input, and falls back to the scan when the analysis is unavailable.
 */

const ANALYSIS_VERSION = "register-v1.1";
const MARKER_START = "[ORCHES_REQUIREMENTS]";
const MARKER_END = "[/ORCHES_REQUIREMENTS]";

export interface AnalysisInput {
  db: DatabaseSync;
  projectId: string;
  runId: string;
  taskText: string;
  projectObjective?: string;
  blueprints: ImportedDocument[];
  candidateRequirements: CandidateRequirement[];
  profile: ProjectProfile;
  signal?: AbortSignal;
}

export interface AnalysisResult {
  inventory: RequirementInventory;
  /** Short human-readable note about how the register was produced. */
  note: string;
}

export const ANALYST_SYSTEM = `You are the requirements analyst for a software task. You turn the user's sources into a precise, complete requirement register. You never invent requirements and never drop one.`;

function sourcesSection(input: Pick<AnalysisInput, "taskText" | "projectObjective" | "blueprints">): string {
  const parts = [`## Task (from the user)\n"""\n${input.taskText.trim()}\n"""`];
  if (input.projectObjective?.trim() && input.projectObjective.trim() !== input.taskText.trim()) {
    parts.push(`## Project specification (from the user)\n"""\n${input.projectObjective.trim()}\n"""`);
  }
  for (const d of input.blueprints) {
    parts.push(`## Blueprint document: ${d.filename}\n"""\n${d.extractedText.trim()}\n"""`);
  }
  return parts.join("\n\n");
}

export function workspaceLine(profile: ProjectProfile): string {
  if (profile.isEmpty) return "Empty folder (new project).";
  const checks = profile.checks.map((c) => c.label).join(", ") || "none detected";
  return `${profile.fileCount} files; languages: ${profile.languages.join(", ") || "unknown"}; manifests: ${profile.manifests.join(", ") || "none"}; checks: ${checks}.`;
}

export function buildAnalysisPrompt(input: AnalysisInput, scan: RequirementInventory): string {
  const checklist = scan.requirements
    .filter((r) => r.classification !== "unresolved_contradiction")
    .slice(0, 150)
    .map((r) => `- ${r.description.slice(0, 300)}${r.scopeStatus && r.scopeStatus !== "in_scope" ? ` [${r.scopeStatus.replace("_", " ")}]` : ""}`);
  return `Analyse the sources below and produce the requirement register.

# Sources
${sourcesSection(input)}

## Workspace (context only; never an item)
${workspaceLine(input.profile)}

## Completeness checklist (statements Orches found in the sources; may include noise)
${checklist.join("\n") || "(none)"}

# Rules
- Include every distinct requirement, constraint (technology, version, platform, limit, rule), named entity, number and acceptance condition stated in the sources. Use the user's terms and values exactly.
- One self-contained, testable statement per item. Split compound statements.
- Priority: MUST (stated as required), SHOULD (stated as preferred), COULD (optional). Start a statement with "(inferred)" when it is not stated in the sources but needed to meet them; keep inferences minimal.
- Every MUST and SHOULD requirement and every constraint is covered by at least one acceptance criterion. Criteria describe observable behaviour or a check that can be run. Group closely related items; aim for 3–25 criteria.
- A criterion must be verifiable from the delivered code, its tests and their output. For environment constraints (runtime version, platform) check what the project declares and uses, not the machine.
- Items come only from the sources. Do not add items about the workspace state, the development process or things the sources do not ask for.
- Later phases, future work and anything the sources exclude go under OUT OF SCOPE, not REQUIREMENTS.
- Ambiguities and conflicts go under OPEN QUESTIONS with the assumption to use.
- Write "(none)" under an empty heading. No other text.

# Reply format (exact)
ORCHES_STATUS: REQUIREMENTS
${MARKER_START}
GOAL: <1-3 sentences: what the finished work is and who uses it>
REQUIREMENTS:
- R-1 | MUST | <statement> | SOURCE: <section or short quote>
CONSTRAINTS:
- C-1 | <rule the implementation must obey> | SOURCE: <section or short quote>
ACCEPTANCE CRITERIA:
- AC-1 | <observable, testable check> | COVERS: R-1, C-1
OUT OF SCOPE:
- X-1 | <item> | REASON: <deferred phase, excluded, ...>
OPEN QUESTIONS:
- Q-1 | <question or conflict> | ASSUME: <assumption to use>
${MARKER_END}

If you cannot analyse these sources, reply instead:
ORCHES_STATUS: STOP
Reason: <why>`;
}

// ------------------------------------------------------------------------------------------------
// Parsing
// ------------------------------------------------------------------------------------------------

type HeadingKey = "goal" | "requirements" | "constraints" | "criteria" | "out" | "questions";

const HEADINGS: Array<[RegExp, HeadingKey]> = [
  [/^goal\b/i, "goal"],
  [/^requirements?\b/i, "requirements"],
  [/^constraints?\b/i, "constraints"],
  [/^acceptance criteria\b/i, "criteria"],
  [/^out of scope\b/i, "out"],
  [/^open questions?\b/i, "questions"],
];

export function normalizeId(raw: string): string | null {
  const m = raw.replace(/[*_`[\]]/g, "").trim().match(/^(AC|R|C|X|Q)\s*-?\s*0*(\d+)$/i);
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

function splitFields(line: string): string[] {
  return line.split(/\s+\|\s+|\s*\|\s*/).map((f) => f.trim()).filter(Boolean);
}

function stripLabel(field: string, label: string): string {
  return field.replace(new RegExp(`^${label}\\s*:\\s*`, "i"), "").trim();
}

/** Parses the analysis reply into register items (no Orches IDs reassigned). Returns null when unusable. */
export function parseRegister(text: string): { goal: string; items: ProjectRequirement[] } | null {
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  const body = start !== -1 ? text.slice(start + MARKER_START.length, end > start ? end : undefined) : text;

  let section: HeadingKey | null = null;
  let goal = "";
  const items: ProjectRequirement[] = [];
  const seen = new Set<string>();

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(#+|\*\*)\s*/, "").replace(/\*\*\s*$/, "").trim();
    if (!line) continue;
    const isBullet = /^[-*•]\s/.test(rawLine.trim());
    const bare = line.replace(/:.*$/, "").trim();
    const isItem = /^(R|C|AC|X|Q)-?\d+\s*\|/i.test(line);
    const head = isBullet || isItem ? undefined : HEADINGS.find(([re]) => re.test(bare) && bare.length <= 25);
    if (head) {
      section = head[1];
      if (section === "goal") goal = line.replace(/^goal\s*:?\s*/i, "").trim();
      continue;
    }
    if (section === "goal" && !/^[-*•]/.test(rawLine.trim())) {
      goal = `${goal} ${line}`.trim();
      continue;
    }
    // Rendered chat replies often lose list markers, so an ID-led line counts as an item too.
    const bullet = rawLine.trim().match(/^[-*•]\s+(.*)$/) ?? (/^(R|C|AC|X|Q)-?\d+\b/i.test(line) ? [line, line] : null);
    if (!bullet || !section || section === "goal") continue;
    const content = bullet[1].trim();
    if (/^\(?none\)?\.?$/i.test(content)) continue;
    const fields = splitFields(content);
    const id = normalizeId(fields[0] ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rest = fields.slice(1);

    if (section === "requirements" && id.startsWith("R-")) {
      let priority = "MUST";
      if (/^(MUST|SHOULD|COULD)$/i.test(rest[0] ?? "")) priority = rest.shift()!.toUpperCase();
      const statement = rest[0] ?? "";
      const source = stripLabel(rest.slice(1).join(" | "), "SOURCE");
      if (!statement) continue;
      const inferred = /^\(inferred\)/i.test(statement);
      items.push({
        id,
        title: statement.replace(/^\(inferred\)\s*/i, "").slice(0, 160),
        description: statement,
        classification: priority === "COULD" ? "optional_requirement" : inferred ? "reasonable_inference" : "mandatory_requirement",
        importance: priority === "MUST" ? "high" : priority === "SHOULD" ? "medium" : "low",
        sourceReference: source || "Requirements analysis",
        status: "not_started",
        scopeStatus: "in_scope",
        origin: "analysis",
      });
    } else if (section === "constraints" && id.startsWith("C-")) {
      const statement = rest[0] ?? "";
      if (!statement) continue;
      items.push({
        id,
        title: statement.slice(0, 160),
        description: statement,
        classification: "explicit_constraint",
        importance: "critical",
        sourceReference: stripLabel(rest.slice(1).join(" | "), "SOURCE") || "Requirements analysis",
        status: "not_started",
        scopeStatus: "in_scope",
        origin: "analysis",
      });
    } else if (section === "criteria" && id.startsWith("AC-")) {
      const statement = rest[0] ?? "";
      if (!statement) continue;
      const coversField = stripLabel(rest.slice(1).join(" "), "COVERS");
      const covers = coversField.split(/[,\s]+/).map(normalizeId).filter((c): c is string => Boolean(c));
      items.push({
        id,
        title: statement.slice(0, 160),
        description: statement,
        classification: "acceptance_criterion",
        importance: "high",
        sourceReference: "Requirements analysis",
        status: "not_started",
        scopeStatus: "in_scope",
        covers,
        origin: "analysis",
      });
    } else if (section === "out" && id.startsWith("X-")) {
      const statement = rest[0] ?? "";
      if (!statement) continue;
      const reason = stripLabel(rest.slice(1).join(" | "), "REASON");
      items.push({
        id,
        title: statement.slice(0, 160),
        description: statement,
        classification: "mandatory_requirement",
        importance: "low",
        sourceReference: "Requirements analysis",
        status: "not_started",
        scopeStatus: /defer|phase|later|future|next|v2|post/i.test(reason) ? "deferred" : "out_of_scope",
        scopeConflictReason: reason || "Out of scope",
        origin: "analysis",
      });
    } else if (section === "questions" && id.startsWith("Q-")) {
      const statement = rest[0] ?? "";
      if (!statement) continue;
      items.push({
        id,
        title: statement.slice(0, 160),
        description: statement,
        classification: "unresolved_contradiction",
        importance: "medium",
        sourceReference: "Requirements analysis",
        status: "not_started",
        scopeStatus: "unresolved",
        assumption: stripLabel(rest.slice(1).join(" | "), "ASSUME") || undefined,
        origin: "analysis",
      });
    }
  }

  const substantive = items.filter((i) => i.classification !== "unresolved_contradiction" && i.scopeStatus === "in_scope");
  if (substantive.length === 0) return null;
  // Criteria may only cover IDs that exist.
  const ids = new Set(items.map((i) => i.id));
  for (const i of items) if (i.covers) i.covers = i.covers.filter((c) => ids.has(c));
  return { goal: goal.trim(), items };
}

// ------------------------------------------------------------------------------------------------
// Completeness check against the source scan
// ------------------------------------------------------------------------------------------------

const STOP = new Set(["that", "this", "with", "from", "must", "shall", "should", "will", "have", "when", "into", "each", "their", "they", "your", "only", "also", "than", "then", "them", "been", "being", "able", "user", "users", "system", "using", "used", "make", "made"]);

function keyWords(text: string): string[] {
  return normalizeRequirementText(text)
    .split(" ")
    .filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOP.has(w));
}

/** True when `text` is substantially represented in `pool` (word overlap). */
function isRepresented(text: string, pool: string[]): boolean {
  const words = keyWords(text);
  if (words.length === 0) return true;
  const needed = Math.max(1, Math.ceil(words.length * 0.6));
  return pool.some((p) => {
    const hay = ` ${normalizeRequirementText(p)} `;
    return words.filter((w) => hay.includes(` ${w}`)).length >= needed;
  });
}

/** Adds source statements the analysis did not represent, so nothing the user wrote is lost. */
export function mergeMissingSourceItems(items: ProjectRequirement[], scan: RequirementInventory, goal = ""): { items: ProjectRequirement[]; added: number } {
  const each = items.map((i) => `${i.description} ${i.assumption ?? ""}`);
  // Also the register as a whole: a summary sentence ("build X with A and B") is covered by several items together.
  const pool = [goal, ...each, [goal, ...each].join(" ")].filter(Boolean);
  let r = Math.max(0, ...items.filter((i) => i.id.startsWith("R-")).map((i) => Number(i.id.slice(2))));
  let c = Math.max(0, ...items.filter((i) => i.id.startsWith("C-")).map((i) => Number(i.id.slice(2))));
  const added: ProjectRequirement[] = [];
  for (const s of scan.requirements) {
    if (s.scopeStatus !== "in_scope" || s.classification === "unresolved_contradiction") continue;
    if (s.origin === "source" && s.sourceReference === "Task" && s.description.length > 400) continue; // whole-task fallback item
    if (isRepresented(s.description, pool)) continue;
    const constraint = s.classification === "explicit_constraint";
    added.push({
      ...s,
      id: constraint ? `C-${++c}` : `R-${++r}`,
      classification: constraint ? "explicit_constraint" : s.classification === "optional_requirement" ? "optional_requirement" : "mandatory_requirement",
      notes: "Stated in the user's sources; added by Orches because the analysis did not list it.",
      origin: "source",
    });
    pool.push(s.description);
    if (added.length >= 40) break;
  }
  return { items: [...items, ...added], added: added.length };
}

// ------------------------------------------------------------------------------------------------
// Cache
// ------------------------------------------------------------------------------------------------

function cacheKey(input: AnalysisInput): string {
  const h = crypto.createHash("sha256");
  h.update(ANALYSIS_VERSION);
  h.update("\u0000" + input.taskText.trim());
  h.update("\u0000" + (input.projectObjective ?? "").trim());
  for (const d of input.blueprints) h.update("\u0000" + d.sha256);
  for (const c of input.candidateRequirements.filter((x) => x.status === "rejected")) h.update("\u0000rejected:" + c.title);
  return `${input.projectId}:${h.digest("hex").slice(0, 32)}`;
}

function readCache(db: DatabaseSync, key: string): RequirementInventory | null {
  try {
    const row = db.prepare("SELECT inventory_json FROM requirement_registers WHERE cache_key = ?").get(key) as { inventory_json?: string } | undefined;
    if (!row?.inventory_json) return null;
    const inv = JSON.parse(row.inventory_json) as RequirementInventory;
    for (const r of inv.requirements) {
      r.status = "not_started";
      delete r.notes;
    }
    inv.summary = summarizeInventory(inv.requirements, inv.summary?.warnings ?? []);
    inv.origin = "cache";
    return inv;
  } catch (err) {
    console.error(`[requirements] Could not read cached register: ${(err as Error).message}`);
    return null;
  }
}

function writeCache(db: DatabaseSync, key: string, projectId: string, inv: RequirementInventory): void {
  try {
    db.prepare(
      "INSERT INTO requirement_registers (cache_key, project_id, inventory_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET inventory_json = excluded.inventory_json, created_at = excluded.created_at"
    ).run(key, projectId, JSON.stringify(inv), new Date().toISOString());
  } catch (err) {
    console.error(`[requirements] Could not cache register: ${(err as Error).message}`);
  }
}

// ------------------------------------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------------------------------------

export async function analyzeRequirements(provider: ReasoningProvider, input: AnalysisInput): Promise<AnalysisResult> {
  const scan = buildRequirementInventory({
    taskText: input.taskText,
    projectObjective: input.projectObjective,
    blueprintDocuments: input.blueprints,
    candidateRequirements: input.candidateRequirements,
  });

  const key = cacheKey(input);
  const cached = readCache(input.db, key);
  if (cached) return { inventory: cached, note: `Requirement register reused from an earlier identical analysis (${cached.requirements.length} items).` };

  const prompt = buildAnalysisPrompt(input, scan);
  const ask = async (content: string, operationId: string) =>
    provider.generate(
      {
        operation: "requirement_extraction",
        operationId,
        stage: "analysis",
        systemInstruction: ANALYST_SYSTEM,
        messages: [{ role: "user", content }],
        temperature: 0,
        maxOutputTokens: 6000,
        projectId: input.projectId,
        runId: input.runId,
      },
      input.signal
    );

  let text = "";
  try {
    text = (await ask(prompt, "requirement_extraction")).text || "";
  } catch (err) {
    if (input.signal?.aborted) throw err;
    return { inventory: scan, note: `Requirements analysis unavailable (${(err as Error).message}); using Orches' scan of your sources.` };
  }

  let parsed = parseRegister(text);
  if (!parsed && !/ORCHES_STATUS:\s*STOP/i.test(text) && !analyzeRefusal(text).isRefusal) {
    try {
      const retry = await ask(
        `Your previous reply did not follow the required format. Reply again with the complete register, starting with "ORCHES_STATUS: REQUIREMENTS" and enclosed in ${MARKER_START} … ${MARKER_END}, using exactly the line format given earlier.`,
        "requirement_extraction_format_retry"
      );
      parsed = parseRegister(retry.text || "");
    } catch (err) {
      if (input.signal?.aborted) throw err;
    }
  }
  if (!parsed) {
    const why = /ORCHES_STATUS:\s*STOP/i.test(text) || analyzeRefusal(text).isRefusal ? "the model declined the analysis" : "the reply could not be parsed";
    return { inventory: scan, note: `Requirements analysis not used (${why}); using Orches' scan of your sources.` };
  }

  const merged = mergeMissingSourceItems(parsed.items, scan, parsed.goal);
  const warnings = [...(scan.summary.warnings ?? [])];
  if (merged.added) warnings.push(`${merged.added} statement(s) from your sources were not in the analysis and were added to the register.`);
  const inventory: RequirementInventory = {
    requirements: merged.items,
    summary: summarizeInventory(merged.items, warnings),
    goal: parsed.goal || undefined,
    origin: "analysis",
  };
  writeCache(input.db, key, input.projectId, inventory);
  const counts = inventory.summary;
  return {
    inventory,
    note: `Requirement register from ${provider.displayName}'s analysis: ${counts.mandatory + counts.optional + counts.inferences} requirement(s), ${counts.constraints} constraint(s), ${counts.acceptanceCriteria} acceptance criteria${merged.added ? `, ${merged.added} added from your sources` : ""}.`,
  };
}
