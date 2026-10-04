"use client";

import { useState, useTransition } from "react";
import { LLM_ROLES, PROVIDER_LABEL, type LlmProvider, type LlmRole, type Price } from "@uxie/core";
import type { RolePing } from "@uxie/llm";
import type { SettingsView } from "../../../../lib/settingsView";
import { saveAiSettings, testAiSettings, type SettingsResult } from "./actions";

const ROLE_LABEL: Record<LlmRole, string> = {
  tutor: "Tutor replies",
  state: "Assessment & summaries",
  judge: "Eval judge",
};
const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "google", "openai_compatible"];
const KEYED_PROVIDERS = ["anthropic", "openai", "google", "openai_compatible"] as const;
const PRICE_FIELDS: (keyof Price)[] = ["in", "cached", "write5m", "write1h", "out"];
const PRICE_LABEL: Record<keyof Price, string> = {
  in: "Input",
  cached: "Cached input",
  write5m: "Cache write 5 m",
  write1h: "Cache write 1 h",
  out: "Output",
};

const input =
  "h-11 w-full rounded-field border-[1.5px] border-line bg-surface px-3 text-base text-ink";
const card = "flex flex-col gap-4 rounded-chip border-[1.5px] border-line-soft bg-surface p-5";

type KeyEdit = { apiKey: string; remove: boolean; baseUrl: string; workspaceId: string };

export function SettingsForm({ view }: { view: SettingsView }) {
  const [roles, setRoles] = useState(view.roles);
  const [effort, setEffort] = useState(view.effort);
  const [cacheTtl, setCacheTtl] = useState(view.cacheTtl);
  const [temperature, setTemperature] = useState(view.temperature?.toString() ?? "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(view.maxOutputTokens));
  const [contextWindow, setContextWindow] = useState(String(view.contextWindow));
  const [prices, setPrices] = useState<Record<string, Price | null>>(view.prices);
  const [keys, setKeys] = useState<Record<string, KeyEdit>>(
    Object.fromEntries(
      KEYED_PROVIDERS.map((p) => [
        p,
        {
          apiKey: "",
          remove: false,
          baseUrl: view.credentials[p].baseUrl ?? "",
          workspaceId: view.credentials[p].workspaceId ?? "",
        },
      ]),
    ),
  );
  const [result, setResult] = useState<(SettingsResult & { kind: "test" | "save" }) | null>(null);
  const [pending, start] = useTransition();

  const usedModels = [...new Set(LLM_ROLES.map((r) => roles[r].model))];
  const tutorKey = `${roles.tutor.provider}:${roles.tutor.model}`;
  const temperatureAllowed = view.temperatureAllowed[tutorKey] ?? true;

  const setRole = (role: LlmRole, patch: Partial<{ provider: LlmProvider; model: string }>) => {
    const next = { ...roles[role], ...patch };
    setRoles({ ...roles, [role]: next });
    if (patch.model && !(patch.model in prices)) {
      const known =
        view.catalog.find((c) => c.provider === next.provider && c.model === patch.model)?.price ??
        null;
      setPrices({ ...prices, [patch.model]: known });
    }
  };

  const buildUpdate = () => {
    const credentials: Record<string, Record<string, string | null>> = {};
    for (const p of KEYED_PROVIDERS) {
      const k = keys[p]!;
      const c: Record<string, string | null> = {};
      if (k.apiKey.trim()) c.apiKey = k.apiKey.trim();
      else if (k.remove) c.apiKey = null;
      if (p === "openai_compatible" && k.baseUrl !== (view.credentials[p].baseUrl ?? ""))
        c.baseUrl = k.baseUrl.trim() || null;
      if (p === "anthropic" && k.workspaceId !== (view.credentials[p].workspaceId ?? ""))
        c.workspaceId = k.workspaceId.trim() || null;
      if (Object.keys(c).length) credentials[p] = c;
    }
    const pricePatch: Record<string, Price> = {};
    for (const m of usedModels) {
      const p = prices[m];
      if (p) pricePatch[m] = p;
    }
    return {
      roles,
      effort,
      cacheTtl,
      maxOutputTokens: Number(maxOutputTokens),
      contextWindow: Number(contextWindow),
      ...(temperatureAllowed && temperature.trim() ? { temperature: Number(temperature) } : {}),
      prices: pricePatch,
      credentials,
    };
  };

  const run = (kind: "test" | "save") =>
    start(async () => {
      const res =
        kind === "test" ? await testAiSettings(buildUpdate()) : await saveAiSettings(buildUpdate());
      setResult({ ...res, kind });
      if (kind === "save" && res.ok) {
        setKeys((ks) =>
          Object.fromEntries(
            Object.entries(ks).map(([p, k]) => [p, { ...k, apiKey: "", remove: false }]),
          ),
        );
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <section className={card} aria-labelledby="roles-h">
        <h2 id="roles-h" className="font-display text-xl font-bold">
          Models per role
        </h2>
        {LLM_ROLES.map((role) => (
          <fieldset key={role} className="grid gap-3 sm:grid-cols-[12rem_1fr_1fr] sm:items-end">
            <legend className="mb-1 font-bold sm:col-span-3">{ROLE_LABEL[role]}</legend>
            <label className="flex flex-col gap-1 text-sm">
              Provider
              <select
                className={input}
                value={roles[role].provider}
                onChange={(e) => setRole(role, { provider: e.target.value as LlmProvider })}
              >
                {(PROVIDERS.includes(roles[role].provider)
                  ? PROVIDERS
                  : [roles[role].provider, ...PROVIDERS]
                ).map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Model (pick a suggestion or type any model id)
              <input
                className={input}
                list={`models-${role}`}
                value={roles[role].model}
                onChange={(e) => setRole(role, { model: e.target.value })}
              />
              <datalist id={`models-${role}`}>
                {view.catalog
                  .filter((c) => c.provider === roles[role].provider)
                  .map((c) => (
                    <option key={c.model} value={c.model}>
                      {c.label}
                    </option>
                  ))}
              </datalist>
            </label>
          </fieldset>
        ))}
      </section>

      <section className={card} aria-labelledby="gen-h">
        <h2 id="gen-h" className="font-display text-xl font-bold">
          Generation
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Effort (tutor replies)
            <select
              className={input}
              value={effort}
              onChange={(e) => setEffort(e.target.value as typeof effort)}
            >
              {["low", "medium", "high", "max"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Prompt cache lifetime
            <select
              className={input}
              value={cacheTtl}
              onChange={(e) => setCacheTtl(e.target.value as typeof cacheTtl)}
            >
              <option value="5m">5 minutes</option>
              <option value="1h">1 hour (2× write cost)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Max output tokens
            <input
              className={input}
              inputMode="numeric"
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tutor context window (tokens)
            <input
              className={input}
              inputMode="numeric"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Temperature (empty = provider default)
            <input
              className={input}
              inputMode="decimal"
              value={temperatureAllowed ? temperature : ""}
              disabled={!temperatureAllowed}
              aria-describedby="temp-hint"
              onChange={(e) => setTemperature(e.target.value)}
            />
            <span id="temp-hint" className="text-ink-subtle">
              {temperatureAllowed
                ? "Leave empty unless you have a reason."
                : `${roles.tutor.model} does not accept a temperature; the provider default is used.`}
            </span>
          </label>
        </div>
      </section>

      <section className={card} aria-labelledby="prices-h">
        <h2 id="prices-h" className="font-display text-xl font-bold">
          Prices (USD per million tokens)
        </h2>
        <p className="text-sm text-ink-subtle">
          Costs show as €0 for a model until its price is set.
        </p>
        {usedModels.map((m) => (
          <fieldset key={m} className="grid gap-2 sm:grid-cols-5">
            <legend className="mb-1 font-bold">{m}</legend>
            {PRICE_FIELDS.map((f) => (
              <label key={f} className="flex flex-col gap-1 text-sm">
                {PRICE_LABEL[f]}
                <input
                  className={input}
                  inputMode="decimal"
                  value={prices[m]?.[f] ?? ""}
                  onChange={(e) => {
                    const base = prices[m] ?? { in: 0, cached: 0, write5m: 0, write1h: 0, out: 0 };
                    setPrices({ ...prices, [m]: { ...base, [f]: Number(e.target.value) || 0 } });
                  }}
                />
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      <section className={card} aria-labelledby="keys-h">
        <h2 id="keys-h" className="font-display text-xl font-bold">
          API keys
        </h2>
        <p className="text-sm text-ink-subtle">
          Keys are write-only: they are encrypted on the server and never shown again. Free tiers
          whose terms allow training on your inputs must not be used.
        </p>
        {KEYED_PROVIDERS.map((p) => {
          const status = view.credentials[p];
          const k = keys[p]!;
          return (
            <fieldset key={p} className="flex flex-col gap-2 border-t border-line-soft pt-3">
              <legend className="font-bold">{PROVIDER_LABEL[p]}</legend>
              <p className="text-sm">
                {status.source === "stored"
                  ? `Key set ${status.keyHint ?? ""} (saved here)`
                  : status.source === "env"
                    ? `Key set ${status.keyHint ?? ""} (from the server environment)`
                    : "No key set"}
              </p>
              {status.problem && (
                <p role="alert" className="text-sm font-bold text-danger-ink">
                  {status.problem}
                </p>
              )}
              <label className="flex flex-col gap-1 text-sm">
                {status.source ? "Replace key" : "API key"}
                <input
                  className={input}
                  type="password"
                  autoComplete="off"
                  value={k.apiKey}
                  onChange={(e) => setKeys({ ...keys, [p]: { ...k, apiKey: e.target.value } })}
                />
              </label>
              {status.source === "stored" && (
                <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={k.remove}
                    onChange={(e) => setKeys({ ...keys, [p]: { ...k, remove: e.target.checked } })}
                  />
                  Remove the saved key
                </label>
              )}
              {p === "openai_compatible" && (
                <label className="flex flex-col gap-1 text-sm">
                  Base URL
                  <input
                    className={input}
                    value={k.baseUrl}
                    onChange={(e) => setKeys({ ...keys, [p]: { ...k, baseUrl: e.target.value } })}
                  />
                </label>
              )}
              {p === "anthropic" && (
                <label className="flex flex-col gap-1 text-sm">
                  Workspace id (only for organisation-level keys)
                  <input
                    className={input}
                    value={k.workspaceId}
                    onChange={(e) =>
                      setKeys({ ...keys, [p]: { ...k, workspaceId: e.target.value } })
                    }
                  />
                </label>
              )}
            </fieldset>
          );
        })}
      </section>

      <div className="rounded-chip bg-panel p-4 text-sm">
        After changing a provider or model, run the evaluation (<code>pnpm uxie eval</code>) before
        students use it, and make sure the provider is listed in the privacy notice.
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => run("test")}
          disabled={pending}
          className="inline-flex h-12 items-center rounded-field border-2 border-primary bg-surface px-5 font-bold text-primary disabled:opacity-60"
        >
          {pending && result?.kind !== "save" ? "Testing…" : "Test connection"}
        </button>
        <button
          type="button"
          onClick={() => run("save")}
          disabled={pending}
          className="inline-flex h-12 items-center rounded-field bg-primary px-5 font-bold text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          Save
        </button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {result && <ResultView result={result} />}
      </div>
    </div>
  );
}

function ResultView({ result }: { result: SettingsResult & { kind: "test" | "save" } }) {
  return (
    <div
      className={`rounded-alert border-[1.5px] p-4 ${result.ok ? "border-line-soft bg-surface" : "border-danger-line bg-danger-bg"}`}
    >
      <p className="font-bold">
        {result.ok
          ? result.kind === "save"
            ? "Saved. New turns use these settings within a minute."
            : "Connection works for every role."
          : result.kind === "save"
            ? "Not saved."
            : "The test found problems."}
      </p>
      {!result.ok && result.problems.length > 0 && (
        <ul className="list-disc pl-5">
          {result.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {result.pings && <PingList pings={result.pings} />}
    </div>
  );
}

function PingList({ pings }: { pings: RolePing[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {pings.map((r) => (
        <li key={r.role}>
          {r.ok ? "✓" : "✗"} <strong>{ROLE_LABEL[r.role]}</strong>: {r.provider} {r.model}{" "}
          {r.ok ? `answered in ${r.latencyMs} ms` : `failed (${r.errorCode}): ${r.message}`}
        </li>
      ))}
    </ul>
  );
}
