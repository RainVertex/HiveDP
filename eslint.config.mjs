import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Architectural boundary rules. Encodes the conventions documented in CLAUDE.md
// as machine-enforced lint failures. Implemented with no-restricted-imports
// (zero extra deps, no resolver setup) rather than eslint-plugin-boundaries
// the patterns we need are simple workspace-package matches.
const featureFrontendBoundaries = {
  files: ["features/*/frontend/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@internal/app", "@internal/app/*", "@internal/backend", "@internal/backend/*"],
            message:
              "Feature frontends cannot import from apps/*. Shell-only concerns (auth, routing) must be passed in as props. Lift truly shared code into packages/.",
          },
          {
            group: ["@feature/*-backend", "@feature/*-backend/*"],
            message:
              "Feature frontends cannot import feature backends directly. Go through @internal/api-client and shared DTOs in @internal/shared-types.",
          },
          {
            group: ["@feature/*-frontend/*"],
            message:
              "Feature frontends may import another feature's public barrel (e.g. `from '@feature/teams-frontend'`) but NOT subpaths into its internals. If the symbol isn't in the target feature's barrel, ask the feature owner to export it.",
          },
        ],
      },
    ],
  },
};

const featureBackendBoundaries = {
  files: ["features/*/backend/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@internal/app", "@internal/app/*", "@internal/backend", "@internal/backend/*"],
            message:
              "Feature backends cannot import from apps/*. The api shell aggregates feature routers, not the other way around.",
          },
          {
            group: ["@feature/*-frontend", "@feature/*-frontend/*"],
            message:
              "Feature backends cannot import feature frontends — even the barrel. Wire types belong in @internal/shared-types.",
          },
        ],
      },
    ],
  },
};

const sharedPackageBoundaries = {
  files: ["packages/*/src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "@internal/app",
              "@internal/app/*",
              "@internal/backend",
              "@internal/backend/*",
              "@feature/*",
              "@feature/*/*",
            ],
            message:
              "Shared packages cannot depend on apps or features — they sit underneath both. If you need something feature-specific here, the abstraction belongs in the feature instead.",
          },
        ],
      },
    ],
  },
};

// projects-backend is migrated to the scoped projectsDb facade, so forbid the raw prisma singleton here while keeping the feature-backend boundary patterns.
const projectsBackendScopedDb = {
  files: ["features/projects/backend/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@internal/db",
            importNames: ["prisma"],
            message:
              "projects-backend is migrated to projectsDb. Import projectsDb (or coreDb) from @internal/db, not the raw prisma singleton.",
          },
        ],
        patterns: [
          {
            group: ["@internal/app", "@internal/app/*", "@internal/backend", "@internal/backend/*"],
            message:
              "Feature backends cannot import from apps/*. The api shell aggregates feature routers, not the other way around.",
          },
          {
            group: ["@feature/*-frontend", "@feature/*-frontend/*"],
            message:
              "Feature backends cannot import feature frontends — even the barrel. Wire types belong in @internal/shared-types.",
          },
        ],
      },
    ],
  },
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.prisma/**",
      "**/generated/**",
      "**/.turbo/**",
      "packages/db/src/generated/**",
      "packages/scaffolder-templates/skeletons/**",
      "tooling/scaffolder/templates/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  featureFrontendBoundaries,
  featureBackendBoundaries,
  sharedPackageBoundaries,
  projectsBackendScopedDb,
  prettier,
];
