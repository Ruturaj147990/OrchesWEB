export interface ProjectProfile {
  id: string;
  name: string;
  description: string;
  defaultValidationCommands: {
    lint?: string;
    typecheck?: string;
    test?: string;
    build?: string;
    browserUi?: boolean;
  };
  recommendedConstraints: string[];
  suggestedAcceptanceCriteria: string[];
}

export const BUILTIN_PROFILES: Record<string, ProjectProfile> = {
  general: {
    id: "general",
    name: "General Software Project",
    description: "Standard software development project with test suite and linting.",
    defaultValidationCommands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      browserUi: false,
    },
    recommendedConstraints: ["Maintain strict type safety", "All new features require unit tests"],
    suggestedAcceptanceCriteria: ["All automated tests pass", "Clean build with no compiler warnings"],
  },
  frontend: {
    id: "frontend",
    name: "Frontend Application",
    description: "Client-side web application with UI rendering, components, and browser verification.",
    defaultValidationCommands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      browserUi: true,
    },
    recommendedConstraints: ["Responsive design across desktop and mobile", "Zero console errors on page load"],
    suggestedAcceptanceCriteria: ["Playwright browser assertions pass", "UI renders correctly at 1440x900 and 390x844 viewports"],
  },
  backend: {
    id: "backend",
    name: "Backend / API Service",
    description: "Server-side HTTP API, database, and background processing service.",
    defaultValidationCommands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      browserUi: false,
    },
    recommendedConstraints: ["Strict payload validation on all endpoints", "No secrets in logs or responses"],
    suggestedAcceptanceCriteria: ["Integration tests verify error envelopes", "Database migrations apply cleanly"],
  },
  fullstack: {
    id: "fullstack",
    name: "Full-Stack Application",
    description: "Combined frontend client and backend API application.",
    defaultValidationCommands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      browserUi: true,
    },
    recommendedConstraints: ["End-to-end integration tests required", "Consistent types across client and server"],
    suggestedAcceptanceCriteria: ["Fullstack smoke test passes", "Browser UI correctly renders server data"],
  },
  ai_ml: {
    id: "ai_ml",
    name: "AI / ML Project",
    description: "Machine learning model development, training pipeline, and inference service.",
    defaultValidationCommands: {
      lint: "npm run lint",
      test: "npm test",
      browserUi: false,
    },
    recommendedConstraints: ["Record data provenance and metric evaluations", "Deterministic random seeds"],
    suggestedAcceptanceCriteria: ["Inference smoke test passes without NaN", "Evaluation metrics logged"],
  },
  cli_tool: {
    id: "cli_tool",
    name: "CLI / Developer Tool",
    description: "Command-line interface application and developer utilities.",
    defaultValidationCommands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      test: "npm test",
      build: "npm run build",
      browserUi: false,
    },
    recommendedConstraints: ["Documented exit codes", "Proper help text on --help"],
    suggestedAcceptanceCriteria: ["CLI invocation test verifies exit codes", "Packaging succeeds"],
  },
};

export function getProfile(id: string): ProjectProfile {
  return BUILTIN_PROFILES[id] || BUILTIN_PROFILES.general;
}
