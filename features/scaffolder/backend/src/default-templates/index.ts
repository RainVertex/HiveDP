// Curated self-service templates seeded into the DB on boot. The template.yaml orchestration lives
// here; the skeleton fixtures each step renders live in the RainVertex/scaffolder-templates repo.
export interface DefaultTemplate {
  identifier: string;
  source: string;
}

interface DefaultTemplateSpec {
  identifier: string;
  title: string;
  description: string;
  tags: string[];
  type: string;
  catalogKind: "service" | "website";
}

const SKELETON_REPO = "RainVertex/scaffolder-templates";

// Nunjucks tokens are escaped (\${{) so the template literal emits them verbatim instead of
// interpolating them as JavaScript.
function buildSource(t: DefaultTemplateSpec): string {
  const tags = t.tags.map((tag) => `    - ${tag}`).join("\n");
  return `apiVersion: scaffolder.platform/v1
kind: Template
metadata:
  name: ${t.identifier}
  title: ${t.title}
  description: ${t.description}
  tags:
${tags}
  annotations:
    scaffolder.platform/version: "1.0.0"
spec:
  type: ${t.type}
  parameters:
    - title: Project
      required:
        - name
        - org
      properties:
        name:
          type: string
          title: Name
          description: Repository and package name in kebab-case.
          pattern: "^[a-z][a-z0-9-]*$"
        description:
          type: string
          title: Description
          description: Short description of the project.
          default: ""
        org:
          type: string
          title: GitHub organization
          description: Organization or user that will own the new repository.
          x-github-orgs: true
        visibility:
          type: string
          title: Repository visibility
          enum:
            - private
            - public
          default: private
  steps:
    - id: render
      name: Render skeleton
      action: fetch:remote-template
      input:
        repo: ${SKELETON_REPO}
        path: ${t.identifier}/skeleton
        tokenSecret: GITHUB_TOKEN
        values:
          name: \${{ parameters.name }}
          description: \${{ parameters.description }}
    - id: publish
      name: Create GitHub repository
      action: publish:github
      input:
        org: \${{ parameters.org }}
        name: \${{ parameters.name }}
        description: \${{ parameters.description }}
        visibility: \${{ parameters.visibility }}
        defaultBranch: main
    - id: register
      name: Register in catalog
      action: catalog:register
      input:
        kind: ${t.catalogKind}
        name: \${{ parameters.name }}
        description: \${{ parameters.description }}
        repoUrl: \${{ steps.publish.output.remoteUrl }}
        githubRepoId: \${{ steps.publish.output.repoId }}
  output:
    repoUrl: \${{ steps.publish.output.remoteUrl }}
    entityId: \${{ steps.register.output.entityId }}
`;
}

const SPECS: DefaultTemplateSpec[] = [
  {
    identifier: "react-ts-spa",
    title: "React SPA (Vite + TypeScript)",
    description:
      "A Vite, React and TypeScript single-page app, pushed to a new GitHub repository and registered in the catalog.",
    tags: ["recommended", "typescript", "react", "frontend"],
    type: "website",
    catalogKind: "website",
  },
  {
    identifier: "node-ts-service",
    title: "Node service (TypeScript + Fastify)",
    description:
      "A TypeScript HTTP service built on Fastify with a health endpoint and a Dockerfile, pushed to a new GitHub repository and registered in the catalog.",
    tags: ["recommended", "typescript", "node", "service"],
    type: "service",
    catalogKind: "service",
  },
  {
    identifier: "strapi-cms-react",
    title: "Strapi CMS + React frontend",
    description:
      "A monorepo pairing a Strapi headless CMS with a React frontend wired to it, pushed to a new GitHub repository and registered in the catalog.",
    tags: ["typescript", "cms", "strapi", "react"],
    type: "service",
    catalogKind: "service",
  },
];

export const DEFAULT_TEMPLATES: DefaultTemplate[] = SPECS.map((spec) => ({
  identifier: spec.identifier,
  source: buildSource(spec),
}));
