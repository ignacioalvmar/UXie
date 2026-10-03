import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { styleText } from "node:util";
import {
  BaseEnvSchema,
  describeLlmSettings,
  llmSettingsFromEnv,
  parseEnv,
  type BaseEnv,
} from "@uxie/core";
import {
  createExtractor,
  guideToYaml,
  ingestPdf,
  loadGuidePrompts,
  type ExtractorName,
  type IngestResult,
} from "@uxie/ingest";
import { createGateway, type MockResponder } from "@uxie/llm";
import { promptsDir, repoRoot, userPath } from "../paths";

export interface IngestCliOptions {
  paper: string;
  module?: string;
  local?: boolean;
  title?: string;
  extractor?: string;
  /** commander maps `--no-guide` to `guide: false`. */
  guide?: boolean;
  provider?: string;
  /** Folder for the output instead of `fixtures/papers/<slug>`. */
  out?: string;
  force?: boolean;
}

export interface IngestCliDeps {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  mockResponder?: MockResponder;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const dim = (s: string) => styleText("dim", s);
const yellow = (s: string) => styleText("yellow", s);
const green = (s: string) => styleText("green", s);

/** Write `name`, or `alt` when `name` exists and `--force` was not given (never clobber silently). */
function writeSafely(dir: string, name: string, alt: string, content: string, force?: boolean) {
  const target = existsSync(resolve(dir, name)) && !force ? alt : name;
  writeFileSync(resolve(dir, target), content);
  return target;
}

function guideHeader(r: IngestResult): string[] {
  const g = r.guide!;
  return [
    `Teaching guide DRAFT for "${r.pagesFile.title}" (FR-5.4).`,
    `Drafted by ${g.provider}:${g.model} with ${g.promptVersion}; review and edit before approving.`,
  ];
}

/**
 * `pnpm uxie ingest <pdf> --paper <slug> --local` (FR-5.6): extract, analyze and draft a guide
 * into `fixtures/papers/<slug>/` without a database. Database ingestion arrives with M5.
 */
export async function ingestCommand(
  pdfPath: string,
  opts: IngestCliOptions,
  deps: IngestCliDeps = {},
): Promise<IngestResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const rawEnv = { ...(deps.env ?? process.env) };
  if (opts.provider) rawEnv.LLM_PROVIDER = opts.provider;
  const env: BaseEnv = parseEnv(BaseEnvSchema, rawEnv);

  if (!opts.local) {
    throw new Error(
      "Ingesting into the database arrives with M5 (data layer). Use --local to write fixture files.",
    );
  }
  if (!SLUG.test(opts.paper)) {
    throw new Error(`--paper must be a slug like "norman-doet-ch1" (got "${opts.paper}")`);
  }
  const pdfFile = userPath(pdfPath);
  if (!existsSync(pdfFile)) throw new Error(`PDF not found: ${pdfFile}`);
  const sizeMb = statSync(pdfFile).size / 1024 / 1024;
  if (sizeMb > env.MAX_PDF_MB) {
    throw new Error(
      `The PDF is ${sizeMb.toFixed(1)} MB; the limit is MAX_PDF_MB=${env.MAX_PDF_MB}.`,
    );
  }

  const extractorName = (opts.extractor ?? env.EXTRACTOR) as ExtractorName;
  if (extractorName !== "unpdf" && extractorName !== "docling") {
    throw new Error(`--extractor must be unpdf or docling (got "${String(opts.extractor)}")`);
  }
  const extractor = createExtractor(extractorName, { doclingUrl: env.DOCLING_URL });

  const settings = llmSettingsFromEnv(env);
  let cost = 0;
  const llm = createGateway(settings, {
    mockResponder: deps.mockResponder,
    onUsage: (e) => (cost += e.usage.costEur),
  });
  const drafting = opts.guide !== false;
  log(
    dim(
      `Ingesting ${pdfFile} with ${extractorName}` +
        (drafting ? ` · guide by ${describeLlmSettings(settings).tutor}` : " · no guide"),
    ),
  );

  const result = await ingestPdf(new Uint8Array(readFileSync(pdfFile)), {
    extractor,
    tokenWarn: env.PAPER_TOKEN_WARN,
    title: opts.title,
    guide: drafting ? { llm, prompts: loadGuidePrompts(promptsDir) } : undefined,
    onStep: (step) => log(dim(`… ${step}`)),
  });

  const outDir = opts.out ? userPath(opts.out) : resolve(repoRoot, "fixtures/papers", opts.paper);
  mkdirSync(outDir, { recursive: true });
  const sourcePdf = resolve(outDir, "source.pdf");
  if (resolve(pdfFile) !== sourcePdf && (!existsSync(sourcePdf) || opts.force)) {
    copyFileSync(pdfFile, sourcePdf);
  }
  const pagesName = writeSafely(
    outDir,
    "pages.json",
    "pages.extracted.json",
    `${JSON.stringify(result.pagesFile, null, 2)}\n`,
    opts.force,
  );

  const { analysis } = result;
  log(
    `${green("✓")} ${analysis.pageCount} pages · ~${analysis.tokenEstimate.toLocaleString("en")} tokens · sha256 ${result.sha256.slice(0, 12)} → ${resolve(outDir, pagesName)}`,
  );
  for (const w of analysis.warnings) log(yellow(`  ! ${w.message}`));

  const g = result.guide;
  let guideName: string | undefined;
  if (g) {
    guideName = writeSafely(
      outDir,
      "guide.yaml",
      "guide.draft.yaml",
      guideToYaml(g.ok ? g.guide : (g.draft ?? {}), {
        header: guideHeader(result),
        issues: g.issues,
      }),
      opts.force,
    );
    const where = resolve(outDir, guideName);
    if (g.ok) {
      log(`${green("✓")} guide drafted${g.attempts === 2 ? " (after one repair)" : ""} → ${where}`);
    } else {
      log(yellow(`! guide draft does not validate; saved with the issues listed → ${where}`));
      for (const i of g.issues) log(yellow(`  - ${i.path}: ${i.message}`));
    }
    for (const i of g.repairedIssues) log(dim(`  first draft: ${i.path}: ${i.message}`));
    log(dim(`  cost €${cost.toFixed(4)}`));
  }
  if (pagesName !== "pages.json" || (guideName !== undefined && guideName !== "guide.yaml")) {
    log(dim("Existing files were kept; pass --force to overwrite them."));
  }
  return result;
}
