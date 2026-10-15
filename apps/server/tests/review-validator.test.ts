import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviewProtocol } from "../src/prompts/review-validator.js";

const review = (status: string, verdict: string, criteria: string, repairs: string) =>
  `ORCHES_REVIEW_STATUS: ${status}\n\n[ORCHES_REVIEW]\n## Verdict\n${verdict}\n## Acceptance Criteria\n${criteria}\n## Findings\n- None.\n## Repair Instructions\n${repairs}\n## Summary\nDone.\n[/ORCHES_REVIEW]`;

test("'not met' and 'unmet' criteria are failed, not passed", () => {
  const a = parseReviewProtocol(review("REPAIR", "REPAIR", "- AC-1 — not met — scheduler missing", "- Add the scheduler"));
  assert.deepEqual(a.criteria.map((c) => c.status), ["failed"]);
  const b = parseReviewProtocol(review("ACCEPT", "ACCEPT", "- AC-1 — unmet — z", "None"));
  assert.equal(b.status, "INVALID");
});

test("empty-list phrasings do not count as repair instructions", () => {
  for (const empty of ["- None.", "No repairs required.", "(none)", "- N/A"]) {
    const r = parseReviewProtocol(review("ACCEPT", "ACCEPT", "- AC-1 — passed — implemented", empty));
    assert.equal(r.status, "ACCEPT", empty);
    assert.equal(r.repairInstructions.length, 0, empty);
  }
});

test("the status line is authoritative over free text in the Verdict section", () => {
  const repair = parseReviewProtocol(review("REPAIR", "REPAIR — not acceptable yet", "- AC-1 — failed — x", "- fix x"));
  assert.equal(repair.verdict, "repair");
  const contradictory = parseReviewProtocol(review("ACCEPT", "REPAIR", "- AC-1 — passed — y", "(none)"));
  assert.equal(contradictory.status, "INVALID");
});

test("a clean ACCEPT is accepted", () => {
  const r = parseReviewProtocol(review("ACCEPT", "ACCEPT", "- AC-1 — passed — verified by tests", "(none)"));
  assert.equal(r.status, "ACCEPT");
  assert.equal(r.verdict, "accept");
});
