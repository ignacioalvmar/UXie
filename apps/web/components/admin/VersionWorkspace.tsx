"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import type { Mode } from "@uxie/core";
import type { VersionAdminView } from "../../lib/admin/views";
import type { ChatUIMessage } from "../../lib/chat/types";
import { DeleteButton } from "./DeleteDialog";
import { ExtractionPreview } from "./ExtractionPreview";
import { GuideEditor } from "./GuideEditor";
import { TestChat } from "./TestChat";
import { jobLabel, useJob } from "./useJob";
import { api, Badge, Button, Card, ErrorNote, LiveNote, StatusBadge, type ApiFailure } from "./ui";

/**
 * /admin/versions/[id]: extraction preview → guide editor → Test as student → approve → publish
 * (FR-6.3–6.6), plus "New version from this one", retry with the other extractor (FR-5.5) and
 * guarded deletion (FR-6.7).
 */

type Tab = "extraction" | "guide" | "test";
const TABS: { id: Tab; label: string }[] = [
  { id: "extraction", label: "Extraction" },
  { id: "guide", label: "Teaching guide" },
  { id: "test", label: "Test as student" },
];

const VERSION_STATUS_TEXT: Record<string, string> = {
  uploading: "Waiting for the upload to finish.",
  processing: "The worker is extracting the text and drafting the guide.",
  ready: "Ready: check the extraction, edit and approve the guide, test it, then publish.",
  failed: "Ingestion failed.",
  published: "Published: new conversations on this paper use this version.",
  superseded: "Superseded by a newer version. Its conversations continue on it.",
};

export function VersionWorkspace({
  view,
  doclingAvailable,
  test,
}: {
  view: VersionAdminView;
  doclingAvailable: boolean;
  test: { messages: ChatUIMessage[]; conversationId: string | null; mode: Mode };
}) {
  const router = useRouter();
  const { version, paper, guide } = view;
  const [tab, setTab] = useState<Tab>(version.status === "ready" ? "guide" : "extraction");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const running =
    view.latestJob && (view.latestJob.status === "queued" || view.latestJob.status === "running")
      ? view.latestJob.id
      : null;
  const job = useJob(running, () => router.refresh());

  const canPublish =
    version.status === "ready" && guide.status === "approved" && guide.issues.length === 0;
  const canTest = !!version.pageCount && guide.issues.length === 0 && !!guide.yaml;

  const act = async (key: string, url: string, body?: unknown, onOk?: (data: never) => void) => {
    setBusy(key);
    setError(null);
    const res = await api<never>(url, { method: "POST", body });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    onOk?.(res.data);
    router.refresh();
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (i + TABS.length - 1) % TABS.length
          : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next]!.id);
    document.getElementById(`tab-${TABS[next]!.id}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={`/admin/papers/${paper.id}`} className="font-bold text-primary hover:underline">
          ← {paper.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">
            Version {version.versionNo}
          </h1>
          <StatusBadge status={version.status} />
          {view.isCurrent && <Badge tone="success">current</Badge>}
          {guide.status && <StatusBadge status={guide.status} label={`Guide ${guide.status}`} />}
        </div>
        <p className="text-ink-muted">
          {VERSION_STATUS_TEXT[version.status]}
          {view.conversations > 0 &&
            ` ${view.conversations} student conversation(s) on this version.`}
        </p>
        {running && <LiveNote>{jobLabel(job)}</LiveNote>}
        {version.status === "failed" && view.latestJob?.error && (
          <p className="rounded-field bg-danger-bg p-3 text-danger-ink">{view.latestJob.error}</p>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {version.status === "ready" && (
            <Button
              variant="primary"
              disabled={!canPublish}
              busy={busy === "publish"}
              onClick={() =>
                act("publish", `/api/admin/versions/${version.id}/publish`, undefined, () =>
                  setNote(`Version ${version.versionNo} is published.`),
                )
              }
            >
              Publish version {version.versionNo}
            </Button>
          )}
          {["ready", "published", "superseded"].includes(version.status) && (
            <Button
              busy={busy === "copy"}
              onClick={() =>
                act(
                  "copy",
                  `/api/admin/versions/${version.id}/copy`,
                  undefined,
                  (d: { versionId: string }) => router.push(`/admin/versions/${d.versionId}`),
                )
              }
            >
              New version from this one
            </Button>
          )}
          {version.status === "failed" && (
            <>
              <Button
                busy={busy === "retry"}
                onClick={() =>
                  act("retry", `/api/admin/versions/${version.id}/retry`, { extractor: null })
                }
              >
                Retry ingestion
              </Button>
              {doclingAvailable && (
                <Button
                  busy={busy === "docling"}
                  onClick={() =>
                    act("docling", `/api/admin/versions/${version.id}/retry`, {
                      extractor: "docling",
                    })
                  }
                >
                  Retry with docling (OCR)
                </Button>
              )}
            </>
          )}
        </div>
        {version.status === "ready" && !canPublish && (
          <p className="text-sm text-ink-muted">
            Publishing needs an approved guide that validates.
            {guide.status !== "approved" && " Approve the guide on the Teaching guide tab."}
          </p>
        )}
        <LiveNote>{note}</LiveNote>
        <ErrorNote error={error} />
      </Card>

      <div>
        <div
          role="tablist"
          aria-label="Version"
          className="flex flex-wrap gap-1 border-b border-line-soft"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onKeyDown={onTabKey}
              onClick={() => setTab(t.id)}
              className={`-mb-px min-h-11 border-b-[3px] px-4 font-bold ${tab === t.id ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {TABS.map((t) => (
          <div
            key={t.id}
            id={`panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${t.id}`}
            hidden={tab !== t.id}
            className="pt-4"
          >
            {t.id === "extraction" && (
              <ExtractionPreview
                versionId={version.id}
                pages={view.pages}
                warnings={view.warnings}
                tokenEstimate={version.tokenEstimate}
                page={page}
                setPage={setPage}
              />
            )}
            {t.id === "guide" &&
              (view.pages.length ? (
                <GuideEditor
                  versionId={version.id}
                  paperSlug={paper.slug}
                  versionNo={version.versionNo}
                  pageCount={version.pageCount}
                  initial={guide}
                  onChanged={() => router.refresh()}
                />
              ) : (
                <p className="text-ink-muted">The guide is available once the text is extracted.</p>
              ))}
            {t.id === "test" && (
              <TestChat
                versionId={version.id}
                canChat={canTest}
                blockedReason="Test chats need extracted pages and a teaching guide that validates. Fix and save the guide first."
                initialMessages={test.messages}
                initialConversationId={test.conversationId}
                initialMode={test.mode}
                onCite={(p) => {
                  setPage(p);
                  setTab("extraction");
                }}
              />
            )}
          </div>
        ))}
      </div>

      {!view.isCurrent && (
        <Card title="Danger zone" id="danger-h" className="border-danger-line">
          <DeleteButton
            url={`/api/admin/versions/${version.id}`}
            slug={paper.slug}
            what={`version ${version.versionNo}`}
            onDeleted={() => router.push(`/admin/papers/${paper.id}`)}
          />
        </Card>
      )}
    </div>
  );
}
