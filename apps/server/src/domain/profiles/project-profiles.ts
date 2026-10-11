export interface ProjectProfileDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  engineeringGuidelines: string[];
  focusAreas: string[];
  suggestedAcceptanceCriteria: string[];
}

export const BUILTIN_PROFILES: Record<string, ProjectProfileDefinition> = {
  general: {
    id: "general",
    name: "General Software",
    description: "Standard software development project with test suite, type-checking, and linting.",
    icon: "code",
    engineeringGuidelines: [
      "Keep changes bounded and maintain existing architecture and design patterns.",
      "Avoid introducing unnecessary third-party dependencies.",
      "Document key setup requirements and major technical decisions.",
      "Ensure all new or modified code is covered by automated tests.",
      "Verify the primary user workflow end-to-end before finishing.",
    ],
    focusAreas: ["Modularity", "Test coverage", "Code maintainability", "Clean abstractions"],
    suggestedAcceptanceCriteria: [
      "All automated tests and lint checks pass cleanly",
      "No compiler or type-checker warnings",
      "Core workflow behaves as specified",
    ],
  },
  frontend: {
    id: "frontend",
    name: "Frontend Application",
    description: "Client-side web application with UI components, responsive layout, and interaction states.",
    icon: "layout",
    engineeringGuidelines: [
      "Design accessible controls (semantic HTML, proper ARIA labels, keyboard navigability).",
      "Ensure responsive behavior across target viewports (desktop 1440x900 and mobile 390x844).",
      "Handle all UI states: loading, empty, error, and success states.",
      "Keep component boundaries focused and avoid prop drilling or state leakage.",
      "Never claim visual fidelity without validating rendered output or screenshot evidence.",
    ],
    focusAreas: ["Accessibility (a11y)", "Responsive layout", "State management", "Component modularity", "Zero console errors"],
    suggestedAcceptanceCriteria: [
      "UI renders correctly at desktop and mobile viewports",
      "Zero unhandled console errors or layout shifts",
      "Interactive controls respond to keyboard and click events",
    ],
  },
  backend: {
    id: "backend",
    name: "Backend / API Service",
    description: "Server-side HTTP API, database persistence, business logic, and background processing.",
    icon: "server",
    engineeringGuidelines: [
      "Enforce strict request payload validation and consistent JSON error envelopes.",
      "Maintain schema consistency and clean API contract versioning.",
      "Never log, leak, or commit secrets, credentials, or authentication tokens.",
      "Enforce authorization and authentication checks on all protected endpoints.",
      "Test database migrations on isolated temporary test databases.",
      "Consider request timeouts, payload limits, and rate limits.",
    ],
    focusAreas: ["Payload validation", "Error envelopes", "Database integrity", "Security & secrets protection", "API contracts"],
    suggestedAcceptanceCriteria: [
      "All API routes return valid status codes and consistent error envelopes",
      "Payload validation rejects malformed input with descriptive 400 responses",
      "Database migrations apply and roll back cleanly",
    ],
  },
  fullstack: {
    id: "fullstack",
    name: "Full-Stack Application",
    description: "Cohesive application spanning frontend client, backend API, and persistent storage.",
    icon: "layers",
    engineeringGuidelines: [
      "Maintain clear frontend/backend integration contracts and shared data types.",
      "Provide clear local startup instructions and documented environment variables in .env.example (without secrets).",
      "Implement resilient client-side error and loading states for all asynchronous API calls.",
      "Run integration tests against isolated test services without touching production data.",
      "Ensure client and server data validation schemas stay strictly synchronized.",
    ],
    focusAreas: ["Contract consistency", "E2E integration", "Asynchronous UX states", "Environment documentation", "Data synchronization"],
    suggestedAcceptanceCriteria: [
      "Client UI cleanly communicates with backend API endpoints",
      "Environment variables documented in .env.example with no hardcoded secrets",
      "End-to-end integration tests pass",
    ],
  },
  ai_ml: {
    id: "ai_ml",
    name: "AI / ML Project",
    description: "Machine learning, LLM pipelines, data preprocessing, model evaluation, and inference services.",
    icon: "cpu",
    engineeringGuidelines: [
      "Document data provenance, licensing, and schema assumptions.",
      "Enforce train/validation/test split integrity and verify zero data leakage between sets.",
      "Fix random seeds for reproducible evaluations and experiment tracking.",
      "Define explicit evaluation metrics, baselines, and performance thresholds.",
      "Include inference smoke tests and handle edge-case inputs (NaN, empty strings, out-of-distribution values).",
      "Never claim training quality or generalization solely from a successful command exit code.",
      "Impose strict resource and time bounds for training or fine-tuning runs.",
    ],
    focusAreas: ["Data provenance", "Leakage prevention", "Evaluation metrics", "Inference smoke testing", "Reproducibility"],
    suggestedAcceptanceCriteria: [
      "Inference smoke test executes without NaN or crashes on valid and invalid inputs",
      "Evaluation metrics recorded against established baseline thresholds",
      "Random seeds set for deterministic reproducibility",
    ],
  },
  data_science: {
    id: "data_science",
    name: "Data Science & Analytics",
    description: "Data transformation pipelines, exploratory analysis, statistical modeling, and reporting.",
    icon: "bar-chart",
    engineeringGuidelines: [
      "Enforce data schema validation and explicit missing-data handling strategies.",
      "Build reproducible, idempotent transformation pipelines.",
      "Prevent temporal data leakage (e.g., using future labels in historical feature sets).",
      "Provide clear data source documentation and explicit analysis assumptions.",
      "Include deterministic sanity checks and statistical smoke tests on transformed datasets.",
    ],
    focusAreas: ["Pipeline idempotency", "Missing-value strategy", "Schema validation", "Statistical assertions", "Leakage prevention"],
    suggestedAcceptanceCriteria: [
      "Data pipeline runs idempotently on sample datasets",
      "Schema validation asserts expected column types and constraints",
      "Missing data handled without silent record dropping",
    ],
  },
  cli_tool: {
    id: "cli_tool",
    name: "CLI / Developer Tool",
    description: "Command-line utilities, developer tooling, scripts, and terminal applications.",
    icon: "terminal",
    engineeringGuidelines: [
      "Provide comprehensive --help and --version output with clear usage examples.",
      "Use standard process exit codes (0 for success, non-zero for distinct failure classes).",
      "Handle invalid flags, unexpected arguments, and missing inputs gracefully with helpful error messages.",
      "Ensure cross-platform path handling (Windows backslashes vs POSIX slashes).",
      "Handle stdin, stdout, stderr, and non-interactive piping (NO_COLOR, CI detection).",
    ],
    focusAreas: ["Exit codes", "--help documentation", "Graceful argument parsing", "Cross-platform paths", "Stream handling"],
    suggestedAcceptanceCriteria: [
      "CLI invocation with --help returns comprehensive usage and exit code 0",
      "Invalid arguments produce descriptive error messages on stderr with non-zero exit code",
      "Core command functionality succeeds and returns exit code 0",
    ],
  },
  embedded_iot: {
    id: "embedded_iot",
    name: "Embedded / IoT",
    description: "Hardware-adjacent code, microcontroller firmware, IoT protocols, and resource-constrained systems.",
    icon: "hard-drive",
    engineeringGuidelines: [
      "Explicitly specify target architecture, board, chip revision, and toolchain versions.",
      "Adhere strictly to memory footprint, timing, and peripheral pin constraints.",
      "Distinguish simulated or unit-test output from physical hardware validation.",
      "Never claim electrical compatibility, RF compliance, or hardware certification without physical evidence.",
      "Structure hardware abstraction layers (HAL) cleanly so logic can be tested in host simulation.",
    ],
    focusAreas: ["Target architecture", "Memory footprint", "Hardware Abstraction Layer", "Simulated validation", "Timing constraints"],
    suggestedAcceptanceCriteria: [
      "Compilation succeeds for target toolchain without overflow warnings",
      "Host-simulated logic tests pass cleanly",
      "Hardware pin and memory configurations documented",
    ],
  },
  docs_research: {
    id: "docs_research",
    name: "Documentation & Research",
    description: "Technical specifications, architecture documentation, research reports, and guides.",
    icon: "book-open",
    engineeringGuidelines: [
      "Provide verifiable source attribution for all factual and technical claims.",
      "Strictly distinguish proven facts, working assumptions, and proposed features.",
      "Validate that all internal and external markdown links are unbroken.",
      "Never fabricate citations, benchmarks, or test results.",
      "Explicitly state what has been verified versus what remains unverified.",
    ],
    focusAreas: ["Fact vs assumption clarity", "Unbroken links", "Source attribution", "Accurate technical terminology"],
    suggestedAcceptanceCriteria: [
      "Documentation builds cleanly without broken cross-references",
      "Factual claims include sources or clear assumptions notice",
      "Structure conforms to markdown/linter standards",
    ],
  },
  custom: {
    id: "custom",
    name: "Custom / Blank",
    description: "Open-ended project without specialized framework assumptions beyond core safety.",
    icon: "sliders",
    engineeringGuidelines: [
      "Follow existing workspace conventions and coding styles.",
      "Keep changes focused strictly on fulfilling the user's objective.",
      "Ensure all automated checks detected in the workspace pass.",
      "Preserve existing architecture and avoid speculative additions.",
    ],
    focusAreas: ["Task adherence", "Workspace consistency", "Safety preservation"],
    suggestedAcceptanceCriteria: [
      "User task objectives fulfilled",
      "Project checks continue to pass",
    ],
  },
};

export function getProjectProfile(id: string): ProjectProfileDefinition {
  return BUILTIN_PROFILES[id] || BUILTIN_PROFILES.general;
}

export function listProjectProfiles(): ProjectProfileDefinition[] {
  return Object.values(BUILTIN_PROFILES);
}
