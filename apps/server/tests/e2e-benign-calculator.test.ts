import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CodingAgentAdapter, AgentExecutionInput, AgentExecutionResult } from "../src/providers/coding-agents/adapter.js";
import { EventStore } from "../src/events/event-store.js";
import { getDb } from "../src/storage/db.js";
import { ScriptedProvider, makeApp, createProject, runTask, tempDir, removeDir } from "./helpers.js";

class TrackedAntigravityCoder implements CodingAgentAdapter {
  public id = "antigravity";
  public displayName = "Native Antigravity Agent";
  public description = "Test double capturing exact Antigravity handoff instruction payload";
  public usesReasoningProvider = false;
  public capturedPrompts: string[] = [];

  constructor(
    private fileGenerator: (input: AgentExecutionInput) => { files: Record<string, string>; reply: string }
  ) {}

  async detect() {
    return { available: true, detail: "antigravity-bridge" };
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    this.capturedPrompts.push(input.instruction ?? "");
    const { files, reply } = this.fileGenerator(input);

    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(input.workspacePath, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }

    return {
      status: "completed",
      summary: reply,
      filesWritten: Object.keys(files),
      filesDeleted: [],
      rejectedWrites: [],
      warnings: [],
      transcript: {
        conversationId: `conv-${input.attemptNumber}`,
        state: "finished",
        finalReply: reply,
        toolCalls: [],
        writesOutsideWorkspace: [],
        prompt: input.instruction ?? "",
      },
    };
  }
}

describe("Section 18 Realistic Benign End-to-End Test: Python Calculator Workflow", () => {
  const cleanupDirs: string[] = [];
  afterAll(() => cleanupDirs.forEach(removeDir));

  it("executes the full Orches autonomous development loop with natural-language instruction and Antigravity handoff", async () => {
    const provider = new ScriptedProvider();

    // Model returns natural-language routing protocol with substantive engineering brief
    provider.enqueue("code_generation", () => {
      return `ORCHES_STATUS: INSTRUCT

[ORCHES_ANTIGRAVITY_INSTRUCTION]

# Implementation Mission: Python Calculator Module

## 1. Executive Objective
Build a modular Python calculator with addition, subtraction, multiplication, division, robust input validation, and unit tests.

## 2. Architecture & Design Direction
- Implement core arithmetic functions in \`calculator.py\`.
- All operations must validate that operands are integers or floats.
- Division by zero must explicitly raise a \`ValueError("Cannot divide by zero")\`.

## 3. Scope of Implementation
- \`calculator.py\`: Function implementations for \`add\`, \`subtract\`, \`multiply\`, and \`divide\`.
- \`test_calculator.py\`: Comprehensive unit test suite covering normal inputs and edge cases.

## 4. Verification Instructions
Run tests with \`python -m unittest test_calculator.py\` and ensure exit code 0.

[/ORCHES_ANTIGRAVITY_INSTRUCTION]`;
    });

    const agent = new TrackedAntigravityCoder((_input) => {
      return {
        files: {
          "calculator.py": `
def add(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("Operands must be numeric")
    return a + b

def subtract(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("Operands must be numeric")
    return a - b

def multiply(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("Operands must be numeric")
    return a * b

def divide(a, b):
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("Operands must be numeric")
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
`.trim(),
          "test_calculator.py": `
import unittest
from calculator import add, subtract, multiply, divide

class TestCalculator(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)
        self.assertEqual(add(-1, 1), 0)

    def test_subtract(self):
        self.assertEqual(subtract(5, 2), 3)

    def test_multiply(self):
        self.assertEqual(multiply(3, 4), 12)

    def test_divide(self):
        self.assertEqual(divide(10, 2), 5)
        with self.assertRaises(ValueError):
            divide(5, 0)

    def test_type_validation(self):
        with self.assertRaises(TypeError):
            add("a", 2)

if __name__ == "__main__":
    unittest.main()
`.trim(),
        },
        reply: "Implemented calculator module with input validation and comprehensive unit tests.",
      };
    });

    const { app, dataDir } = await makeApp({ provider, agent: () => agent });
    const ws = tempDir("python-calc-e2e");
    cleanupDirs.push(ws, dataDir);

    const projectSpec = `
# Project Specification: Pure Python Calculator
## Functional Requirements
- Implement addition, subtraction, multiplication, and division.
- Reject division by zero with ValueError.
- Validate operand types and reject non-numeric inputs with TypeError.

## Verification
- Unit test suite using Python's standard unittest library.
`.trim();

    // 1. Create project via documented API
    const project = await createProject(app, ws, {
      objective: projectSpec,
      autoCommit: false,
    });
    expect(project.id).toBeDefined();

    // 2. Supply blueprint document attachment
    const blueprintRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/blueprints`,
      payload: {
        filename: "CALCULATOR_SPEC.md",
        contentText: projectSpec,
      },
    });
    expect(blueprintRes.statusCode).toBe(201);

    // 3. Launch autonomous execution run
    const detail = await runTask(app, project.id, "Build Python calculator with tests and zero-division check");

    // 4. Verify run outcome and phase transitions
    expect(detail.run).toMatchObject({
      status: "completed",
      agentId: "antigravity",
    });

    // 5. Inspect the actual instruction delivered to Antigravity at handoff boundary
    expect(agent.capturedPrompts).toHaveLength(1);
    const deliveredBrief = agent.capturedPrompts[0];

    // Must be substantive Markdown, NOT a JSON envelope or task descriptor
    expect(deliveredBrief).toContain("# Implementation Mission: Python Calculator Module");
    expect(deliveredBrief).toContain("## 1. Executive Objective");
    expect(deliveredBrief).toContain("## 2. Architecture & Design Direction");
    expect(deliveredBrief).toContain("Division by zero must explicitly raise a `ValueError");
    expect(deliveredBrief).not.toContain("ORCHES_STATUS: INSTRUCT");
    expect(deliveredBrief).not.toContain("[ORCHES_ANTIGRAVITY_INSTRUCTION]");
    expect(deliveredBrief).not.toContain('{"action":');
    expect(deliveredBrief).not.toContain('{"title":');
    expect(deliveredBrief).not.toContain('"acceptance_criteria":');

    // 6. Verify filesystem state
    expect(fs.existsSync(path.join(ws, "calculator.py"))).toBe(true);
    expect(fs.existsSync(path.join(ws, "test_calculator.py"))).toBe(true);

    // 7. Verify persistence and reopenability
    const getProjectRes = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(getProjectRes.statusCode).toBe(200);
    const fetchedProject = getProjectRes.json();
    expect(fetchedProject.id).toBe(project.id);
    expect(fetchedProject.objective).toContain("Pure Python Calculator");

    // 8. Verify event ledger records fidelity check and brain instruction
    const events = new EventStore(getDb()).getEventsSince(project.id, 0);
    const instructionEvent = events.find((e: any) => e.type === "brain.instruction");
    expect(instructionEvent).toBeDefined();
    expect(instructionEvent.payload.action).toBe("instruct");
    expect(instructionEvent.payload.instruction).toContain("Python Calculator Module");

    await app.close();
  }, 60_000);
});
