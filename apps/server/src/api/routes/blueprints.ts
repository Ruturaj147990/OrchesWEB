import { FastifyPluginAsync } from "fastify";
import { BlueprintImporter } from "../../domain/blueprints/importer.js";
import { RequirementExtractor, CandidateRequirement } from "../../domain/blueprints/requirement-extractor.js";
import { BlueprintRepository } from "../../storage/repositories/blueprint-repository.js";
import { ProjectRepository } from "../../storage/repositories/project-repository.js";
import { listProjectProfiles } from "../../domain/profiles/project-profiles.js";
import { EventStore } from "../../events/event-store.js";
import { getDb } from "../../storage/db.js";

export const blueprintRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();
  const importer = new BlueprintImporter();
  const extractor = new RequirementExtractor();
  const blueprintRepo = new BlueprintRepository(db);
  const projectRepo = new ProjectRepository(db);
  const eventStore = new EventStore(db);

  // List all 10 built-in project profiles
  fastify.get("/profiles", async () => {
    return listProjectProfiles();
  });

  // List blueprints for a project
  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/blueprints", async (request, reply) => {
    const project = projectRepo.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    return blueprintRepo.listBlueprints(request.params.projectId);
  });

  // Import a blueprint document (.md, .txt, .json, .yaml, .pdf, .docx)
  fastify.post<{
    Params: { projectId: string };
    Body: { filename: string; contentBase64?: string; contentText?: string };
  }>("/projects/:projectId/blueprints", async (request, reply) => {
    const { projectId } = request.params;
    const project = projectRepo.findById(projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const { filename, contentBase64, contentText } = request.body || {};
    if (!filename || typeof filename !== "string") {
      return reply.status(400).send({ error: "Filename is required" });
    }

    let buffer: Buffer;
    if (contentBase64) {
      try {
        buffer = Buffer.from(contentBase64, "base64");
      } catch {
        return reply.status(400).send({ error: "Invalid base64 content" });
      }
    } else if (typeof contentText === "string") {
      buffer = Buffer.from(contentText, "utf8");
    } else {
      return reply.status(400).send({ error: "Either contentText or contentBase64 is required" });
    }

    try {
      const doc = importer.importFile(filename, buffer);
      const reqs = extractor.extractFromDocument(projectId, doc);

      blueprintRepo.addBlueprint(projectId, doc);
      blueprintRepo.addRequirements(reqs);

      eventStore.record(projectId, "blueprint.imported", {
        blueprintId: doc.id,
        filename: doc.filename,
        sha256: doc.sha256,
        byteSize: doc.byteSize,
        requirementsCount: reqs.length,
        warnings: doc.warnings,
      });

      return reply.status(201).send({
        document: doc,
        requirements: reqs,
      });
    } catch (err: unknown) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Delete a blueprint document
  fastify.delete<{ Params: { projectId: string; blueprintId: string } }>(
    "/projects/:projectId/blueprints/:blueprintId",
    async (request, reply) => {
      const { projectId, blueprintId } = request.params;
      const project = projectRepo.findById(projectId);
      if (!project) return reply.status(404).send({ error: "Project not found" });

      const deleted = blueprintRepo.deleteBlueprint(blueprintId);
      if (!deleted) return reply.status(404).send({ error: "Blueprint not found" });

      eventStore.record(projectId, "blueprint.deleted", { blueprintId });
      return reply.status(200).send({ success: true });
    }
  );

  // List candidate/approved requirements for a project
  fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/requirements", async (request, reply) => {
    const project = projectRepo.findById(request.params.projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    return blueprintRepo.listRequirements(request.params.projectId);
  });

  // Update a requirement (approve, reject, edit)
  fastify.patch<{
    Params: { projectId: string; requirementId: string };
    Body: Partial<Pick<CandidateRequirement, "title" | "description" | "status" | "proposedAcceptanceTest">>;
  }>("/projects/:projectId/requirements/:requirementId", async (request, reply) => {
    const { projectId, requirementId } = request.params;
    const project = projectRepo.findById(projectId);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const updated = blueprintRepo.updateRequirement(requirementId, request.body || {});
    if (!updated) return reply.status(404).send({ error: "Requirement not found" });

    eventStore.record(projectId, "requirement.updated", {
      requirementId,
      status: updated.status,
      title: updated.title,
    });

    return reply.status(200).send(updated);
  });
};
