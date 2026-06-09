import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// Patterns every feature backend shares. Composed into each per-feature config below so there is one
// source of truth (no copy-paste blocks per feature).
const featureBackendBasePatterns = [
  {
    group: ["@internal/app", "@internal/app/*", "@internal/backend", "@internal/backend/*"],
    message:
      "Feature backends cannot import from apps/*. The api shell aggregates feature routers, not the other way around.",
  },
  {
    group: ["@feature/*-frontend", "@feature/*-frontend/*"],
    message:
      "Feature backends cannot import feature frontends (even the barrel). Wire types belong in @internal/shared-types.",
  },
];

// Reads every feature backend package.json so cross-feature import rules can be derived from declared deps.
const __dirname = dirname(fileURLToPath(import.meta.url));
const featureBackends = readdirSync(join(__dirname, "features"))
  .map((dir) => {
    try {
      const pkg = JSON.parse(
        readFileSync(join(__dirname, "features", dir, "backend", "package.json"), "utf8"),
      );
      const declaredBackends = Object.keys(pkg.dependencies ?? {}).filter((d) =>
        /^@feature\/.+-backend$/.test(d),
      );
      return { dir, name: pkg.name, declaredBackends };
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const allFeatureBackendNames = featureBackends.map((f) => f.name);

// One config per feature backend: it may import only the /contract of backends it declares as deps.
// Undeclared backends are forbidden outright, declared backends are forbidden as a bare barrel (use /contract).
const featureBackendBoundaries = featureBackends.map((f) => {
  const forbidden = allFeatureBackendNames.filter(
    (n) => n !== f.name && !f.declaredBackends.includes(n),
  );
  const patterns = [...featureBackendBasePatterns];
  if (forbidden.length) {
    patterns.push({
      group: forbidden.flatMap((n) => [n, `${n}/*`]),
      message:
        "This feature backend has no declared dependency on that feature. Declare it in package.json and import its /contract, or do not couple to it.",
    });
  }
  const paths = f.declaredBackends.map((dep) => ({
    name: dep,
    message: `Import another feature backend through its narrow contract ("${dep}/contract"), not its main barrel.`,
  }));
  if (f.dir === "projects") {
    paths.push({
      name: "@internal/db",
      importNames: ["prisma"],
      message:
        "projects-backend is migrated to projectsDb. Import projectsDb (or coreDb) from @internal/db, not the raw prisma singleton.",
    });
  }
  return {
    files: [`features/${f.dir}/backend/**/*.{ts,tsx}`],
    rules: { "no-restricted-imports": ["error", { paths, patterns }] },
  };
});

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
  ...featureBackendBoundaries,
  sharedPackageBoundaries,
  prettier,
];
