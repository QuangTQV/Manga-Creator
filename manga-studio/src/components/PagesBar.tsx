"use client";

/** Bottom dock: page navigation — add, switch, rename, delete, drag to reorder. */

import { useState } from "react";
import { useEditorStore } from "@/editor/store";
import { CloseIcon, ICON_STROKE, PlusIcon, RenameIcon } from "./ui/icons";
import { PageDeleteDialog } from "./library/LifecycleDialogs";
import type { Page } from "@/domain/types";

export function PagesBar() {
  const doc = useEditorStore((s) => s.doc);
  const currentPageId = useEditorStore((s) => s.currentPageId);
  // Native HTML5 drag-and-drop: `draggingId` is the page picked up,
  // `dragOverId` is whichever page the pointer is currently over (drives
  // the drop-target highlight only — the actual move happens on drop).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Which page's tile is showing a rename input instead of its button.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which page is pending a delete confirmation — replaces window.confirm(),
  // which looked (and read) nothing like the rest of the app.
  const [deleteTarget, setDeleteTarget] = useState<Page | null>(null);
  if (!doc) return null;

  const pages = Object.values(doc.pages).sort((a, b) => a.index - b.index);

  const commitRename = (page: Page, value: string) => {
    const trimmed = value.trim();
    setEditingId(null);
    if (!trimmed || trimmed === page.name) return;
    useEditorStore.getState().dispatch({ type: "rename-page", pageId: page.id, name: trimmed });
  };

  return (
    <footer className="flex h-[76px] items-center gap-2 border-t border-zinc-800 bg-zinc-900 px-3">
      <span className="mr-1 shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wider text-zinc-500">Pages</span>
      {/* Only this list scrolls — "+ Add page" stays reachable no matter how many pages there are. */}
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {pages.map((page) => (
          <div key={page.id} className="group relative shrink-0">
            {editingId === page.id ? (
              <input
                autoFocus
                defaultValue={page.name}
                aria-label={`Rename ${page.name}`}
                className="h-14 w-20 rounded-sm border border-[var(--accent)] bg-zinc-800 px-1 text-center text-[10px] text-zinc-100 focus:outline-none"
                onFocus={(e) => e.target.select()}
                onBlur={(e) => commitRename(page, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
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
                onDoubleClick={() => setEditingId(page.id)}
                className={`flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-sm border px-1 text-[10px] transition-colors ${
                  page.id === currentPageId
                    ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                    : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500"
                } ${draggingId === page.id ? "opacity-40" : ""} ${
                  dragOverId === page.id ? "border-2 border-[var(--accent)]" : ""
                }`}
                title={`${page.name} — double-click to rename, drag to reorder`}
                aria-current={page.id === currentPageId ? "page" : undefined}
              >
                <span className="w-full truncate leading-tight">{page.name}</span>
                <span className="text-[9px] leading-tight opacity-60">#{page.index + 1}</span>
              </button>
            )}
            {editingId !== page.id && (
              <div className="absolute -top-1 -right-1 hidden items-center gap-0.5 group-hover:flex">
                <button
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-950 text-zinc-400 hover:text-[var(--accent-text)]"
                  title={`Rename ${page.name}`}
                  aria-label={`Rename ${page.name}`}
                  onClick={() => setEditingId(page.id)}
                >
                  <RenameIcon size={9} strokeWidth={2} />
                </button>
                {pages.length > 1 && (
                  <button
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-950 text-zinc-400 hover:text-red-400"
                    title={`Delete ${page.name}`}
                    aria-label={`Delete ${page.name}`}
                    onClick={() => setDeleteTarget(page)}
                  >
                    <CloseIcon size={9} strokeWidth={2} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        className="grid h-14 w-11 shrink-0 place-items-center rounded border border-dashed text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
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
      {deleteTarget && (
        <PageDeleteDialog
          page={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(remainingPageId) => {
            if (deleteTarget.id === currentPageId && remainingPageId) {
              useEditorStore.getState().setCurrentPage(remainingPageId);
            }
          }}
        />
      )}
    </footer>
  );
}
