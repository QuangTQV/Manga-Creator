"use client";

/** Shared across every item kind (asset, bubble, effect, tone) — blend mode
 * is a property of being a layer, not of what the layer contains. */

import type { BlendMode } from "@/domain/types";

const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "multiply", label: "Multiply" },
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "darken", label: "Darken" },
  { id: "lighten", label: "Lighten" },
  { id: "color-dodge", label: "Color Dodge" },
  { id: "color-burn", label: "Color Burn" },
  { id: "hard-light", label: "Hard Light" },
  { id: "soft-light", label: "Soft Light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
];

export function BlendModeSelect({
  value,
  onChange,
}: {
  value: BlendMode | undefined;
  onChange: (mode: BlendMode) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Blend mode</label>
      <select
        aria-label="Blend mode"
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[11px] text-zinc-300"
        value={value ?? "normal"}
        onChange={(e) => onChange(e.target.value as BlendMode)}
      >
        {BLEND_MODES.map((mode) => (
          <option key={mode.id} value={mode.id}>
            {mode.label}
          </option>
        ))}
      </select>
    </div>
  );
}
