import {
  Effort,
  LlmProvider,
  LlmSettingsSchema,
  type LlmSettings,
  type RoleModel,
} from "@uxie/core";
import { catalogEntry } from "@uxie/llm";

/**
 * A benchmark candidate (PRD §13.4): `<provider>:<model>[@effort][+<provider>:<model>]`.
 * The part after `+` is the state model (assessment, summaries). Examples:
 *   anthropic:claude-sonnet-5-5            tutor Sonnet, state model from env
 *   anthropic:claude-sonnet-5-5@medium     same at effort medium
 *   google:gemini-3.8-flash+google:gemini-3.5-flash-lite
 */
export interface ProviderSpec {
  /** The text the user typed; used as the scorecard column label. */
  label: string;
  tutor: RoleModel;
  state?: RoleModel;
  effort?: Effort;
}

function roleModel(text: string, spec: string): RoleModel {
  const i = text.indexOf(":");
  const provider = LlmProvider.safeParse(i > 0 ? text.slice(0, i) : "");
  const model = i > 0 ? text.slice(i + 1).trim() : "";
  if (!provider.success || !model) {
    throw new Error(
      `Invalid provider spec "${spec}": expected <provider>:<model>[@effort][+<provider>:<model>] with provider one of ${LlmProvider.options.join(", ")}`,
    );
  }
  return { provider: provider.data, model };
}

export function parseProviderSpec(text: string): ProviderSpec {
  const label = text.trim();
  const [tutorPart = "", statePart] = label.split("+");
  const [tutorText = "", effortText] = tutorPart.split("@");
  let effort: Effort | undefined;
  if (effortText !== undefined) {
    const parsed = Effort.safeParse(effortText.trim());
    if (!parsed.success)
      throw new Error(`Invalid effort "${effortText}" in "${label}" (low|medium|high|max)`);
    effort = parsed.data;
  }
  return {
    label,
    tutor: roleModel(tutorText.trim(), label),
    ...(statePart !== undefined ? { state: roleModel(statePart.trim(), label) } : {}),
    ...(effort ? { effort } : {}),
  };
}

/** Comma-separated list; an empty list means "the configured setup". */
export function parseProviderSpecs(list: string | undefined): ProviderSpec[] {
  return (list ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseProviderSpec);
}

/** The configured tutor/state setup as a spec, for runs without `--providers`. */
export function specFromSettings(s: LlmSettings): ProviderSpec {
  const state = s.roles.state;
  const sameState =
    state.provider === s.roles.tutor.provider && state.model === s.roles.tutor.model;
  return {
    label: `${s.roles.tutor.provider}:${s.roles.tutor.model}@${s.effort}${sameState ? "" : `+${state.provider}:${state.model}`}`,
    tutor: s.roles.tutor,
    state,
    effort: s.effort,
  };
}

/**
 * Settings for the system under test. Without an explicit state model, the configured state model
 * is kept when it is from the same provider (e.g. Haiku next to any Claude tutor); otherwise the
 * tutor model also serves as state model. Catalog prices and context windows fill gaps.
 */
export function settingsForSpec(base: LlmSettings, spec: ProviderSpec): LlmSettings {
  const state =
    spec.state ??
    (base.roles.state.provider === spec.tutor.provider ? base.roles.state : spec.tutor);
  const prices = { ...base.prices };
  for (const r of [spec.tutor, state]) {
    const price = catalogEntry(r.provider, r.model)?.price;
    if (price && !prices[r.model]) prices[r.model] = price;
  }
  const contextWindow =
    catalogEntry(spec.tutor.provider, spec.tutor.model)?.contextWindow ??
    (spec.tutor.model === base.roles.tutor.model ? base.contextWindow : 128_000);
  return LlmSettingsSchema.parse({
    ...base,
    roles: { ...base.roles, tutor: spec.tutor, state },
    effort: spec.effort ?? base.effort,
    prices,
    contextWindow,
  });
}

/**
 * Settings for the harness itself (simulated students and the judge): every role uses the judge
 * model, so all candidates are measured by the same student and the same judge.
 */
export function harnessSettings(base: LlmSettings): LlmSettings {
  const judge = base.roles.judge;
  const prices = { ...base.prices };
  const price = catalogEntry(judge.provider, judge.model)?.price;
  if (price && !prices[judge.model]) prices[judge.model] = price;
  return LlmSettingsSchema.parse({
    ...base,
    roles: { tutor: judge, state: judge, judge },
    prices,
  });
}
