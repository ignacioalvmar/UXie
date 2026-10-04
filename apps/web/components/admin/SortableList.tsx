"use client";

import { useState, type ReactNode } from "react";

/**
 * Reorderable list (FR-6.1/6.2): drag & drop with the mouse, plus "Move up"/"Move down" buttons
 * as the keyboard alternative. The parent persists the new order; a polite status announces it.
 */

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
    return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export interface SortControls {
  index: number;
  count: number;
  moveUp: () => void;
  moveDown: () => void;
  /** Spread on the drag handle. */
  handle: React.HTMLAttributes<HTMLSpanElement> & { draggable: boolean };
}

export function SortableList<T>({
  items,
  getKey,
  getLabel,
  onReorder,
  render,
  className = "",
}: {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (next: T[]) => void;
  render: (item: T, controls: SortControls) => ReactNode;
  className?: string;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const commit = (from: number, to: number) => {
    if (from === to) return;
    const next = moveItem(items, from, to);
    setAnnouncement(`${getLabel(items[from]!)} moved to position ${to + 1} of ${items.length}.`);
    onReorder(next);
  };

  return (
    <>
      <ol className={className}>
        {items.map((item, index) => (
          <li
            key={getKey(item)}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              setOver(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) commit(dragging, index);
              setDragging(null);
              setOver(null);
            }}
            className={
              over === index && dragging !== null && dragging !== index
                ? "rounded-field outline-2 outline-primary outline-dashed"
                : ""
            }
          >
            {render(item, {
              index,
              count: items.length,
              moveUp: () => commit(index, index - 1),
              moveDown: () => commit(index, index + 1),
              handle: {
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", getKey(item));
                  setDragging(index);
                },
                onDragEnd: () => {
                  setDragging(null);
                  setOver(null);
                },
              },
            })}
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/** Drag handle + Move up / Move down buttons for one row. */
export function SortButtons({ controls, label }: { controls: SortControls; label: string }) {
  const btn =
    "inline-flex size-11 items-center justify-center rounded-field text-ink-muted hover:bg-panel hover:text-ink disabled:opacity-30";
  return (
    <span className="flex items-center">
      <span
        {...controls.handle}
        title="Drag to reorder"
        aria-hidden="true"
        className="hidden cursor-grab px-1 text-xl leading-none text-ink-subtle select-none sm:inline"
      >
        ⠿
      </span>
      <button
        type="button"
        className={btn}
        onClick={controls.moveUp}
        disabled={controls.index === 0}
        aria-label={`Move ${label} up`}
      >
        ↑
      </button>
      <button
        type="button"
        className={btn}
        onClick={controls.moveDown}
        disabled={controls.index === controls.count - 1}
        aria-label={`Move ${label} down`}
      >
        ↓
      </button>
    </span>
  );
}
