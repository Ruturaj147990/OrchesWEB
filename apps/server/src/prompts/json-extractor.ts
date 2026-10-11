function sanitizeControlCharactersInJson(raw: string): string {
  let inString = false;
  let escaped = false;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && !escaped) {
      inString = !inString;
      out += ch;
    } else if (inString && (ch === '\n' || ch === '\r')) {
      out += ch === '\n' ? '\\n' : '';
    } else if (inString && ch === '\t') {
      out += '\\t';
    } else {
      out += ch;
    }
    escaped = ch === '\\' && !escaped;
  }
  return out;
}

/**
 * Robust JSON extractor for LLM outputs that may contain conversational text,
 * markdown fences, preamble/postscript, unescaped literal newlines in strings,
 * or truncated output.
 */
export function extractJsonFromText<T = any>(text: string): T | null {
  if (!text || typeof text !== "string") return null;

  const trimmed = text.trim();
  // 1. Direct JSON parse
  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  // 2. Extract from markdown code fences (```json ... ``` or ``` ...)
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {}
    try {
      return JSON.parse(sanitizeControlCharactersInJson(fenceMatch[1].trim())) as T;
    } catch {}
  }

  // 3. Extract outermost { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {}
    try {
      return JSON.parse(sanitizeControlCharactersInJson(candidate)) as T;
    } catch {}
  }

  // 4. Try sanitizing control characters directly on trimmed text
  try {
    return JSON.parse(sanitizeControlCharactersInJson(trimmed)) as T;
  } catch {}

  // 5. Extract outermost [ ... ]
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as T;
    } catch {}
  }

  // 6. Truncated instruction JSON recovery (when reasoning model hits token limit mid-generation)
  const actionMatch = trimmed.match(/"action"\s*:\s*"([^"]+)"/i);
  const instructionMatch = trimmed.match(/"instruction"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"rationale"|"\s*\}|$)/i);
  const rationaleMatch = trimmed.match(/"rationale"\s*:\s*"([^"]*)"/i);
  if (actionMatch || instructionMatch) {
    const action = actionMatch ? actionMatch[1] : "instruct";
    let instruction = instructionMatch ? instructionMatch[1] : "";
    instruction = instruction.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const rationale = rationaleMatch ? rationaleMatch[1] : "Recovered from model output";
    return { action, instruction, rationale } as unknown as T;
  }

  return null;
}
