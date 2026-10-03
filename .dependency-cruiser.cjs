/**
 * Architecture rules from PRD §4.3. If a rule blocks you, the design is wrong: do not weaken it.
 * @type {import('dependency-cruiser').IConfiguration}
 */
const pkg = (name) => `^packages/${name}/`;
const npm = (...names) => `node_modules/(${names.join("|")})(/|$)`;

const UI_AND_INFRA = ["next", "react", "react-dom", "@supabase", "discord\\.js"];

module.exports = {
  forbidden: [
    {
      name: "core-is-pure",
      comment: "packages/core may import zod only (and its own files). No IO, no other packages.",
      severity: "error",
      from: { path: pkg("core"), pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: [pkg("core"), npm("zod")],
      },
    },
    {
      name: "core-no-node-builtins",
      comment: "packages/core is pure: no node: built-ins (IO).",
      severity: "error",
      from: { path: pkg("core"), pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "llm-boundaries",
      severity: "error",
      from: { path: pkg("llm") },
      to: {
        path: [pkg("tutor"), pkg("db"), pkg("ingest"), pkg("eval"), "^apps/", npm(...UI_AND_INFRA)],
      },
    },
    {
      name: "tutor-boundaries",
      comment: "The engine talks to storage only through ports.ts.",
      severity: "error",
      from: { path: pkg("tutor") },
      to: { path: [pkg("db"), pkg("ingest"), pkg("eval"), "^apps/", npm(...UI_AND_INFRA)] },
    },
    {
      name: "ingest-boundaries",
      severity: "error",
      from: { path: pkg("ingest") },
      to: {
        path: [
          pkg("tutor"),
          pkg("eval"),
          "^apps/",
          npm("next", "react", "react-dom", "discord\\.js"),
        ],
      },
    },
    {
      name: "db-boundaries",
      severity: "error",
      from: { path: pkg("db") },
      to: {
        path: [
          pkg("tutor"),
          pkg("llm"),
          pkg("ingest"),
          pkg("eval"),
          "^apps/",
          npm("next", "react", "react-dom"),
        ],
      },
    },
    {
      name: "eval-boundaries",
      severity: "error",
      from: { path: pkg("eval") },
      to: { path: [pkg("db"), "^apps/", npm("next", "react", "react-dom", "@supabase")] },
    },
    {
      name: "character-is-standalone",
      comment: "UI-only package; no dependency on other workspace packages.",
      severity: "error",
      from: { path: pkg("character") },
      to: { path: ["^packages/(?!character/)", "^apps/"] },
    },
    {
      name: "worker-no-ui",
      severity: "error",
      from: { path: "^apps/worker/" },
      to: { path: ["^apps/(?!worker/)", npm("next", "react", "react-dom")] },
    },
    {
      name: "apps-are-leaves",
      comment: "apps/* never import each other.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["\\.next/", "node_modules/\\.pnpm/.*/node_modules/(?!@uxie)"] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".d.ts"],
    },
  },
};
