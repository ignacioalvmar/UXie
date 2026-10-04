import type { ObjectiveKind } from "../schemas/guide";
import type { LearnerState, ObjectiveStatus } from "../schemas/state";

/**
 * Class report per paper (FR-7.2). Pure: the caller loads real (non-test) conversations of the
 * paper with their version's objectives and the counters below; this module aggregates and
 * renders. Turns are the student's typed messages (button events and the opening message are not
 * turns). The north-star proxy is PRD §1.5: ≥1 understanding AND ≥1 application objective
 * demonstrated in the conversation's learner state.
 */

export interface ReportObjective {
  id: string;
  kind: ObjectiveKind;
  statement: string;
}

export interface ReportConversation {
  id: string;
  pseudonymId: string;
  versionNo: number;
  /** Objectives of the conversation's paper version (versions may differ). */
  objectives: ReportObjective[];
  state: Pick<LearnerState, "objectives" | "misconceptions_seen">;
  studentTurns: number;
  costEur: number;
}

export interface ReportCounts {
  feedbackUp: number;
  feedbackDown: number;
  tutorCalls: number;
  tutorCallsWithInvalidCitations: number;
  assessmentCalls: number;
  assessmentFailures: number;
}

export interface ClassReportInput {
  paper: { id: string; slug: string; title: string };
  generatedAt: Date;
  conversations: ReportConversation[];
  counts: ReportCounts;
  /** CLI `--named` only: pseudonym → label (email or display name). Never in the web report. */
  names?: ReadonlyMap<string, string>;
}

export interface Share {
  n: number;
  total: number;
  /** Percent with one decimal, null when total is 0. */
  pct: number | null;
}

export interface ObjectiveRow extends ReportObjective {
  /** Conversations whose version has this objective. */
  total: number;
  status: Record<ObjectiveStatus, Share>;
}

export interface StudentRow {
  pseudonymId: string;
  name?: string;
  conversations: number;
  turns: number;
  /** Objective ids demonstrated in any of the student's conversations. */
  demonstrated: string[];
  northStar: boolean;
}

export interface ClassReport {
  paper: ClassReportInput["paper"];
  generatedAt: string;
  studentsActive: number;
  conversations: number;
  medianTurns: number | null;
  totalTurns: number;
  objectives: ObjectiveRow[];
  northStar: {
    conversations: Share;
    students: Share;
    /** PRD §1.6 target population: students with ≥10 turns on this paper. */
    studentsTenTurns: Share;
  };
  misconceptions: { objective: string; text: string; conversations: number; resolved: number }[];
  helpfulness: Share;
  invalidCitationRate: Share;
  assessmentFailureRate: Share;
  costEur: number;
  costPerConversationEur: number | null;
  students: StudentRow[];
}

export const NORTH_STAR_MIN_TURNS = 10;
const STATUSES: ObjectiveStatus[] = ["not_started", "in_progress", "demonstrated"];

export function share(n: number, total: number): Share {
  return { n, total, pct: total > 0 ? Math.round((n / total) * 1000) / 10 : null };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function meetsProxy(c: ReportConversation): boolean {
  const done = (kind: ObjectiveKind) =>
    c.objectives.some((o) => o.kind === kind && c.state.objectives[o.id] === "demonstrated");
  return done("understanding") && done("application");
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function buildClassReport(input: ClassReportInput): ClassReport {
  const convs = input.conversations;

  // Objectives in the order of the newest version that has them.
  const objectives = new Map<string, ReportObjective>();
  for (const c of [...convs].sort((a, b) => b.versionNo - a.versionNo))
    for (const o of c.objectives) if (!objectives.has(o.id)) objectives.set(o.id, o);
  const objectiveRows: ObjectiveRow[] = [...objectives.values()].map((o) => {
    const having = convs.filter((c) => c.objectives.some((x) => x.id === o.id));
    const status = Object.fromEntries(
      STATUSES.map((s) => [
        s,
        share(
          having.filter((c) => (c.state.objectives[o.id] ?? "not_started") === s).length,
          having.length,
        ),
      ]),
    ) as Record<ObjectiveStatus, Share>;
    return { ...o, total: having.length, status };
  });

  const students = new Map<string, StudentRow>();
  for (const c of convs) {
    const row = students.get(c.pseudonymId) ?? {
      pseudonymId: c.pseudonymId,
      ...(input.names?.has(c.pseudonymId) ? { name: input.names.get(c.pseudonymId)! } : {}),
      conversations: 0,
      turns: 0,
      demonstrated: [],
      northStar: false,
    };
    row.conversations += 1;
    row.turns += c.studentTurns;
    for (const o of c.objectives)
      if (c.state.objectives[o.id] === "demonstrated" && !row.demonstrated.includes(o.id))
        row.demonstrated.push(o.id);
    row.northStar ||= meetsProxy(c);
    students.set(c.pseudonymId, row);
  }
  const studentRows = [...students.values()]
    .map((s) => ({ ...s, demonstrated: [...s.demonstrated].sort() }))
    .sort((a, b) => a.pseudonymId.localeCompare(b.pseudonymId));
  const tenTurns = studentRows.filter((s) => s.turns >= NORTH_STAR_MIN_TURNS);

  const misconceptions = new Map<
    string,
    { objective: string; text: string; conversations: number; resolved: number }
  >();
  for (const c of convs) {
    const seen = new Set<string>();
    for (const m of c.state.misconceptions_seen) {
      const key = `${m.objective}\u0000${normalize(m.text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = misconceptions.get(key) ?? {
        objective: m.objective,
        text: m.text.trim(),
        conversations: 0,
        resolved: 0,
      };
      row.conversations += 1;
      if (m.resolved) row.resolved += 1;
      misconceptions.set(key, row);
    }
  }

  const k = input.counts;
  const cost = convs.reduce((sum, c) => sum + c.costEur, 0);
  return {
    paper: input.paper,
    generatedAt: input.generatedAt.toISOString(),
    studentsActive: studentRows.length,
    conversations: convs.length,
    medianTurns: median(convs.map((c) => c.studentTurns)),
    totalTurns: convs.reduce((sum, c) => sum + c.studentTurns, 0),
    objectives: objectiveRows,
    northStar: {
      conversations: share(convs.filter(meetsProxy).length, convs.length),
      students: share(studentRows.filter((s) => s.northStar).length, studentRows.length),
      studentsTenTurns: share(tenTurns.filter((s) => s.northStar).length, tenTurns.length),
    },
    misconceptions: [...misconceptions.values()]
      .sort((a, b) => b.conversations - a.conversations || a.text.localeCompare(b.text))
      .slice(0, 10),
    helpfulness: share(k.feedbackUp, k.feedbackUp + k.feedbackDown),
    invalidCitationRate: share(k.tutorCallsWithInvalidCitations, k.tutorCalls),
    assessmentFailureRate: share(k.assessmentFailures, k.assessmentCalls),
    costEur: round5(cost),
    costPerConversationEur: convs.length ? round5(cost / convs.length) : null,
    students: studentRows,
  };
}

const LABEL: Record<ObjectiveStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  demonstrated: "Demonstrated",
};

export const formatShare = (s: Share) =>
  s.pct === null ? "–" : `${s.pct.toFixed(1)}% (${s.n}/${s.total})`;
export const formatEur = (n: number | null) =>
  n === null ? "–" : `€${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");

/** Markdown download / CLI output of a class report. */
export function classReportMarkdown(r: ClassReport): string {
  const out: string[] = [
    `# Class report: ${r.paper.title}`,
    "",
    `Paper \`${r.paper.slug}\` · generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC · test conversations excluded.`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Students active | ${r.studentsActive} |`,
    `| Conversations | ${r.conversations} |`,
    `| Median turns per conversation | ${r.medianTurns ?? "–"} |`,
    `| North-star proxy (conversations) | ${formatShare(r.northStar.conversations)} |`,
    `| North-star proxy (students) | ${formatShare(r.northStar.students)} |`,
    `| North-star proxy (students with ≥${NORTH_STAR_MIN_TURNS} turns) | ${formatShare(r.northStar.studentsTenTurns)} |`,
    `| Helpfulness (👍 / rated replies) | ${formatShare(r.helpfulness)} |`,
    `| Replies with an invalid citation | ${formatShare(r.invalidCitationRate)} |`,
    `| Assessment failures | ${formatShare(r.assessmentFailureRate)} |`,
    `| Cost | ${formatEur(r.costEur)} (${formatEur(r.costPerConversationEur)} per conversation) |`,
    "",
    "## Objectives",
    "",
    `| Objective | Kind | ${STATUSES.map((s) => LABEL[s]).join(" | ")} |`,
    `|---|---|${STATUSES.map(() => "---").join("|")}|`,
    ...r.objectives.map(
      (o) =>
        `| ${o.id}: ${cell(o.statement)} | ${o.kind} | ${STATUSES.map((s) => formatShare(o.status[s])).join(" | ")} |`,
    ),
    "",
    "## Top misconceptions",
    "",
  ];
  if (!r.misconceptions.length) out.push("None recorded.");
  else
    out.push(
      "| Objective | Misconception | Conversations | Resolved |",
      "|---|---|---|---|",
      ...r.misconceptions.map(
        (m) => `| ${m.objective} | ${cell(m.text)} | ${m.conversations} | ${m.resolved} |`,
      ),
    );
  const named = r.students.some((s) => s.name);
  out.push(
    "",
    "## Students",
    "",
    `| Pseudonym |${named ? " Name |" : ""} Conversations | Turns | Demonstrated | North star |`,
    `|---|${named ? "---|" : ""}---|---|---|---|`,
    ...r.students.map(
      (s) =>
        `| ${s.pseudonymId} |${named ? ` ${cell(s.name ?? "")} |` : ""} ${s.conversations} | ${s.turns} | ${s.demonstrated.join(", ") || "–"} | ${s.northStar ? "yes" : "no"} |`,
    ),
    "",
    "The north-star proxy is automatic; validate it by reading at least 10 qualifying conversations (PRD §1.5).",
    "",
  );
  return out.join("\n");
}
