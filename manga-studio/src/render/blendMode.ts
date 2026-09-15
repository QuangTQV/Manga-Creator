import type { BlendMode } from "@/domain/types";

/** `domain/types.ts`'s `"normal"` sentinel (or an absent `blendMode`) is
 * canvas's own `"source-over"` — every other value already IS a real
 * `GlobalCompositeOperation` string, passed straight through. */
export function blendModeToCanvas(mode: BlendMode | undefined): GlobalCompositeOperation {
  if (!mode || mode === "normal") return "source-over";
  return mode;
}
