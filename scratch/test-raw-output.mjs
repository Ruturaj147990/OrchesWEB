import { extractJsonFromText } from "../apps/server/dist/prompts/json-extractor.js";
import { getActiveProvider } from "../apps/server/dist/providers/reasoning/registry.js";

async function testExtraction() {
  // Test 1: JSON with unescaped newlines inside instruction string
  const jsonWithLiteralNewlines = `{\n  "action": "instruct",\n  "instruction": "# Brief\\nLine 1\nLine 2",\n  "rationale": "Test"\n}`;
  console.log("Test 1 (literal unescaped newline in JSON string):");
  console.log("extractJsonFromText result:", extractJsonFromText(jsonWithLiteralNewlines));

  // Test 2: Quick live call with Qwen3:30B
  const provider = getActiveProvider();
  console.log("\nCalling Qwen3:30B for a small prompt to observe raw output format...");
  const t0 = Date.now();
  const res = await provider.generate({
    operation: "repair_diagnosis",
    systemInstruction: `You are the Systems Architect. Reply with one JSON object only: {"action": "instruct", "instruction": "the complete substantive markdown implementation prompt", "rationale": "one sentence"}`,
    messages: [{ role: "user", content: "Implement a simple health check HTTP endpoint on port 3000." }],
    json: true,
    maxOutputTokens: 500,
  });
  console.log(`Completed in ${((Date.now() - t0)/1000).toFixed(2)}s`);
  console.log("Usage:", res.usage);
  console.log("Raw Text:\n--- START RAW ---");
  console.log(res.text);
  console.log("--- END RAW ---");
  console.log("Parsed by JSON.parse:", res.parsed);
  console.log("Parsed by extractJsonFromText:", extractJsonFromText(res.text));
}

testExtraction().catch(console.error);
