import { FastifyPluginAsync } from "fastify";
import { BlueprintImporter } from "../../domain/blueprints/importer.js";
import { RequirementExtractor, CandidateRequirement } from "../../domain/blueprints/requirement-extractor.js";
import { BUILTIN_PROFILES } from "@orchestrator/profile-presets";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";

// In-memory requirements store per project (in addition to requirements table)
const requirementsStore = new Map<string, CandidateRequirement[]>();

export const blueprintRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const importer = new BlueprintImporter();
  const extractor = new RequirementExtractor();
  const eventStore = new EventStore(db);

  // List available profiles
  fastify.get("/profiles", async () => {
    return Object.values(BUILTIN_PROFILES);
  });

  // Import blueprint
  fastify.post<{
    Params: { projectId: string };
    Body: { filename: string; contentBase64?: string; contentText?: string };
  }>("/projects/:projectId/blueprints", async (request, reply) => {
    const { projectId } = request.params;
    const { filename, contentBase64, contentText } = request.body;

    let buffer: Buffer;
    if (contentBase64) {
      buffer = Buffer.from(contentBase64, "base64");
    } else if (contentText) {
      buffer = Buffer.from(contentText, "utf8");
    } else {
      return reply.status(400).send({ error: "Either contentText or contentBase64 is required" });
    }

    try {
      const doc = importer.importFile(filename, buffer);
      const reqs = extractor.extractFromDocument(projectId, doc);

      requirementsStore.set(projectId, reqs);

      eventStore.record(
        projectId,
        "blueprint.imported",
        {
          filename: doc.filename,
          sha256: doc.sha256,
          byteSize: doc.byteSize,
          requirementsCount: reqs.length,
          warnings: doc.warnings,
        }
      );

      return reply.status(201).send({
        document: doc,
        requirements: reqs,
      });
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Get project requirements
  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/requirements", async (request) => {
    const { projectId } = request.params;
    return requirementsStore.get(projectId) || [];
  });

  // Edit / approve / reject a requirement
  fastify.patch<{
    Params: { projectId: string; requirementId: string };
    Body: Partial<CandidateRequirement>;
  }>("/projects/:projectId/requirements/:requirementId", async (request, reply) => {
    const { projectId, requirementId } = request.params;
    const reqs = requirementsStore.get(projectId) || [];
    const index = reqs.findIndex((r) => r.id === requirementId);

    if (index === -1) {
      return reply.status(404).send({ error: "Requirement not found" });
    }

    const updated = {
      ...reqs[index],
      ...request.body,
    };
    reqs[index] = updated;
    requirementsStore.set(projectId, reqs);

    eventStore.record(projectId, "requirement.updated", {
      requirementId,
      status: updated.status,
      title: updated.title,
    });

    return reply.status(200).send(updated);
  });
};
