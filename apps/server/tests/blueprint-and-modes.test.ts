import { describe, it, expect, afterAll } from "vitest";
import { BlueprintImporter } from "../src/domain/blueprints/importer.js";
import { RequirementExtractor } from "../src/domain/blueprints/requirement-extractor.js";
import { BlueprintRepository } from "../src/storage/repositories/blueprint-repository.js";
import { getProjectProfile, listProjectProfiles } from "../src/domain/profiles/project-profiles.js";
import { makeApp, createProject, tempDir, removeDir } from "./helpers.js";

describe("BlueprintImporter and RequirementExtractor", () => {
  const importer = new BlueprintImporter();
  const extractor = new RequirementExtractor();

  it("imports markdown documents and extracts explicit and inferred requirements with provenance", () => {
    const md = `# E-Commerce Microservice Blueprint

## Requirements
- The system must provide a RESTful product catalog endpoint.
- All product updates shall emit a message to Kafka.
- Support search filtering by category and price range.

### Performance
- Responses must return under 200ms at p95.
`;
    const doc = importer.importFile("spec.md", Buffer.from(md, "utf8"));
    expect(doc.filename).toBe("spec.md");
    expect(doc.extension).toBe(".md");
    expect(doc.sha256).toHaveLength(64);
    expect(doc.extractedText).toContain("E-Commerce Microservice Blueprint");

    const reqs = extractor.extractFromDocument("proj-1", doc);
    expect(reqs.length).toBeGreaterThanOrEqual(4);

    const explicitReq = reqs.find((r) => r.title.toLowerCase().includes("must provide"));
    expect(explicitReq).toBeDefined();
    expect(explicitReq?.provenanceKind).toBe("explicit");
    expect(explicitReq?.sourceReference).toContain("spec.md:Line");
    expect(explicitReq?.proposedAcceptanceTest).toContain("Automated test");

    const inferredReq = reqs.find((r) => r.title.toLowerCase().includes("search filtering"));
    expect(inferredReq).toBeDefined();
    expect(inferredReq?.provenanceKind).toBe("inferred");
  });

  it("imports JSON specifications with formatted extraction", () => {
    const json = JSON.stringify({
      title: "API Specification",
      version: "2.1.0",
      endpoints: ["/health", "/metrics", "/v1/data"],
      mustSupportAuth: true,
    });
    const doc = importer.importFile("api.json", Buffer.from(json, "utf8"));
    expect(doc.extension).toBe(".json");
    expect(doc.extractedText).toContain('"endpoints"');
    const reqs = extractor.extractFromDocument("proj-1", doc);
    expect(reqs.length).toBeGreaterThan(0);
  });

  it("imports YAML configuration and blueprint files", () => {
    const yaml = `
service: user-auth
version: 1.0.0
requirements:
  - id: auth-1
    title: Users must be able to log in via OAuth2
    strict: true
`;
    const doc = importer.importFile("config.yaml", Buffer.from(yaml, "utf8"));
    expect(doc.extension).toBe(".yaml");
    expect(doc.extractedText).toContain("user-auth");
  });

  it("extracts text from machine-readable PDF stream", () => {
    // Simulated machine-readable PDF content with text stream operator
    const pdfRaw = "%PDF-1.4\nBT /F1 12 Tf (Autonomous Development Agent Blueprint) Tj ET\n";
    const doc = importer.importFile("blueprint.pdf", Buffer.from(pdfRaw, "latin1"));
    expect(doc.extension).toBe(".pdf");
    expect(doc.extractedText).toContain("Autonomous Development Agent Blueprint");
  });

  it("extracts text from DOCX xml content container", () => {
    const docxXml = '<w:document><w:body><w:p><w:t>Project Requirements for Distributed Queue</w:t></w:p></w:body></w:document>';
    const doc = importer.importFile("requirements.docx", Buffer.from(docxXml, "utf8"));
    expect(doc.extension).toBe(".docx");
    expect(doc.extractedText).toContain("Project Requirements for Distributed Queue");
  });

  it("enforces maximum file size limit (10MB)", () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024);
    expect(() => importer.importFile("huge.txt", oversized)).toThrow(/exceeds maximum allowed size/);
  });
});

describe("Project Profiles Domain", () => {
  it("provides all 10 profiles from Blueprint Section 27", () => {
    const profiles = listProjectProfiles();
    expect(profiles).toHaveLength(10);
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain("general");
    expect(ids).toContain("frontend");
    expect(ids).toContain("backend");
    expect(ids).toContain("fullstack");
    expect(ids).toContain("ai_ml");
    expect(ids).toContain("data_science");
    expect(ids).toContain("cli_tool");
    expect(ids).toContain("embedded_iot");
    expect(ids).toContain("docs_research");
    expect(ids).toContain("custom");
  });

  it("includes domain-specific engineering guidelines and focus areas", () => {
    const aiml = getProjectProfile("ai_ml");
    expect(aiml.name).toBe("AI / ML Project");
    expect(aiml.engineeringGuidelines.some((g) => g.toLowerCase().includes("leakage"))).toBe(true);
    expect(aiml.engineeringGuidelines.some((g) => g.toLowerCase().includes("random seed"))).toBe(true);
    expect(aiml.focusAreas).toContain("Data provenance");

    const fullstack = getProjectProfile("fullstack");
    expect(fullstack.engineeringGuidelines.some((g) => g.toLowerCase().includes("contract"))).toBe(true);

    const cli = getProjectProfile("cli_tool");
    expect(cli.engineeringGuidelines.some((g) => g.toLowerCase().includes("exit code"))).toBe(true);
  });
});

describe("Blueprint API and Persistence", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach(removeDir));

  it("allows uploading blueprints, extracting requirements, listing, and deleting via API", async () => {
    const { app, dataDir } = await makeApp();
    const ws = tempDir("bp-api");
    dirs.push(ws, dataDir);

    const project = await createProject(app, ws, { profileId: "fullstack", autonomyMode: "creative_exploration" });
    expect(project.id).toBeDefined();

    // 1. List profiles endpoint
    const profRes = await app.inject({ method: "GET", url: "/api/v1/profiles" });
    expect(profRes.statusCode).toBe(200);
    const profiles = profRes.json();
    expect(profiles.length).toBe(10);

    // 2. Upload blueprint
    const bpContent = `# System Architecture Blueprint\n\n- The user must authenticate with JWT\n- All API calls must return JSON`;
    const uploadRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/blueprints`,
      payload: {
        filename: "architecture.md",
        contentText: bpContent,
      },
    });
    expect(uploadRes.statusCode).toBe(201);
    const uploaded = uploadRes.json();
    expect(uploaded.document.filename).toBe("architecture.md");
    expect(uploaded.requirements.length).toBeGreaterThanOrEqual(2);

    // 3. List blueprints
    const listRes = await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/blueprints` });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);

    // 4. List extracted requirements
    const reqsRes = await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/requirements` });
    expect(reqsRes.statusCode).toBe(200);
    const reqs = reqsRes.json();
    expect(reqs.length).toBeGreaterThanOrEqual(2);

    // 5. Update requirement status
    const reqId = reqs[0].id;
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/requirements/${reqId}`,
      payload: { status: "approved" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().status).toBe("approved");

    // 6. Delete blueprint
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/blueprints/${uploaded.document.id}`,
    });
    expect(delRes.statusCode).toBe(200);

    const emptyListRes = await app.inject({ method: "GET", url: `/api/v1/projects/${project.id}/blueprints` });
    expect(emptyListRes.json()).toHaveLength(0);

    await app.close();
  });
});
