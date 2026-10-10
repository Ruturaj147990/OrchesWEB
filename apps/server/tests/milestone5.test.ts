import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { closeDb } from "../src/storage/db.js";
import { BlueprintImporter } from "../src/domain/blueprints/importer.js";
import { RequirementExtractor } from "../src/domain/blueprints/requirement-extractor.js";
import { PolicyEngine } from "@orchestrator/policy-schema";

describe("Milestone 5 — Project Wizard, Autonomy Modes, Profiles, and Blueprint Import", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    closeDb();
    app = await buildApp(":memory:");
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it("imports markdown blueprint and computes SHA-256 hash", () => {
    const importer = new BlueprintImporter();
    const content = Buffer.from("# Architecture\n- Must enforce strict type safety\n- Must log all requests\n");
    const doc = importer.importFile("spec.md", content);

    expect(doc.id).toBeDefined();
    expect(doc.filename).toBe("spec.md");
    expect(doc.extension).toBe(".md");
    expect(doc.sha256).toHaveLength(64);
    expect(doc.extractedText).toContain("Must enforce strict type safety");
  });

  it("extracts candidate requirements with provenance and explicit/inferred tagging", () => {
    const importer = new BlueprintImporter();
    const extractor = new RequirementExtractor();

    const content = Buffer.from(`
# Core Specifications
- System must authenticate users via JWT
- Responsive layout across desktop and mobile
- Must persist events in SQLite WAL mode
    `);
    const doc = importer.importFile("requirements.md", content);
    const reqs = extractor.extractFromDocument("proj-test", doc);

    expect(reqs.length).toBeGreaterThanOrEqual(3);
    const jwtReq = reqs.find((r) => r.title.includes("authenticate users"));
    expect(jwtReq).toBeDefined();
    expect(jwtReq?.provenanceKind).toBe("explicit");
    expect(jwtReq?.sourceReference).toContain("requirements.md:Line");
    expect(jwtReq?.status).toBe("candidate");

    const layoutReq = reqs.find((r) => r.title.includes("Responsive layout"));
    expect(layoutReq).toBeDefined();
    expect(layoutReq?.provenanceKind).toBe("inferred");
  });

  it("imports blueprint via REST API and supports requirement approval workflow", async () => {
    // 1. Create project
    const pRes = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "Wizard Imported Project" },
    });
    const project = JSON.parse(pRes.payload);

    // 2. Upload blueprint
    const bpRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/blueprints`,
      payload: {
        filename: "MVP_BLUEPRINT.md",
        contentText: "# Features\n- Must provide loopback binding\n- Must verify tests independently",
      },
    });
    expect(bpRes.statusCode).toBe(201);
    const bpData = JSON.parse(bpRes.payload);
    expect(bpData.requirements.length).toBeGreaterThanOrEqual(2);

    // 3. Fetch requirements
    const reqsRes = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/requirements`,
    });
    expect(reqsRes.statusCode).toBe(200);
    const reqs = JSON.parse(reqsRes.payload);
    expect(reqs.length).toBeGreaterThanOrEqual(2);

    // 4. Approve first requirement
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/requirements/${reqs[0].id}`,
      payload: { status: "approved" },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = JSON.parse(patchRes.payload);
    expect(updated.status).toBe("approved");
  });

  it("lists all built-in project profile presets", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/profiles",
    });
    expect(res.statusCode).toBe(200);
    const profiles = JSON.parse(res.payload);
    expect(profiles.length).toBeGreaterThanOrEqual(6);
    expect(profiles.some((p: { id: string }) => p.id === "frontend")).toBe(true);
    expect(profiles.some((p: { id: string }) => p.id === "backend")).toBe(true);
    expect(profiles.some((p: { id: string }) => p.id === "fullstack")).toBe(true);
  });

  it("detects configuration contradictions and blocks conflicting settings", () => {
    const policy = new PolicyEngine();
    // Contradiction: local reasoning is true, but cloud fallback is enabled
    const conflicts = policy.detectContradictions("creative_within_constraints", true, true);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]).toContain("Local-only mode strictly forbids cloud fallback");
  });
});
