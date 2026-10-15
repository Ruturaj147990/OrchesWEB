/**
 * Recognizes when the reasoning model declined a request (fully, or partly while offering a narrower
 * alternative such as "I can't build that, but I can help you build a simulator instead").
 *
 * A refusal must never be forwarded to the coding agent as if it were an engineering instruction, and
 * Orches must never replace it with a locally written brief. When the model offers an alternative,
 * Orches may ask the model to author the brief for exactly that alternative; otherwise the run stops.
 */

export interface RefusalAnalysis {
  isRefusal: boolean;
  /** The model's own description of what it is willing to do instead, if it offered anything. */
  alternative: string | null;
}

// "can't" / "can’t" — ChatGPT usually writes the typographic apostrophe.
const APOS = "['’]";

const REFUSAL_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b(?:i|we)\\s+(?:cannot|can${APOS}?t|can\\s+not|won${APOS}?t|will\\s+not|am\\s+unable\\s+to|am\\s+not\\s+able\\s+to|must\\s+decline|have\\s+to\\s+decline|need\\s+to\\s+decline|am\\s+not\\s+going\\s+to|do\\s+not\\s+feel\\s+comfortable)\\b`,
    "i"
  ),
  new RegExp(`\\bi${APOS}m\\s+(?:unable\\s+to|not\\s+able\\s+to|not\\s+going\\s+to|not\\s+comfortable)\\b`, "i"),
  new RegExp(`\\b(?:i${APOS}m|i\\s+am)\\s+sorry,?\\s+but\\b`, "i"),
  /\bnot\s+able\s+to\s+(?:help|assist|provide|create|build|write|design)\b/i,
  new RegExp(`\\bcan(?:not|${APOS}t)\\s+(?:help|assist|support)\\s+(?:with|you\\s+(?:build|make|create|design|develop|write))\\b`, "i"),
];

/** Stricter form used on text that already sits inside an instruction block: it must OPEN with the refusal. */
const LEADING_REFUSAL = new RegExp(
  `^[\\s#*>_\\-"]*(?:sorry\\b|i${APOS}m\\s+sorry\\b|i\\s+am\\s+sorry\\b|i\\s+(?:cannot|can${APOS}?t|won${APOS}?t|will\\s+not|am\\s+unable|must\\s+decline)\\b|i${APOS}m\\s+(?:unable|not\\s+able)\\b)`,
  "i"
);

// "can"/"could" that are not negated ("can't", "cannot", "couldn't").
const CAN = `(?:can(?!${APOS}?t|not|\\s+not)|could(?!n${APOS}?t|\\s+not))`;

const ALTERNATIVE_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:but|however|instead)\\b[^.!?\\n]{0,80}\\b(?:i|we)\\s+(?:${CAN}|${APOS}d\\s+be|would\\s+be)\\b`, "i"),
  new RegExp(`\\b(?:i|we)\\s+${CAN}\\s+(?:still\\s+|instead\\s+|however\\s+)?(?:help|assist|build|create|make|design|write|develop|provide|offer|support)\\b`, "i"),
  new RegExp(`\\b(?:i${APOS}d|i\\s+would)\\s+be\\s+(?:happy|glad)\\s+to\\b`, "i"),
  /\b(?:happy|glad)\s+to\s+help\s+(?:with|you)\b/i,
  /\bwhat\s+i\s+can\s+(?:do|help\s+with|offer)\b/i,
  /\b(?:a\s+)?(?:safer|safe|permissible|acceptable)\s+alternative\b/i,
  /\binstead,?\s+(?:i|we)\b/i,
];

/** Inspect only the opening of a response: refusals lead, while briefs may mention "cannot" much later. */
const REFUSAL_WINDOW = 700;

export function analyzeRefusal(text: string, options: { requireLeading?: boolean } = {}): RefusalAnalysis {
  const clean = (text || "").trim();
  if (!clean) return { isRefusal: false, alternative: null };
  const head = clean.slice(0, REFUSAL_WINDOW);
  const isRefusal = options.requireLeading ? LEADING_REFUSAL.test(head) : REFUSAL_PATTERNS.some((p) => p.test(head));
  if (!isRefusal) return { isRefusal: false, alternative: null };
  return { isRefusal: true, alternative: extractAlternative(clean) };
}

/** The part of a refusal where the model describes what it will do instead (bounded excerpt). */
export function extractAlternative(text: string): string | null {
  let best = -1;
  for (const p of ALTERNATIVE_PATTERNS) {
    const m = p.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  if (best === -1) return null;
  // Start at the beginning of the sentence that contains the offer.
  const before = text.slice(0, best);
  const sentenceStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("! "), before.lastIndexOf("? "));
  const start = sentenceStart === -1 ? best : sentenceStart + 1;
  const excerpt = text.slice(start, start + 2000).trim();
  return excerpt.length >= 15 ? excerpt : null;
}

/** Follow-up asking the model to author the brief for the alternative it offered itself. */
export function buildAlternativeFollowUp(alternative: string, taskText: string): string {
  return [
    "Your previous reply declined the original request and offered an alternative:",
    "",
    `"""${alternative.slice(0, 2000)}"""`,
    "",
    "Please proceed ONLY with that alternative, exactly within the limits you stated yourself. Leave out everything you declined.",
    "Write the complete engineering brief for that alternative for the Antigravity coding agent, using the routing protocol:",
    "",
    "ORCHES_STATUS: INSTRUCT",
    "",
    "[ORCHES_ANTIGRAVITY_INSTRUCTION]",
    "# Implementation Mission",
    "<complete brief for the alternative, starting with a short 'Scope' section that states what is in and out of scope>",
    "[/ORCHES_ANTIGRAVITY_INSTRUCTION]",
    "",
    "If you are not willing to provide even that alternative, reply instead with:",
    "ORCHES_STATUS: STOP",
    "Reason: <your reason>",
    "",
    `(For reference, the original request began: "${taskText.trim().slice(0, 400)}${taskText.trim().length > 400 ? "…" : ""}")`,
  ].join("\n");
}
