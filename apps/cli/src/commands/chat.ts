import { createInterface } from "node:readline";
import { styleText } from "node:util";
import { parse as parseYaml } from "yaml";
import {
  BaseEnvSchema,
  Mode,
  describeEnv,
  parseEnv,
  progressView,
  type LearnerState,
  type TurnEvent,
} from "@uxie/core";
import { createGateway, type UsageEvent } from "@uxie/llm";
import {
  loadPromptDir,
  MODE_LABEL,
  TutorEngine,
  TutorError,
  tutorConfigFromEnv,
  type TurnStream,
} from "@uxie/tutor";
import {
  InMemoryConversationRepo,
  InMemoryPaperRepo,
  InMemoryProfileRepo,
  InMemoryUsageRepo,
  loadFixturePaper,
} from "@uxie/tutor/testing";
import { promptsDir, resolveFixtureDir } from "../paths";

export interface ChatOptions {
  mode: string;
  provider?: string;
  debug?: boolean;
}

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);
const cyan = (s: string) => styleText("cyan", s);
const yellow = (s: string) => styleText("yellow", s);
const red = (s: string) => styleText("red", s);

const HELP = `Commands: /stuck (Explain it to me) · /mode <understand|apply|critique|build> · /progress
          /project <text> (set your project for Apply mode) · /reset (start over) · /help · /quit`;

function stateDiff(before: LearnerState, after: LearnerState): string[] {
  const lines: string[] = [];
  for (const id of Object.keys(after.objectives)) {
    if (before.objectives[id] !== after.objectives[id])
      lines.push(`objective ${id}: ${before.objectives[id]} → ${after.objectives[id]}`);
  }
  for (const key of [
    "mode",
    "active_objective",
    "active_question_index",
    "attempts",
    "stuck_requests",
    "language",
  ] as const) {
    if (before[key] !== after[key])
      lines.push(`${key}: ${String(before[key])} → ${String(after[key])}`);
  }
  const added = after.misconceptions_seen.length - before.misconceptions_seen.length;
  if (added > 0)
    lines.push(`misconceptions: +${added} (${after.misconceptions_seen.at(-1)!.text})`);
  const resolved = after.misconceptions_seen.filter(
    (m, i) => m.resolved && !before.misconceptions_seen[i]?.resolved,
  );
  for (const m of resolved) lines.push(`misconception resolved: ${m.text}`);
  if (before.history_summary !== after.history_summary) lines.push("history_summary updated");
  return lines.length ? lines : ["(no change)"];
}

function usageLine(e: UsageEvent): string {
  const u = e.usage;
  const status = e.ok ? "" : red(` FAILED ${e.errorCode}`);
  const ttft = u.ttftMs === undefined ? "" : ` ttft ${u.ttftMs}ms`;
  return `${e.purpose.padEnd(10)} ${u.model} in ${u.inputTokens} (cached ${u.cachedInputTokens}, written ${u.cacheWriteInputTokens}) out ${u.outputTokens} · €${u.costEur.toFixed(5)} · ${u.latencyMs}ms${ttft}${status}`;
}

/** `pnpm uxie chat <fixture>`: terminal chat with the real engine on in-memory repos (PRD §10.10). */
export async function chatCommand(target: string, opts: ChatOptions): Promise<void> {
  if (opts.provider) process.env.LLM_PROVIDER = opts.provider;
  const env = parseEnv(BaseEnvSchema, process.env);
  const mode = Mode.parse(opts.mode);

  const dir = resolveFixtureDir(target);
  if (!dir) {
    throw new Error(
      `No fixture "${target}" (looked for pages.json). Database papers become available in M5.`,
    );
  }
  const fixture = loadFixturePaper(dir, { parseYaml });

  const turnUsage: UsageEvent[] = [];
  let sessionCost = 0;
  const llm = createGateway(env, {
    onUsage: (e) => {
      turnUsage.push(e);
      sessionCost += e.usage.costEur;
    },
  });

  const papers = new InMemoryPaperRepo();
  const paper = papers.add({
    versionId: crypto.randomUUID(),
    title: fixture.pagesFile.title,
    pages: fixture.pagesFile.pages,
    guide: fixture.guide,
  });
  const conversations = new InMemoryConversationRepo();
  const profiles = new InMemoryProfileRepo();
  const studentId = "cli-student";
  const engine = new TutorEngine({
    llm,
    papers,
    conversations,
    profiles,
    usage: new InMemoryUsageRepo(),
    prompts: loadPromptDir(promptsDir),
    config: tutorConfigFromEnv(env),
    logger: {
      debug: () => {},
      info: () => {},
      warn: (o, msg) =>
        opts.debug && console.error(yellow(`warn ${msg ?? ""} ${JSON.stringify(o)}`)),
      error: (o, msg) => console.error(red(`error ${msg ?? ""} ${JSON.stringify(o)}`)),
    },
  });

  const newConversation = (m: Mode) =>
    conversations.create({
      studentId,
      paperVersionId: paper.versionId,
      guide: paper.guide,
      mode: m,
      isTest: true,
    }).id;
  let conversationId = newConversation(mode);

  const info = describeEnv(env);
  console.log(bold(`\nUXie · ${paper.title}`));
  console.log(
    dim(
      `${paper.pageCount} pages · provider ${info.provider} · tutor ${info.tutorModel} · state ${info.stateModel} · mode ${MODE_LABEL[mode]}`,
    ),
  );
  console.log(dim(HELP));

  const play = async (turnPromise: Promise<TurnStream>) => {
    turnUsage.length = 0;
    try {
      const turn = await turnPromise;
      process.stdout.write(`\n${cyan("UXie ›")} `);
      for await (const chunk of turn.textStream) process.stdout.write(chunk);
      const res = await turn.done;
      process.stdout.write("\n");
      if (opts.debug && res.debug) {
        const d = res.debug;
        const help = res.help.kind === "hint" ? `hint ${res.help.index + 1}` : res.help.kind;
        console.log(
          dim(
            `\n── debug ─ help: ${help}${res.flags.shortcutRequest ? " · shortcut" : ""}${res.flags.offTopic ? " · off-topic" : ""} · prompt ${d.promptVersion} · context ${d.contextStrategy}`,
          ),
        );
        if (d.assessment) console.log(dim(`assessment ${JSON.stringify(d.assessment)}`));
        if (d.assessmentFailure)
          console.log(yellow(`assessment failed: ${d.assessmentFailure} (state kept)`));
        console.log(dim(`state    ${stateDiff(d.previousState, res.state).join(" · ")}`));
        if (res.text !== undefined && res.citations.length)
          console.log(dim(`citations ${res.citations.map((c) => c.raw).join(" ")}`));
        for (const e of turnUsage) console.log(dim(`tokens   ${usageLine(e)}`));
        console.log(dim(`session  €${sessionCost.toFixed(4)}`));
      }
      await engine.maybeSummarizeHistory(conversationId);
    } catch (e) {
      process.stdout.write("\n");
      if (e instanceof TutorError)
        console.error(red(`UXie could not reply (${e.code}): ${e.message}`));
      else throw e;
    }
  };

  const turn = (text: string | undefined, event: TurnEvent) =>
    engine.runTurn({
      conversationId,
      studentId,
      clientMessageId: crypto.randomUUID(),
      text,
      event,
    });

  await play(engine.startConversation(conversationId));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  const prompt = () => process.stdout.write(`\n${bold("you ›")} `);
  prompt();
  for await (const raw of rl) {
    const line = raw.trim();
    if (!process.stdin.isTTY && line) console.log(line); // echo piped input for readable transcripts
    if (!line) {
      prompt();
      continue;
    }
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    if (cmd === "/quit" || cmd === "/exit") break;
    else if (cmd === "/help") console.log(dim(HELP));
    else if (cmd === "/stuck") await play(turn(undefined, { type: "stuck" }));
    else if (cmd === "/mode") {
      const parsed = Mode.safeParse(arg);
      if (!parsed.success) console.log(yellow("Modes: understand, apply, critique, build"));
      else await play(engine.switchMode(conversationId, parsed.data));
    } else if (cmd === "/progress") {
      const conv = await conversations.get(conversationId);
      for (const p of progressView(conv.state, paper.guide)) {
        const status = {
          not_started: "Not started",
          in_progress: "In progress",
          demonstrated: "Demonstrated",
        }[p.status];
        console.log(
          `${p.active ? "›" : " "} ${p.id} ${status.padEnd(12)} ${p.statement}${p.evidence ? dim(`\n     evidence: ${p.evidence}`) : ""}`,
        );
      }
    } else if (cmd === "/project") {
      profiles.projects.set(studentId, arg);
      console.log(dim("Project saved; Apply mode will use it."));
    } else if (cmd === "/reset") {
      const conv = await conversations.get(conversationId);
      conversations.close(conversationId, "reset");
      conversationId = newConversation(conv.mode);
      console.log(dim("Started over (the old conversation stays viewable)."));
      await play(engine.startConversation(conversationId));
    } else if (cmd?.startsWith("/")) console.log(yellow(`Unknown command ${cmd}. ${HELP}`));
    else await play(turn(line, { type: "message" }));
    prompt();
  }
  rl.close();
  console.log(dim(`\nBye. Session cost €${sessionCost.toFixed(4)}.`));
}
