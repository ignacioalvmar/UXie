"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, inputClass, LiveNote, type ApiFailure } from "../ui";

/**
 * FR-7.3 export form. The file comes back from POST /api/admin/exports and is saved through a
 * temporary object URL (a plain link cannot POST). Every export is logged on the server.
 */
export function ExportForm({
  modules,
  papers,
}: {
  modules: { id: string; title: string }[];
  papers: { id: string; title: string; moduleId: string }[];
}) {
  const router = useRouter();
  const [moduleId, setModuleId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [researchOnly, setResearchOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [note, setNote] = useState("");

  const visiblePapers = moduleId ? papers.filter((p) => p.moduleId === moduleId) : papers;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote("");
    const filters = {
      ...(moduleId ? { moduleId } : {}),
      ...(paperId ? { paperId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
    try {
      const res = await fetch("/api/admin/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters, format, researchOnly }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiFailure | null;
        setError(err ?? { code: `http_${res.status}`, message: "The export failed." });
        return;
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        `uxie-export.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      const rows = res.headers.get("x-row-count") ?? "?";
      setNote(`Downloaded ${name} (${rows} rows). The export was logged.`);
      router.refresh();
    } catch {
      setError({ code: "network_error", message: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Module (at start)">
          <select
            value={moduleId}
            onChange={(e) => {
              setModuleId(e.target.value);
              setPaperId("");
            }}
            className={inputClass}
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paper">
          <select
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
            className={inputClass}
          >
            <option value="">All papers</option>
            {visiblePapers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Conversations started from">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Started until">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">Format</legend>
        <div className="flex gap-4">
          {(["csv", "json"] as const).map((f) => (
            <label key={f} className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
              />
              {f === "csv" ? "CSV (spreadsheet, UTF-8)" : "JSON"}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={researchOnly}
          onChange={(e) => setResearchOnly(e.target.checked)}
          className="mt-1 size-5"
        />
        <span>
          <span className="font-bold">Research export</span>
          <span className="block text-sm text-ink-muted">
            Only students who consent to research use right now; students with a pending or
            completed deletion are left out. Untick for teaching use (all students).
          </span>
        </span>
      </label>
      <p className="text-sm text-ink-muted">
        Exports contain pseudonyms, never emails or account ids. Test chats are never exported.
        Store the file securely; deletions after the export do not reach copies you share.
      </p>
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          Export
        </Button>
      </div>
      <ErrorNote error={error} />
      <LiveNote>{note}</LiveNote>
    </form>
  );
}
