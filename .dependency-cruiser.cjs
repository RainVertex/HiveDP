// Module-resolution-level dependency rules, complementing the import-name rules in eslint.config.mjs.
// ESLint checks import specifiers, dependency-cruiser checks the resolved graph, so it catches cycles.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Backend feature graph is currently acyclic. A cycle (e.g. projects importing catalog while catalog imports projects) compiles fine under consumed-as-source TS but is a maintenance trap, so block it here.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment: "An import that does not resolve is either a typo or a missing dependency.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "feature-frontend-no-backend",
      comment:
        "Feature frontends must reach backends only over HTTP through api-client. Importing a feature backend pulls server code (prisma, secrets) into the browser bundle.",
      severity: "error",
      from: { path: "/frontend/" },
      to: { path: "/backend/" },
    },
    {
      name: "feature-backend-no-frontend",
      comment:
        "Feature backends must never import frontend code. Wire types belong in shared-types.",
      severity: "error",
      from: { path: "/backend/" },
      to: { path: "/frontend/" },
    },
    {
      name: "no-feature-imports-shell",
      comment:
        "The shell aggregates features, never the reverse. A feature importing apps/* inverts the dependency arrow.",
      severity: "error",
      from: { path: "(^|/)features/" },
      to: { path: "(^|/)apps/(api|web)/" },
    },
    {
      name: "shared-no-features-or-apps",
      comment:
        "packages/* sit underneath features and apps. If a shared package needs feature-specific logic, the abstraction belongs in the feature.",
      severity: "error",
      from: { path: "(^|/)packages/" },
      to: { path: "(^|/)(features|apps)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    // Runtime graph only. Type-only imports are erased, so type-level mutual refs aren't flagged as cycles.
    // ESLint no-restricted-imports already enforces the type-import boundary.
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default"],
    },
    includeOnly: "(^|/)(apps|features|packages)/",
    exclude: {
      path: "(node_modules|/dist/|/build/|/generated/|\\.prisma/|skeletons/|tooling/scaffolder/templates/)",
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
