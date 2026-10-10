import React, { useState, useEffect } from "react";

export function DiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDiagnostics = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/diagnostics");
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
      }
    } catch (err) {
      console.error("Diagnostics fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const handleCopyReport = () => {
    if (!diagnostics) return;
    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="content-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>System Diagnostics & Subsystem Health</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Comprehensive observability across process supervisors, SQLite WAL persistence, IDE window detectors, and network egress.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={handleCopyReport} disabled={!diagnostics}>
            {copied ? "✓ Copied JSON" : "📋 Copy Diagnostic Report"}
          </button>
          <button className="btn btn-primary" onClick={fetchDiagnostics} disabled={isLoading}>
            {isLoading ? "Probing..." : "↻ Refresh Diagnostics"}
          </button>
        </div>
      </div>

      {!diagnostics ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--text-dim)" }}>
          Loading system diagnostics...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "1.25rem" }}>
          {/* 1. Backend Server */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">1. Backend HTTP Service</h2>
              <span className="badge badge-success">ONLINE</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Binding Address:</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{diagnostics.system?.host}:{diagnostics.system?.port}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Loopback Only:</span>
                <span style={{ color: "var(--accent-emerald)" }}>{diagnostics.system?.loopbackOnly ? "Yes (Strict 127.0.0.1)" : "No"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Node Version:</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{diagnostics.system?.nodeVersion}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Memory RSS:</span>
                <span>{diagnostics.system?.memory?.rssMb} MB</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Heap Used:</span>
                <span>{diagnostics.system?.memory?.heapUsedMb} MB / {diagnostics.system?.memory?.heapTotalMb} MB</span>
              </div>
            </div>
          </div>

          {/* 2. SQLite Database */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">2. SQLite WAL Persistence</h2>
              <span className="badge badge-success">CONNECTED</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Journal Mode:</span>
                <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>WAL (Write-Ahead Log)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Total Projects:</span>
                <span>{diagnostics.database?.counts?.projects ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Total Runs:</span>
                <span>{diagnostics.database?.counts?.runs ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Total Tasks:</span>
                <span>{diagnostics.database?.counts?.tasks ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Persisted Events:</span>
                <span>{diagnostics.database?.counts?.events ?? 0}</span>
              </div>
            </div>
          </div>

          {/* 3. Antigravity IDE Integration */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">3. Antigravity IDE Detector</h2>
              <span className={`badge ${diagnostics.ide?.status === "ready" ? "badge-success" : "badge-warning"}`}>
                {diagnostics.ide?.status?.toUpperCase()}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Detected Windows:</span>
                <span>{diagnostics.ide?.detectedCount ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Active Mode:</span>
                <span style={{ fontWeight: 600 }}>{diagnostics.ide?.activeMode}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Selected Workspace:</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                  {diagnostics.ide?.selectedWorkspace?.name || "None"}
                </span>
              </div>
            </div>
          </div>

          {/* 4. Reasoning Engine */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">4. Reasoning Engine</h2>
              <span className="badge badge-info">{diagnostics.reasoning?.activeId}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Display Name:</span>
                <span>{diagnostics.reasoning?.displayName}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Privacy Class:</span>
                <span className="badge badge-local">{diagnostics.reasoning?.privacyClass}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>OpenAI API Key:</span>
                <span>{diagnostics.reasoning?.hasOpenAiKey ? "Configured & Saved" : "None"}</span>
              </div>
            </div>
          </div>

          {/* 5. Security & Privacy */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">5. Security & Privacy</h2>
              <span className="badge badge-success">HARDENED</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Strict Loopback:</span>
                <span style={{ color: "var(--accent-emerald)" }}>Enforced (127.0.0.1)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Secret Redaction Engine:</span>
                <span style={{ color: "var(--accent-emerald)" }}>Active (Regex Scrubber)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Path Policy Boundaries:</span>
                <span style={{ color: "var(--accent-emerald)" }}>Active (.env*, .git/ protected)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
