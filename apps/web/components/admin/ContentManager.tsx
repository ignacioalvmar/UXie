"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SortableList, SortButtons } from "./SortableList";
import {
  api,
  Button,
  Card,
  ErrorNote,
  Field,
  inputClass,
  LiveNote,
  slugify,
  StatusBadge,
  type ApiFailure,
} from "./ui";

/** /admin/content: modules and their papers (FR-6.1, FR-6.2). */

export interface ContentPaper {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "retired";
  currentVersionNo: number | null;
  latestVersionStatus: string | null;
}

export interface ContentModule {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  papers: ContentPaper[];
}

const MODULE_STATUS_LABEL = { draft: "Draft", published: "Published", archived: "Archived" };

export function ContentManager({ initial }: { initial: ContentModule[] }) {
  const router = useRouter();
  const [modules, setModules] = useState(initial);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [note, setNote] = useState("");

  const reorderModules = async (next: ContentModule[]) => {
    const previous = modules;
    setModules(next);
    const res = await api("/api/admin/modules", {
      method: "PATCH",
      body: { order: next.map((m) => m.id) },
    });
    if (!res.ok) {
      setModules(previous);
      setError(res.error);
    }
  };

  const reorderPapers = async (moduleId: string, papers: ContentPaper[]) => {
    const previous = modules;
    setModules((ms) => ms.map((m) => (m.id === moduleId ? { ...m, papers } : m)));
    const res = await api("/api/admin/papers", {
      method: "PATCH",
      body: { moduleId, order: papers.map((p) => p.id) },
    });
    if (!res.ok) {
      setModules(previous);
      setError(res.error);
    }
  };

  const patchModule = async (id: string, patch: Partial<ContentModule>) => {
    setError(null);
    const res = await api<{ module: ContentModule }>(`/api/admin/modules/${id}`, {
      method: "PATCH",
      body: patch,
    });
    if (!res.ok) return (setError(res.error), false);
    setModules((ms) =>
      ms.map((m) => (m.id === id ? { ...m, ...res.data.module, papers: m.papers } : m)),
    );
    setNote(`Saved “${res.data.module.title}”.`);
    return true;
  };

  return (
    <div className="flex flex-col gap-6">
      <ErrorNote error={error} />
      <LiveNote>{note}</LiveNote>
      <NewModuleForm
        onCreated={(m) => {
          setModules((ms) => [...ms, { ...m, papers: [] }]);
          setNote(`Module “${m.title}” created as a draft.`);
        }}
      />
      {modules.length === 0 ? (
        <p className="text-ink-muted">No modules yet. Create the first one above.</p>
      ) : (
        <SortableList
          items={modules}
          getKey={(m) => m.id}
          getLabel={(m) => m.title}
          onReorder={reorderModules}
          className="flex flex-col gap-4"
          render={(m, controls) => (
            <ModuleCard
              module={m}
              sort={<SortButtons controls={controls} label={`module ${m.title}`} />}
              onPatch={(patch) => patchModule(m.id, patch)}
              onReorderPapers={(papers) => reorderPapers(m.id, papers)}
              onPaperCreated={(p) => router.push(`/admin/papers/${p.id}?new=1`)}
            />
          )}
        />
      )}
    </div>
  );
}

function ModuleCard({
  module: m,
  sort,
  onPatch,
  onReorderPapers,
  onPaperCreated,
}: {
  module: ContentModule;
  sort: React.ReactNode;
  onPatch: (patch: Partial<ContentModule>) => Promise<boolean>;
  onReorderPapers: (papers: ContentPaper[]) => void;
  onPaperCreated: (p: { id: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description ?? "");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const headingId = `module-${m.id}`;

  const run = async (key: string, patch: Partial<ContentModule>) => {
    setBusy(key);
    const ok = await onPatch(patch);
    setBusy(null);
    return ok;
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {sort}
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-xl font-bold">
              {m.title}
            </h2>
            <p className="text-sm text-ink-muted">
              <code>{m.slug}</code> · {m.papers.length} paper{m.papers.length === 1 ? "" : "s"}
            </p>
            {m.description && <p className="mt-1 text-ink-muted">{m.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={m.status} label={MODULE_STATUS_LABEL[m.status]} />
          <Button variant="ghost" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            Rename
          </Button>
          {m.status !== "published" && (
            <Button
              variant="primary"
              busy={busy === "publish"}
              onClick={() => run("publish", { status: "published" })}
            >
              Publish
            </Button>
          )}
          {m.status === "published" && (
            <Button busy={busy === "draft"} onClick={() => run("draft", { status: "draft" })}>
              Unpublish
            </Button>
          )}
          {m.status !== "archived" && (
            <Button
              busy={busy === "archive"}
              onClick={() => run("archive", { status: "archived" })}
            >
              Archive
            </Button>
          )}
        </div>
      </div>
      {m.status !== "published" && (
        <p className="text-sm text-ink-muted">
          Students see this module and its published papers only once it is published.
        </p>
      )}

      {editing && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("save", { title, description: description.trim() || null }))
              setEditing(false);
          }}
        >
          <Field label="Title">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={2}
            />
          </Field>
          <Field label="Description (shown to students)">
            <input
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" busy={busy === "save"}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {m.papers.length > 0 && (
        <SortableList
          items={m.papers}
          getKey={(p) => p.id}
          getLabel={(p) => p.title}
          onReorder={onReorderPapers}
          className="flex flex-col divide-y divide-line-soft rounded-field border border-line-soft"
          render={(p, controls) => (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
              <span className="flex min-w-0 items-center gap-1">
                <SortButtons controls={controls} label={p.title} />
                <Link
                  href={`/admin/papers/${p.id}`}
                  className="min-w-0 truncate font-bold text-primary hover:underline"
                >
                  {p.title}
                </Link>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                {p.currentVersionNo ? (
                  <span className="text-ink-muted">v{p.currentVersionNo} live</span>
                ) : (
                  <span className="text-ink-muted">not published yet</span>
                )}
                {p.latestVersionStatus &&
                  !["published", "superseded"].includes(p.latestVersionStatus) && (
                    <StatusBadge
                      status={p.latestVersionStatus}
                      label={`Latest version: ${p.latestVersionStatus}`}
                    />
                  )}
                <StatusBadge status={p.status} />
              </span>
            </div>
          )}
        />
      )}

      {adding ? (
        <NewPaperForm
          moduleId={m.id}
          onCancel={() => setAdding(false)}
          onCreated={onPaperCreated}
        />
      ) : (
        <div>
          <Button onClick={() => setAdding(true)}>Add a paper</Button>
        </div>
      )}
    </Card>
  );
}

function NewModuleForm({ onCreated }: { onCreated: (m: Omit<ContentModule, "papers">) => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ module: Omit<ContentModule, "papers"> }>("/api/admin/modules", {
      method: "POST",
      body: { title, slug, description: description.trim() || null },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onCreated(res.data.module);
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
  };

  return (
    <Card title="New module" id="new-module-h">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            required
            minLength={2}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Slug" hint="Used in links; lowercase and dashes.">
          <input
            className={inputClass}
            value={slug}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" busy={busy}>
            Create module
          </Button>
        </div>
        <div className="sm:col-span-3">
          <ErrorNote error={error} />
        </div>
      </form>
    </Card>
  );
}

function NewPaperForm({
  moduleId,
  onCancel,
  onCreated,
}: {
  moduleId: string;
  onCancel: () => void;
  onCreated: (p: { id: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ paper: { id: string } }>("/api/admin/papers", {
      method: "POST",
      body: {
        moduleId,
        title,
        slug,
        authors: authors
          .split(/[;,]/)
          .map((a) => a.trim())
          .filter(Boolean),
        year: year ? Number(year) : null,
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onCreated(res.data.paper);
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-field border border-line-soft bg-ground p-4 sm:grid-cols-2"
      aria-label="New paper"
    >
      <Field label="Title">
        <input
          className={inputClass}
          value={title}
          required
          minLength={2}
          autoFocus
          onChange={(e) => {
            setTitle(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field label="Slug" hint="The paper's address: /papers/<slug>.">
        <input
          className={inputClass}
          value={slug}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
        />
      </Field>
      <Field label="Authors" hint="Separate with commas.">
        <input
          className={inputClass}
          value={authors}
          onChange={(e) => setAuthors(e.target.value)}
        />
      </Field>
      <Field label="Year">
        <input
          className={inputClass}
          value={year}
          inputMode="numeric"
          pattern="(19|20|21)[0-9]{2}"
          onChange={(e) => setYear(e.target.value)}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" busy={busy}>
          Create and upload PDF
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ErrorNote error={error} />
      </div>
    </form>
  );
}
