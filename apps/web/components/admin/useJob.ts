"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./ui";

/** Polls GET /api/admin/ingest-jobs/:id until the job finishes (FR-5.1 step 5). */

export interface JobState {
  job: {
    id: string;
    kind: "ingest" | "draft_guide";
    status: "queued" | "running" | "succeeded" | "failed";
    step: string | null;
    error: string | null;
    attempts: number;
  };
  versionStatus: string | null;
}

const POLL_MS = 2000;

export function useJob(jobId: string | null, onDone?: (s: JobState) => void) {
  const [state, setState] = useState<JobState | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const res = await api<JobState>(`/api/admin/ingest-jobs/${jobId}`);
      if (stopped) return;
      if (res.ok) {
        setState(res.data);
        if (res.data.job.status === "succeeded" || res.data.job.status === "failed") {
          done.current?.(res.data);
          return;
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return state;
}

const STEP_LABEL: Record<string, string> = {
  extract: "Extracting text",
  analyze: "Analysing pages",
  draft_guide: "Drafting the teaching guide (can take a few minutes)",
};

export function jobLabel(s: JobState | null): string {
  if (!s) return "Waiting for the worker…";
  const { job } = s;
  if (job.status === "queued")
    return job.attempts > 0 ? "Queued again after an error…" : "Queued for the worker…";
  if (job.status === "running") return `${STEP_LABEL[job.step ?? ""] ?? "Working"}…`;
  if (job.status === "failed") return `Failed: ${job.error ?? "unknown error"}`;
  return job.kind === "draft_guide"
    ? "New draft ready."
    : "Ready: extraction and draft guide saved.";
}
