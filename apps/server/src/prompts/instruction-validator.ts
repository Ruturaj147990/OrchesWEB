import { extractJsonFromText } from "./json-extractor.js";

/**
 * Detects whether the model produced a shallow meta-instruction (e.g. telling the agent
 * to construct a brief) instead of the actual substantive engineering brief.
 */
export function isMetaInstruction(text: string): boolean {
  if (!text || typeof text !== "string") return true;
  const trimmed = text.trim();
  if (trimmed.length < 15) return true;

  const metaPatterns = [
    /^(construct|create|generate|write|produce|draft|prepare|assemble|formulate)\s+(a\s+)?(comprehensive\s+|cohesive\s+|detailed\s+|markdown\s+)*(engineering\s+brief|implementation\s+prompt|brief|plan|specification|summary|roadmap)\s+(for|to|outlining|covering)/i,
    /^(please\s+)?(construct|create|generate|write|produce|draft)\s+(a\s+)?(comprehensive\s+|cohesive\s+|detailed\s+|markdown\s+)*(engineering\s+brief|plan|specification)/i,
    /^(implement|build)\s+the\s+(requested\s+)?(project|application|system|feature)\s+according\s+to\s+(the\s+)?(guidelines|requirements|criteria|specifications)/i,
    /^(the\s+agent\s+should\s+)?(construct|create|draft|prepare)\s+a\s+(brief|plan|specification)/i,
    /^as\s+the\s+systems\s+architect,\s+(i\s+instruct\s+the\s+agent\s+to\s+)?construct/i,
  ];

  if (metaPatterns.some((pattern) => pattern.test(trimmed))) return true;

  if (trimmed.length < 200 && /brief|guidelines and constraints|adhering to/i.test(trimmed) && !/#\s+/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Detects whether the text is an internal task-planning descriptor (such as JSON with
 * title, acceptance_criteria, files_to_read) rather than a substantive engineering instruction.
 */
export function isTaskDescriptor(text: string): boolean {
  if (!text || typeof text !== "string") return true;
  const trimmed = text.trim();

  // If text starts with '{' or '[' or contains task descriptor fields
  if (trimmed.startsWith("{") || trimmed.includes('"acceptance_criteria"') || trimmed.includes('"files_to_read"')) {
    try {
      const parsed = extractJsonFromText(trimmed) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        const hasDescriptorFields =
          "acceptance_criteria" in parsed ||
          "files_to_read" in parsed ||
          ("title" in parsed && !("instruction" in parsed) && !("prompt" in parsed));
        if (hasDescriptorFields && !parsed.instruction && !parsed.prompt) {
          return true;
        }
      }
    } catch {}
  }

  // Check for plain text or markdown repeating task descriptor patterns without actual body
  if (
    /^(title:\s*|task:\s*).+acceptance criteria:/is.test(trimmed) &&
    trimmed.length < 300 &&
    !trimmed.includes("##")
  ) {
    return true;
  }

  return false;
}

/**
 * Patterns matching interim thought summaries, status updates, reasoning fragments,
 * or bare titles produced by reasoning models before the final brief.
 */
export const THOUGHT_FRAGMENT_PATTERNS = [
  /^defining a safe alternative\b/i,
  /^thought for \d+ (seconds|second|s)\b/i,
  /^thinking\b/i,
  /^analyzing( the)? (request|task|spec|requirements|codebase)\b/i,
  /^searching( the)? (web|documentation|files|codebase)\b/i,
  /^formulating( the)? (response|plan|solution)\b/i,
  /^reading( the)? (attached|files|documents)\b/i,
  /^evaluating( the)? (request|safety|boundaries)\b/i,
  /^summarizing( the)? (project|requirements)\b/i,
  /^planning( the)? (implementation|architecture)\b/i,
];

/**
 * Detects whether the text is an interim thought fragment, model status update,
 * or non-instruction reasoning header.
 */
export function isThoughtOrStatusFragment(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;
  return THOUGHT_FRAGMENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Checks whether an instruction is hollow or lacks adequate specification.
 */
export function isUnderSpecified(text: string, taskText: string, options: { isRepair?: boolean } = {}): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (isThoughtOrStatusFragment(trimmed)) return true;
  if (isTaskDescriptor(trimmed)) return true;
  if (trimmed.toLowerCase() === taskText.trim().toLowerCase()) return true;

  // On targeted repair iterations, a concise fix instruction (e.g. "Fix add in math.js: it must return a + b.") is valid
  if (options.isRepair) {
    if (trimmed.length < 15) return true;
    return false;
  }

  // Initial iteration: require substantive brief
  if (trimmed.length < 60 && !trimmed.includes("\n") && !trimmed.includes("#")) return true;
  if (trimmed.length < 30) return true;
  return false;
}

export interface InstructionSubstanceValidation {
  valid: boolean;
  isTaskDescriptor: boolean;
  isMetaInstruction: boolean;
  isTruncated: boolean;
  hasVerificationInstructions: boolean;
  summary: string;
}

/**
 * Validates that an instruction body contains substantive, actionable engineering guidance
 * appropriate for the task's complexity, without enforcing rigid paragraph counts or arbitrary formatting.
 */
export function validateInstructionSubstance(
  instruction: string,
  taskText: string,
  options: { isComplex?: boolean } = {}
): InstructionSubstanceValidation {
  const trimmed = (instruction || "").trim();

  if (!trimmed || trimmed.length === 0) {
    return {
      valid: false,
      isTaskDescriptor: false,
      isMetaInstruction: false,
      isTruncated: false,
      hasVerificationInstructions: false,
      summary: "Instruction is empty",
    };
  }

  if (isThoughtOrStatusFragment(trimmed)) {
    return {
      valid: false,
      isTaskDescriptor: false,
      isMetaInstruction: false,
      isTruncated: false,
      hasVerificationInstructions: false,
      summary: "Instruction is an interim thought fragment or status update rather than an engineering brief",
    };
  }

  if (isTaskDescriptor(trimmed)) {
    return {
      valid: false,
      isTaskDescriptor: true,
      isMetaInstruction: false,
      isTruncated: false,
      hasVerificationInstructions: false,
      summary: "Instruction is an internal task-planning descriptor rather than an engineering brief",
    };
  }

  if (isMetaInstruction(trimmed)) {
    return {
      valid: false,
      isTaskDescriptor: false,
      isMetaInstruction: true,
      isTruncated: false,
      hasVerificationInstructions: false,
      summary: "Instruction is a meta-instruction directing the agent to draft a plan instead of providing the brief",
    };
  }

  // Check for truncation evidence (e.g. unclosed code block, truncated delimiters)
  const codeFenceCount = (trimmed.match(/```/g) || []).length;
  const isTruncated =
    codeFenceCount % 2 !== 0 ||
    /\[\/ORCHES_ANTIGRAVITY_?$/i.test(trimmed) ||
    /\[ORCHES_ANTIGRAVITY_INSTRUCTION\]\s*$/i.test(trimmed);

  if (isTruncated) {
    return {
      valid: false,
      isTaskDescriptor: false,
      isMetaInstruction: false,
      isTruncated: true,
      hasVerificationInstructions: false,
      summary: "Instruction exhibits evidence of truncation (unbalanced code blocks or cut-off marker)",
    };
  }

  // Check for verification instructions
  const lower = trimmed.toLowerCase();
  const hasVerificationInstructions =
    lower.includes("test") ||
    lower.includes("verify") ||
    lower.includes("check") ||
    lower.includes("validate") ||
    lower.includes("assertion") ||
    lower.includes("run");

  // Simple task vs complex task
  const isComplex = options.isComplex ?? (taskText.length > 250);
  if (isComplex && trimmed.length < 150) {
    return {
      valid: false,
      isTaskDescriptor: false,
      isMetaInstruction: false,
      isTruncated: false,
      hasVerificationInstructions,
      summary: "Instruction lacks sufficient detail for a complex engineering specification",
    };
  }

  return {
    valid: true,
    isTaskDescriptor: false,
    isMetaInstruction: false,
    isTruncated: false,
    hasVerificationInstructions,
    summary: "Instruction contains actionable engineering substance",
  };
}
