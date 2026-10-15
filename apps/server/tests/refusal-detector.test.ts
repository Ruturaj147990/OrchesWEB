import { test } from "node:test";
import assert from "node:assert/strict";
import { ResponseReader } from "../src/providers/reasoning/chatgpt-web/response-reader.js";
import { analyzeRefusal } from "../src/prompts/refusal-detector.js";

const parse = (text: string) => ResponseReader.extractInstruction(text, { allowLegacyJson: true });

test("refusal with an offered alternative (typographic apostrophe) is a stop with the alternative", () => {
  const r = parse("I can’t help build operational electronic-warfare software. However, I can help you build a simulator that schedules synthetic emitter tasks.");
  assert.equal(r.action, "stop");
  assert.equal(r.isRefusal, true);
  assert.match(r.alternativeOffered ?? "", /simulator/);
});

test("plain refusal has no alternative", () => {
  const r = parse("I’m sorry, but I can’t help with that request.");
  assert.equal(r.action, "stop");
  assert.equal(r.alternativeOffered, null);
});

test("explicit STOP that proposes something else carries the alternative", () => {
  const r = parse("ORCHES_STATUS: STOP\n\nReason: This is an operational receiver. I could instead help you design a purely synthetic scheduling simulator.");
  assert.equal(r.action, "stop");
  assert.match(r.alternativeOffered ?? "", /synthetic scheduling simulator/);
});

test("refusal placed inside the instruction markers is still a refusal", () => {
  const r = parse("ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\nI can't help create targeting software, but I can help you build a training simulator instead.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
  assert.equal(r.action, "stop");
});

test("a normal brief that mentions 'cannot' is not a refusal", () => {
  const r = parse("ORCHES_STATUS: INSTRUCT\n\n[ORCHES_ANTIGRAVITY_INSTRUCTION]\n# Implementation Mission\n\nWe cannot use external databases, so use SQLite. Run npm test to verify.\n[/ORCHES_ANTIGRAVITY_INSTRUCTION]");
  assert.equal(r.action, "instruct");
  assert.match(r.instructionText, /SQLite/);
});

test("a structured brief without markers is not a refusal", () => {
  const r = parse("# Implementation Mission\n\n## Objective\nThe parser cannot accept malformed input; reject it with a clear error. Add tests and run npm test.");
  assert.equal(r.action, "instruct");
});

test("negated 'can't' is never read as an offered alternative", () => {
  assert.equal(analyzeRefusal("I’m sorry, but I can’t do that.").alternative, null);
});
