import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { EnvError } from "@uxie/core";
import { TutorError } from "@uxie/tutor";
import { chatCommand } from "./commands/chat";
import { doctorCommand } from "./commands/doctor";
import { repoRoot } from "./paths";

const envFile = resolve(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Print expected failures (bad config, missing fixture) without a stack trace. */
const run =
  <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
  async (...args: A) => {
    try {
      await fn(...args);
    } catch (e) {
      if (
        e instanceof EnvError ||
        e instanceof TutorError ||
        (e instanceof Error && !process.env.DEBUG)
      ) {
        console.error(e.message);
        process.exitCode = 1;
      } else throw e;
    }
  };

/** Placeholder action for commands that land in a later milestone (PRD §16). */
const later = (milestone: string) => () => {
  console.error(`Not implemented yet: arrives with milestone ${milestone} (see docs/PRD.md §16).`);
  process.exitCode = 2;
};

const program = new Command()
  .name("uxie")
  .description("UXie instructor and operator CLI (PRD §10.10)")
  .showHelpAfterError();

program
  .command("ingest")
  .description("Extract a PDF and draft its teaching guide (FR-5.6)")
  .argument("<pdf>", "path to the PDF")
  .requiredOption("--paper <slug>", "paper slug")
  .option("--module <slug>", "module slug")
  .option("--local", "write fixtures/papers/<slug>/{pages.json,guide.yaml} without a database")
  .action(later("M3"));

const guide = program.command("guide").description("Edit teaching guides in your editor");
guide
  .command("pull")
  .argument("<paper>")
  .option("--version <n>")
  .description("Write the guide as YAML")
  .action(later("M8"));
guide
  .command("push")
  .argument("<paper>")
  .argument("<file>")
  .description("Validate and upload a YAML guide")
  .action(later("M8"));
guide
  .command("approve")
  .argument("<paper>")
  .description("Approve the draft guide")
  .action(later("M8"));

program
  .command("publish")
  .argument("<paper>")
  .description("Publish the ready version (FR-6.6)")
  .action(later("M8"));
program
  .command("retire")
  .argument("<paper>")
  .description("Retire a paper (FR-6.2)")
  .action(later("M8"));

program
  .command("chat")
  .argument("<paper-or-fixture>")
  .option("--mode <mode>", "understand | apply | critique | build", "understand")
  .option("--provider <p>", "override LLM_PROVIDER")
  .option("--debug", "print assessment, state diff and tokens")
  .description("Chat with the real tutor engine in the terminal")
  .action(run(chatCommand));

program
  .command("eval")
  .argument("<fixture>")
  .option("--profiles <list>")
  .option("--runs <n>")
  .option("--providers <list>")
  .description("Run simulated students and print a scorecard (PRD §13)")
  .action(later("M4"));

program
  .command("loadtest")
  .option("--concurrency <n>", "parallel simulated students", "5")
  .option("--duration <d>", "e.g. 2m", "2m")
  .description("Measure TTFT p95 and error rate under load (§13.4)")
  .action(later("M4"));

program
  .command("report")
  .argument("<paper>")
  .option("--named")
  .description("Class report as Markdown")
  .action(later("M9"));
program
  .command("costs")
  .option("--month <YYYY-MM>")
  .description("Cost summary")
  .action(later("M9"));
program
  .command("export")
  .option("--paper <p>")
  .option("--research", "only consenting students")
  .requiredOption("--format <fmt>", "csv | json")
  .requiredOption("--out <file>")
  .description("Export conversations (FR-7.3)")
  .action(later("M9"));
program
  .command("purge")
  .requiredOption("--before <date>")
  .option("--dry-run")
  .description("Delete conversations older than a date (FR-8.4)")
  .action(later("M9"));

program
  .command("role")
  .command("set")
  .argument("<email>")
  .argument("<role>", "student | instructor")
  .description("Assign a role (FR-1.6)")
  .action(later("M5"));

program
  .command("doctor")
  .option("--ping", "send one tiny request to the configured provider")
  .description("Validate env, database, provider, prompts and storage")
  .action(run(doctorCommand));

await program.parseAsync();
