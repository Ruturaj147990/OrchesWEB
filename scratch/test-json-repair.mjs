import { extractJsonFromText } from "../apps/server/dist/prompts/json-extractor.js";

// Test cases that real models produce:
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

console.log("Existing extractor on test 1 (valid escaped):", extractJsonFromText(test1) ? "OK" : "FAILED");
console.log("Existing extractor on test 2 (literal newlines):", extractJsonFromText(test2_literal_newlines) ? "OK" : "FAILED");
console.log("Existing extractor on test 3 (truncated):", extractJsonFromText(test3_truncated) ? "OK" : "FAILED");
