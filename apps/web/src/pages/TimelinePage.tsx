import React, { useState } from "react";
import { ProjectData } from "./OverviewPage";

interface TimelineEvent {
  id: string;
  time: string;
  type: string;
  message: string;
}

interface TimelinePageProps {
  project: ProjectData | null;
  events: TimelineEvent[];
}

export function TimelinePage({ project, events }: TimelinePageProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const filtered = events.filter((ev) => {
    const matchesSearch =
      search === "" ||
      ev.type.toLowerCase().includes(search.toLowerCase()) ||
      ev.message.toLowerCase().includes(search.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" ||
      ev.type.toLowerCase().includes(selectedCategory.toLowerCase());

    return matchesSearch && matchesCategory;
  });

  const handleExport = (format: "json" | "markdown") => {
    if (!project) return;
    window.open(`/api/v1/projects/${project.id}/export?format=${format}`, "_blank");
  };

  return (
    <div className="content-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>Event Timeline & Audit Ledger</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Durable append-only audit stream. Captures all planning decisions, agent stdout, verifier exit codes, and operator interventions.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={() => handleExport("json")}>
            ⬇ Export JSON
          </button>
          <button className="btn btn-secondary" onClick={() => handleExport("markdown")}>
            ⬇ Export Markdown
          </button>
        </div>
      </div>

      {/* Search and Category Filters */}
      <div className="card" style={{ padding: "0.75rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search event type, task ID, or payload text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: "250px" }}
          />

          <div style={{ display: "flex", gap: "0.3rem" }}>
            {["all", "run", "task", "agent", "human", "git", "ide", "budget", "system"].map((cat) => (
              <button
                key={cat}
                className={`btn btn-sm ${selectedCategory === cat ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setSelectedCategory(cat)}
                style={{ textTransform: "capitalize", padding: "0.25rem 0.5rem" }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Audited Events</h2>
          <span className="badge">
            Showing {filtered.length} of {events.length} Events
          </span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem", color: "var(--text-dim)" }}>
            No events match query "{search}"
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {filtered.map((ev) => {
              const isExpanded = expandedEventId === ev.id;
              return (
                <div
                  key={ev.id}
                  style={{
                    padding: "0.65rem 0.85rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border-subtle)",
                    fontSize: "0.8rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                      {ev.time}
                    </span>
                    <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)" }}>
                      {ev.type}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        color: "var(--text-main)",
                        whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.78rem",
                      }}
                    >
                      {ev.message}
                    </span>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
                      style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem" }}
                    >
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  </div>

                  {isExpanded && (
                    <pre
                      className="code-block"
                      style={{
                        marginTop: "0.5rem",
                        padding: "0.5rem",
                        background: "var(--bg-surface)",
                        fontSize: "0.75rem",
                      }}
                    >
                      {ev.message}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
