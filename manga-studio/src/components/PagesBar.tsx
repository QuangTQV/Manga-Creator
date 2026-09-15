"use client";

/** Bottom dock: page navigation — add, switch, delete, drag to reorder. */

import { useState } from "react";
import { useEditorStore } from "@/editor/store";
import { CloseIcon, ICON_STROKE, PlusIcon } from "./ui/icons";

export function PagesBar() {
  const doc = useEditorStore((s) => s.doc);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  // Native HTML5 drag-and-drop: `draggingId` is the page picked up,
  // `dragOverId` is whichever page the pointer is currently over (drives
  // the drop-target highlight only — the actual move happens on drop).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  if (!doc) return null;

  const pages = Object.values(doc.pages).sort((a, b) => a.index - b.index);

  return (
    <footer className="flex h-[76px] items-center gap-2 border-t border-zinc-800 bg-zinc-900 px-3">
      <span className="mr-1 shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wider text-zinc-500">Pages</span>
      {pages.map((page) => (
        <div key={page.id} className="group relative">
          <button
            draggable
            onDragStart={(e) => {
              setDraggingId(page.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverId(null);
            }}
            onDragOver={(e) => {
              if (!draggingId || draggingId === page.id) return;
              e.preventDefault(); // required for onDrop to fire at all
              e.dataTransfer.dropEffect = "move";
              setDragOverId(page.id);
            }}
            onDragLeave={() => setDragOverId((id) => (id === page.id ? null : id))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              if (!draggingId || draggingId === page.id) return;
              useEditorStore.getState().dispatch({ type: "reorder-page", pageId: draggingId, toIndex: page.index });
            }}
            onClick={() => useEditorStore.getState().setCurrentPage(page.id)}
            className={`h-14 w-11 rounded-sm border text-[10px] transition-colors ${
              page.id === currentPageId
                ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500"
            } ${draggingId === page.id ? "opacity-40" : ""} ${
              dragOverId === page.id ? "border-2 border-[var(--accent)]" : ""
            }`}
            title={`${page.name} — drag to reorder`}
          >
            {page.index + 1}
          </button>
          {pages.length > 1 && (
            <button
              className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-950 text-[9px] text-zinc-400 hover:text-red-400 group-hover:flex"
              title={`Delete ${page.name}`}
              onClick={() => {
                if (!confirm(`Delete ${page.name} and its contents?`)) return;
                const store = useEditorStore.getState();
                store.dispatch({ type: "remove-page", pageId: page.id });
                if (page.id === currentPageId) {
                  const remaining = Object.values(useEditorStore.getState().doc!.pages).sort((a, b) => a.index - b.index)[0];
                  if (remaining) store.setCurrentPage(remaining.id);
                }
              }}
              aria-label={`Delete ${page.name}`}
            >
              <CloseIcon size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
      <button
        className="grid h-14 w-11 place-items-center rounded border border-dashed text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
        style={{ borderColor: "var(--border-subtle)" }}
        title="Add page"
        aria-label="Add page"
        onClick={() => {
          const store = useEditorStore.getState();
          const result = store.dispatch({ type: "add-page" });
          if (result.createdId) store.setCurrentPage(result.createdId);
        }}
      >
        <PlusIcon size={16} strokeWidth={ICON_STROKE} />
      </button>
    </footer>
  );
}
