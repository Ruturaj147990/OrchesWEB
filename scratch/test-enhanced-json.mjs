function sanitizeControlCharactersInJson(raw) {
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

export function extractJsonFromText(text) {
  if (!text || typeof text !== "string") return null;

  const trimmed = text.trim();
  // 1. Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Extract from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
    try {
      return JSON.parse(sanitizeControlCharactersInJson(fenceMatch[1].trim()));
    } catch {}
  }

  // 3. Extract outermost { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      return JSON.parse(sanitizeControlCharactersInJson(candidate));
    } catch {}
  }

  // 4. Try sanitizing control characters directly on trimmed
  try {
    return JSON.parse(sanitizeControlCharactersInJson(trimmed));
  } catch {}

  // 5. Truncated instruction JSON recovery
  const actionMatch = trimmed.match(/"action"\s*:\s*"([^"]+)"/i);
  const instructionMatch = trimmed.match(/"instruction"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"rationale"|"\s*\}|$)/i);
  const rationaleMatch = trimmed.match(/"rationale"\s*:\s*"([^"]*)"/i);
  if (actionMatch || instructionMatch) {
    const action = actionMatch ? actionMatch[1] : "instruct";
    let instruction = instructionMatch ? instructionMatch[1] : "";
    instruction = instruction.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const rationale = rationaleMatch ? rationaleMatch[1] : "Recovered from model output";
    return { action, instruction, rationale };
  }

  return null;
}

const test1 = `{
  "action": "instruct",
  "instruction": "# Engineering Brief\\n\\n## 1. Scope\\nImplement feature X\\nand feature Y.",
  "rationale": "Direct implementation"
}`;

const test2_literal_newlines = `{
  "action": "instruct",
  "instruction": "# Engineering Brief

## 1. Scope
Implement feature X
and feature Y.",
  "rationale": "Direct implementation"
}`;

const test3_truncated = `{
  "action": "instruct",
  "instruction": "# Engineering Brief

## 1. Scope
Implement feature X with full validation and tests.`;

console.log("Test 1:", extractJsonFromText(test1) ? "OK" : "FAILED");
console.log("Test 2 (literal newlines):", extractJsonFromText(test2_literal_newlines) ? "OK" : "FAILED");
console.log("Test 3 (truncated):", extractJsonFromText(test3_truncated) ? "OK" : "FAILED");
console.log("Test 3 extracted content:", extractJsonFromText(test3_truncated));
