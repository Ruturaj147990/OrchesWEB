import React from "react";
import { IdeConnectionDeck } from "../features/ide/IdeConnectionDeck";
import { ProjectData } from "./OverviewPage";

interface IdePageProps {
  project: ProjectData | null;
  onProjectUpdated?: (p: ProjectData) => void;
}

export function IdePage({ project, onProjectUpdated }: IdePageProps) {
  return (
    <div className="content-container">
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>
          Visible Antigravity IDE Integration
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Connect the orchestrator to your active native Antigravity IDE editor. Prompts and file modifications stream live into your active window.
        </p>
      </div>

      {/* Render the full tested IDE Connection Deck */}
      <IdeConnectionDeck
        projectRootPath={project?.rootPath}
        onProjectUpdated={onProjectUpdated}
      />
    </div>
  );
}
