"use client";

/**
 * Bring-your-own-key AI settings: users connect their own agent LLM and
 * image provider directly here — no environment variables, no redeploy.
 * Keys go to the server once, come back never (encrypted HttpOnly cookie);
 * this dialog only ever sees "configured / not configured".
 */

import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "@/editor/uiStore";
import {
  fetchProviderStatus,
  type ProviderStatusSnapshot,
} from "@/services/generation";
import type { FallbackProviderSummary, ProviderSummary, RotationStrategy } from "@/server/providerSession";

// Client-side mirror of providerSession.ts's MAX_FALLBACK_PROVIDERS — kept
// as a plain constant (not imported) because that module pulls in
// node:crypto (secretBox.ts) at runtime and must never enter the client
// bundle; only its types are safe to import here.
const MAX_FALLBACK_PROVIDERS = 3;
import {
  CloseIcon,
  DoneIcon,
  HiddenIcon,
  ICON_SIZE,
  ICON_SIZE_SM,
  ICON_STROKE,
  PendingIcon,
  VisibleIcon,
} from "../ui/icons";
import {
  CustomProviderForm,
  customPayloadFromForm,
  emptyCustomForm,
  type CustomFormState,
} from "./CustomProviderForm";

/**
 * Protocol-first: these are API STANDARDS, not a vendor list. Any provider
 * name, any base URL — the protocol alone decides runtime behaviour. "Custom
 * JSON" is one of the standards, not a separate mode.
 */
const AGENT_PROTOCOLS = [
  { id: "openai-compatible", label: "OpenAI-compatible", placeholder: "https://api.deepseek.com/v1" },
  { id: "anthropic-compatible", label: "Anthropic Messages", placeholder: "https://api.anthropic.com" },
  { id: "gemini", label: "Gemini Native", placeholder: "https://generativelanguage.googleapis.com" },
  { id: "custom", label: "Custom JSON", placeholder: "https://example.com/v1/generate" },
];

const IMAGE_PROTOCOLS = [
  { id: "gemini", label: "Gemini Native", placeholder: "https://generativelanguage.googleapis.com" },
  { id: "openai-compatible", label: "OpenAI-compatible", placeholder: "https://api.example.com/v1" },
  { id: "custom", label: "Custom JSON", placeholder: "https://example.com/v1/generate" },
  { id: "comfyui", label: "ComfyUI (local)", placeholder: "http://127.0.0.1:8188" },
];

const BACKGROUND_PROTOCOLS = [
  { id: "remove-bg", label: "remove.bg", placeholder: "https://api.remove.bg/v1.0/removebg" },
  { id: "custom", label: "Custom JSON", placeholder: "https://example.com/cutout" },
];

/**
 * Ollama and LM Studio are not separate API standards — both simply serve
 * an OpenAI-compatible endpoint on a well-known local port, so they are
 * quick-fill shortcuts for the "openai-compatible" protocol's Base URL
 * field, not entries in the protocol picker (which stays protocol-first,
 * not a vendor list, per the file's own docstring above).
 */
const LOCAL_SERVER_PRESETS = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
];

/** One row in the fallback-provider editor. Simple protocols only (no
 * "custom" JSON mapping) — keeps a per-row mini-form manageable; a fully
 * custom fallback can still be reached by hand-editing the stored cookie
 * via the API, just not through this form. */
interface FallbackRow {
  providerType: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  backupApiKeysText: string;
}

function emptyFallbackRow(providerType: string): FallbackRow {
  return { providerType, name: "", baseUrl: "", apiKey: "", model: "", backupApiKeysText: "" };
}

/** One LoRA row for a ComfyUI provider — `strength` stays a string in local
 * state (controlled numeric input), parsed on save. Not secret. */
interface LoraRow {
  name: string;
  strength: string;
}

function emptyLoraRow(): LoraRow {
  return { name: "", strength: "" };
}

const MAX_COMFYUI_LORAS_CLIENT = 4;

// Mirrors server/comfyui/config.ts's IP_ADAPTER_PRESETS — a fixed, small,
// version-pinned list (not a per-install file listing like LoRA/ControlNet
// models), so a plain <select> is more honest here than a "Fetch" round
// trip. Kept as a local client constant rather than importing the server
// module, matching this file's existing MAX_COMFYUI_LORAS_CLIENT precedent.
const IP_ADAPTER_PRESETS_CLIENT = [
  "LIGHT - SD1.5 only (low strength)",
  "STANDARD (medium strength)",
  "VIT-G (medium strength)",
  "PLUS (high strength)",
  "PLUS FACE (portraits)",
  "FULL FACE - SD1.5 only (portraits stronger)",
];

export function AiSettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);
  const [status, setStatus] = useState<ProviderStatusSnapshot | null>(null);

  // Returns the fetch's own promise (not just fire-and-forget) so a caller
  // that needs to know the round trip actually finished — BackupKeysList's
  // optimistic checkbox/weight state — can await it.
  const refresh = useCallback(() => {
    return fetchProviderStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="w-[520px] max-h-[92vh] overflow-y-auto rounded-lg bg-[var(--bg-elevated)] p-4 text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-zinc-100">AI Providers</h2>
          <button
            aria-label="Close settings"
            title="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>
        <p className="mb-4 text-xs leading-5 text-zinc-500">
          Bring your own API. You only need to know which standard your provider speaks — then paste its address, key
          and model. Any provider name works; the standard decides how Kumanga talks to it. Credentials are encrypted
          and stored for this browser session only.
        </p>

        <ProviderCard
          kind="agent"
          title="Manga Agent (LLM)"
          protocols={AGENT_PROTOCOLS}
          summary={status?.agent ?? null}
          onChanged={refresh}
          supportsModelDiscovery
        />
        <ProviderCard
          kind="image"
          title="Image Generation"
          protocols={IMAGE_PROTOCOLS}
          summary={status?.image ?? null}
          onChanged={refresh}
          footnote={
            status?.image?.configured
              ? (status.image.capabilities?.supportsReferenceImage ?? status.image.capabilities?.referenceImage)
                ? "This provider supports reference images — character identity can be carried into pose/expression generation (provider-dependent, never guaranteed)."
                : "This provider does not support reference images: identity preservation relies on text descriptions only."
              : undefined
          }
        />
        <BackgroundRemovalCard summary={status?.background ?? null} onChanged={refresh} />
      </div>
    </div>
  );
}

/**
 * Background removal is a FALLBACK, not a third provider to configure.
 *
 * The primary path needs no setup at all: foreground assets are generated on
 * pure white and the built-in extractor cuts them out. A removal API is only
 * ever consulted when that fails — and only if the creator chose to connect
 * one here.
 */
function BackgroundRemovalCard({ summary, onChanged }: { summary: ProviderSummary | null; onChanged: () => Promise<void> }) {
  const configured = summary?.configured ?? false;
  const [configuring, setConfiguring] = useState(false);
  return (
    <section className="mb-4 rounded-md p-3" style={{ background: "var(--bg-elevated)" }}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Background Removal</h3>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--success)" }}>
          <DoneIcon size={12} strokeWidth={2} />
          Built-in
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-4 text-zinc-500">
        <span className="text-zinc-400">Primary:</span> built-in white-background extraction — always on, nothing to
        configure.
      </p>
      <p className="mb-2 text-[11px] leading-4 text-zinc-500">
        <span className="text-zinc-400">Fallback:</span>{" "}
        {configured
          ? `${summary?.name || summary?.providerType || "custom"} — used only if built-in extraction fails`
          : "none — if extraction fails, you get a repair prompt instead"}
      </p>
      {!configuring && (
        <button
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
          onClick={() => setConfiguring(true)}
        >
          {configured ? "Edit fallback" : "Configure fallback (optional)"}
        </button>
      )}
      {configuring && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <ProviderCard kind="background" title="Fallback provider" protocols={BACKGROUND_PROTOCOLS} summary={summary} onChanged={onChanged} />
          <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setConfiguring(false)}>
            Collapse
          </button>
        </div>
      )}
    </section>
  );
}

// ─── One provider configuration card ────────────────────────────────────────

interface ProviderCardProps {
  kind: "agent" | "image" | "background";
  title: string;
  protocols: { id: string; label: string; placeholder: string }[];
  summary: ProviderSummary | null;
  onChanged: () => Promise<void>;
  supportsModelDiscovery?: boolean;
  footnote?: string;
}

function ProviderCard({ kind, title, protocols, summary, onChanged, supportsModelDiscovery, footnote }: ProviderCardProps) {
  const simpleProtocols = protocols.filter((p) => p.id !== "custom");
  const [customForm, setCustomForm] = useState<CustomFormState>(() => emptyCustomForm(kind));
  const [providerType, setProviderType] = useState(simpleProtocols[0].id);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(kind === "background" ? "background-removal" : "");
  const [models, setModels] = useState<string[]>([]);
  const [rotationStrategy, setRotationStrategy] = useState<RotationStrategy>("round_robin");
  // Fallback providers are always resubmitted whole (their keys can never be
  // read back from the server either) — `fallbackTouched` distinguishes
  // "never opened this section, keep whatever is stored" (omitted from the
  // save payload) from "opened it and this IS the whole list now, even if
  // that means clearing it" (sent as `[]`).
  const [fallbackRows, setFallbackRows] = useState<FallbackRow[]>([]);
  const [fallbackTouched, setFallbackTouched] = useState(false);
  // ComfyUI sampler/LoRA settings — nothing here is secret (unlike backup
  // keys or fallback providers), so it's hydrated unconditionally and
  // resubmitted wholesale every save, not gated behind a "touched" flag.
  const [comfyUiSteps, setComfyUiSteps] = useState("");
  const [comfyUiCfg, setComfyUiCfg] = useState("");
  const [comfyUiSampler, setComfyUiSampler] = useState("");
  const [comfyUiScheduler, setComfyUiScheduler] = useState("");
  // One configured ControlNet model reused for every generation that
  // happens to include a control image — not a per-generation picker.
  const [comfyUiControlNetModel, setComfyUiControlNetModel] = useState("");
  const [comfyUiControlNetStrength, setComfyUiControlNetStrength] = useState("");
  const [controlNetModelOptions, setControlNetModelOptions] = useState<string[]>([]);
  // Used automatically (no config required) whenever a local edit carries
  // an extra identity reference — these only override the built-in default
  // preset/weight, so blank is a legitimate, common value, not "unset".
  const [comfyUiIpAdapterPreset, setComfyUiIpAdapterPreset] = useState("");
  const [comfyUiIpAdapterWeight, setComfyUiIpAdapterWeight] = useState("");
  const [loraRows, setLoraRows] = useState<LoraRow[]>([]);
  const [loraOptions, setLoraOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "test" | "forget" | "models" | "loras" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const isCustom = providerType === "custom";

  // Prefill the form from the saved summary once (never the key — the server
  // doesn't return it; an empty key field means "keep the stored key").
  useEffect(() => {
    if (!summary || hydrated) return;
    if (summary.configured) {
      if (summary.providerType === "custom" && summary.custom) {
        setProviderType("custom");
        setCustomForm(hydrateCustomForm(kind, summary));
      } else {
        setProviderType(summary.providerType ?? simpleProtocols[0].id);
        setName(summary.name ?? "");
        setBaseUrl(summary.baseUrl ?? "");
        setModel(summary.model ?? "");
      }
      setRotationStrategy(summary.rotationStrategy ?? "round_robin");
      if (summary.comfyui) {
        setComfyUiSteps(summary.comfyui.steps !== undefined ? String(summary.comfyui.steps) : "");
        setComfyUiCfg(summary.comfyui.cfg !== undefined ? String(summary.comfyui.cfg) : "");
        setComfyUiSampler(summary.comfyui.samplerName ?? "");
        setComfyUiScheduler(summary.comfyui.scheduler ?? "");
        setComfyUiControlNetModel(summary.comfyui.controlNetModel ?? "");
        setComfyUiControlNetStrength(summary.comfyui.controlNetStrength !== undefined ? String(summary.comfyui.controlNetStrength) : "");
        setComfyUiIpAdapterPreset(summary.comfyui.ipAdapterPreset ?? "");
        setComfyUiIpAdapterWeight(summary.comfyui.ipAdapterWeight !== undefined ? String(summary.comfyui.ipAdapterWeight) : "");
        setLoraRows(
          (summary.comfyui.loras ?? []).map((l) => ({
            name: l.name,
            strength: l.strength !== undefined ? String(l.strength) : "",
          })),
        );
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, hydrated, kind]);

  const typeInfo = protocols.find((t) => t.id === providerType) ?? protocols[0];
  const configured = summary?.configured ?? false;
  // ComfyUI has no built-in auth (like Custom API's authMode "none") — an
  // API key is never required to save it, configured or not.
  const canSave = isCustom
    ? Boolean(customForm.endpoint && customForm.model && (configured || customForm.apiKey || customForm.authMode === "none"))
    : Boolean((kind === "background" || model) && (configured || apiKey || providerType === "comfyui"));

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      // Primary backup keys are managed live through BackupKeysList /
      // /api/provider/backup-keys now, not resubmitted with the rest of
      // this form — same "empty = keep what's stored" convention still
      // applies to the fallback chain's own keys below, which keep the
      // bulk textarea for now.
      const rotation = {
        rotationStrategy,
        // Only sent once the user has actually opened the fallback
        // editor — otherwise omitted, which keeps whatever chain (if
        // any) is already stored.
        fallbackProviders: fallbackTouched
          ? fallbackRows.map((row) => ({
              providerType: row.providerType,
              name: row.name || undefined,
              baseUrl: row.baseUrl || undefined,
              apiKey: row.apiKey || undefined,
              model: kind === "background" ? "background-removal" : row.model,
              backupApiKeys: row.backupApiKeysText.trim()
                ? row.backupApiKeysText
                    .split("\n")
                    .map((k) => k.trim())
                    .filter(Boolean)
                    .map((key) => ({ key }))
                : undefined,
            }))
          : undefined,
      };
      const payload = isCustom
        ? {
            kind,
            providerType: "custom",
            name: customForm.name || undefined,
            baseUrl: customForm.endpoint,
            apiKey: customForm.apiKey || undefined,
            model: customForm.model,
            custom: customPayloadFromForm(kind, customForm),
            ...rotation,
          }
        : {
            kind,
            providerType,
            name: name || undefined,
            baseUrl: baseUrl || undefined,
            // Empty field + already configured = keep the stored key.
            apiKey: apiKey || undefined,
            model: model || (kind === "background" ? "background-removal" : ""),
            comfyui:
              providerType === "comfyui"
                ? {
                    steps: comfyUiSteps.trim() ? Number(comfyUiSteps) : undefined,
                    cfg: comfyUiCfg.trim() ? Number(comfyUiCfg) : undefined,
                    samplerName: comfyUiSampler.trim() || undefined,
                    scheduler: comfyUiScheduler.trim() || undefined,
                    controlNetModel: comfyUiControlNetModel.trim() || undefined,
                    controlNetStrength: comfyUiControlNetStrength.trim() ? Number(comfyUiControlNetStrength) : undefined,
                    ipAdapterPreset: comfyUiIpAdapterPreset.trim() || undefined,
                    ipAdapterWeight: comfyUiIpAdapterWeight.trim() ? Number(comfyUiIpAdapterWeight) : undefined,
                    loras: loraRows
                      .filter((r) => r.name.trim())
                      .map((r) => ({ name: r.name.trim(), strength: r.strength.trim() ? Number(r.strength) : undefined })),
                  }
                : undefined,
            ...rotation,
          };
      const response = await fetch("/api/provider/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Save failed");
      setApiKey("");
      setFallbackRows((rows) => rows.map((r) => ({ ...r, apiKey: "", backupApiKeysText: "" })));
      setCustomForm((f) => ({ ...f, apiKey: "" }));
      setMessage({ ok: true, text: "Saved. Credentials are stored securely for this browser session." });
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setMessage(null);
    setPreview(null);
    try {
      const response = await fetch("/api/provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = await response.json();
      setMessage(
        body.ok
          ? { ok: true, text: body.detail ? `Connected — ${body.detail.replace(/^Connected( — )?/, "")}` : "Connected" }
          : { ok: false, text: body.error ?? "Connection failed" },
      );
      if (body.preview) setPreview(body.preview);
    } catch {
      setMessage({ ok: false, text: "Endpoint unreachable" });
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    if (!confirm(`Forget the ${title} credentials for this browser?`)) return;
    setBusy("forget");
    await fetch(`/api/provider/config?kind=${kind}`, { method: "DELETE" });
    setApiKey("");
    setModel("");
    setName("");
    setBaseUrl("");
    setRotationStrategy("round_robin");
    setFallbackRows([]);
    setFallbackTouched(false);
    setMessage({ ok: true, text: "Credentials forgotten." });
    setBusy(null);
    onChanged();
  };

  const fetchModels = async () => {
    setBusy("models");
    try {
      const response = await fetch("/api/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = await response.json();
      setModels(Array.isArray(body.models) ? body.models : []);
      if (!body.models?.length) setMessage({ ok: false, text: "This provider doesn't expose a model list — enter the model ID manually." });
    } finally {
      setBusy(null);
    }
  };

  const fetchComfyUiOptions = async (nodeClass: "LoraLoader" | "ControlNetLoader", inputName: "lora_name" | "control_net_name") => {
    setBusy("loras");
    try {
      const response = await fetch("/api/provider/comfyui-object-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, nodeClass, inputName }),
      });
      const body = await response.json();
      const options: string[] = Array.isArray(body.options) ? body.options : [];
      (nodeClass === "LoraLoader" ? setLoraOptions : setControlNetModelOptions)(options);
      if (!options.length) setMessage({ ok: false, text: "ComfyUI didn't return a list — enter the filename manually." });
      return options;
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-4 rounded-md p-3" style={{ background: "var(--bg-elevated)" }}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{title}</h3>
        <span
          className="flex items-center gap-1.5 text-xs"
          style={{ color: configured ? "var(--success)" : "var(--text-muted)" }}
        >
          {configured ? <DoneIcon size={12} strokeWidth={2} /> : <PendingIcon size={12} strokeWidth={2} />}
          {configured ? `Connected${summary?.source === "deployment" ? " (deployment default)" : ""}` : "Not configured"}
        </span>
      </div>

      {/*
        Simple setup is the default: name, address, key, model, connect.
        The API-standard picker is an Advanced concern — most providers speak
        OpenAI-compatible, so the dropdown only appears on demand (and stays
        visible once a non-default standard or Custom JSON mapping is chosen).
      */}
      <Field label="Provider name (any label)">
        <input
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Kimi, MiniMax, OpenRouter, My Gateway…"
        />
      </Field>

      {isCustom ? (
        <details className="mb-2" open>
          <summary className="mb-2 cursor-pointer text-[10px] uppercase tracking-wider text-zinc-500">
            Advanced API mapping
          </summary>
          <CustomProviderForm kind={kind} form={customForm} configured={configured} onChange={setCustomForm} />
        </details>
      ) : (
        <>
          <Field label="Base URL">
            <input
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={typeInfo.placeholder}
            />
            {providerType === "openai-compatible" && kind !== "background" && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-600">Local server:</span>
                {LOCAL_SERVER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] hover:bg-zinc-700"
                    onClick={() => setBaseUrl(preset.baseUrl)}
                    title={`Fill in the default ${preset.label} address (${preset.baseUrl})`}
                  >
                    {preset.label}
                  </button>
                ))}
                <span className="text-[10px] text-zinc-600">
                  — requires <code className="font-mono">ALLOW_PRIVATE_NETWORKS=1</code> in dev; never enable in
                  production
                </span>
              </div>
            )}
            {providerType === "comfyui" && (
              <div className="mt-1.5 text-[10px] text-zinc-600">
                Your local ComfyUI server&apos;s address — requires{" "}
                <code className="font-mono">ALLOW_PRIVATE_NETWORKS=1</code> in dev; never enable in production.
              </div>
            )}
          </Field>

          <Field label="API key">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 pr-9 font-mono text-xs"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={configured ? "Configured — enter a new key to replace" : "sk-…"}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? "Hide key" : "Show key while typing"}
                aria-label={showKey ? "Hide key" : "Show key while typing"}
              >
                {showKey ? (
                  <HiddenIcon size={ICON_SIZE_SM} strokeWidth={ICON_STROKE} />
                ) : (
                  <VisibleIcon size={ICON_SIZE_SM} strokeWidth={ICON_STROKE} />
                )}
              </button>
            </div>
          </Field>

          {kind !== "background" && <Field label="Model">
            <div className="flex gap-2">
              <input
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={providerType === "comfyui" ? "sd_xl_base_1.0.safetensors" : "model-name"}
                list={models.length > 0 ? `${kind}-models` : undefined}
              />
              {supportsModelDiscovery && providerType === "openai-compatible" && configured && (
                <button
                  className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 text-xs hover:bg-zinc-700"
                  onClick={fetchModels}
                  disabled={busy !== null}
                  title="Fetch the provider's model list (optional)"
                >
                  {busy === "models" ? "…" : "Fetch models"}
                </button>
              )}
            </div>
            {providerType === "comfyui" && (
              <div className="mt-1.5 text-[10px] text-zinc-600">
                Checkpoint filename as ComfyUI shows it (e.g. `sd_xl_base_1.0.safetensors`).
              </div>
            )}
            {models.length > 0 && (
              <datalist id={`${kind}-models`}>
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </Field>}
        </>
      )}

      <details className="mt-2" open={providerType !== simpleProtocols[0].id}>
        <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-zinc-500">
          Advanced — API standard
        </summary>
        <div className="mt-2">
          <Field label="API standard / protocol">
            <select
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5"
              value={providerType}
              onChange={(e) => {
                setProviderType(e.target.value);
                setBaseUrl("");
                setModels([]);
                if (kind === "background") setModel("background-removal");
              }}
            >
              {protocols.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="mt-1 text-[10px] leading-4 text-zinc-600">
            Most providers speak OpenAI-compatible. Custom JSON unfolds the request/response mapping.
          </p>
        </div>
      </details>

      <details className="mt-2" open={Boolean(summary?.backupKeyCount || summary?.fallbackProviders?.length)}>
        <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-zinc-500">
          Advanced — rotation &amp; fallback
        </summary>
          <div className="mt-2">
            {configured && <BackupKeysList kind={kind} summary={summary} onChanged={onChanged} />}
            <Field label="Which key/provider to try first">
              <select
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5"
                value={rotationStrategy}
                onChange={(e) => setRotationStrategy(e.target.value as RotationStrategy)}
              >
                <option value="round_robin">Round robin — spread requests evenly (recommended)</option>
                <option value="sequential">Sequential — always try the primary key first</option>
                <option value="random">Random — weighted by each key&apos;s priority below</option>
              </select>
            </Field>
            <p className="mt-1 text-[10px] leading-4 text-zinc-600">
              On rate limit, no credit, or an invalid key, generation automatically retries with the next key —
              multiple free-tier keys effectively multiply your throughput. A key that just failed is benched
              briefly before it is tried again.
            </p>

            <div className="mt-3 border-t border-zinc-800 pt-3">
              <FallbackProvidersEditor
                kind={kind}
                simpleProtocols={simpleProtocols}
                stored={summary?.fallbackProviders ?? []}
                touched={fallbackTouched}
                rows={fallbackRows}
                onBeginEditing={() => {
                  setFallbackRows(
                    (summary?.fallbackProviders ?? []).map((fb) => ({
                      providerType: fb.providerType,
                      name: fb.name ?? "",
                      baseUrl: "",
                      apiKey: "",
                      model: fb.model,
                      backupApiKeysText: "",
                    })),
                  );
                  setFallbackTouched(true);
                }}
                onDiscard={() => {
                  setFallbackRows([]);
                  setFallbackTouched(false);
                }}
                onRowsChange={setFallbackRows}
              />
            </div>
          </div>
      </details>

      {providerType === "comfyui" && (
        // `open` used to be a hand-enumerated OR-chain of every ComfyUI
        // field — it silently went stale THREE times as fields were added
        // (controlNetStrength, then this whole section). `configured`
        // (already saved at least once) is what actually correlates with
        // "there's probably something worth showing" and needs no upkeep
        // when a future field is added.
        <details className="mt-2" open={configured}>
          <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wider text-zinc-500">
            Advanced — ComfyUI settings
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Steps">
              <input
                type="number"
                min={1}
                max={150}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                value={comfyUiSteps}
                onChange={(e) => setComfyUiSteps(e.target.value)}
                placeholder="20"
              />
            </Field>
            <Field label="CFG scale">
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                value={comfyUiCfg}
                onChange={(e) => setComfyUiCfg(e.target.value)}
                placeholder="7"
              />
            </Field>
            <Field label="Sampler name">
              <input
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                value={comfyUiSampler}
                onChange={(e) => setComfyUiSampler(e.target.value)}
                placeholder="euler"
              />
            </Field>
            <Field label="Scheduler">
              <input
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                value={comfyUiScheduler}
                onChange={(e) => setComfyUiScheduler(e.target.value)}
                placeholder="normal"
              />
            </Field>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-zinc-600">
            Leave blank to use the built-in defaults (steps 20, cfg 7, euler/normal).
          </p>

          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                ControlNet (structural/pose control image — you supply an already pre-processed image; no auto-preprocessing)
              </span>
              {configured && (
                <button
                  type="button"
                  className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] hover:bg-zinc-700"
                  onClick={() => fetchComfyUiOptions("ControlNetLoader", "control_net_name")}
                  disabled={busy !== null}
                  title="Fetch the list of ControlNet models ComfyUI can see (optional)"
                >
                  {busy === "loras" ? "…" : "Fetch ControlNet models"}
                </button>
              )}
            </div>
            {controlNetModelOptions.length > 0 && (
              <datalist id="comfyui-controlnet-options">
                {controlNetModelOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="ControlNet model">
                <input
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                  value={comfyUiControlNetModel}
                  onChange={(e) => setComfyUiControlNetModel(e.target.value)}
                  placeholder="control_v11p_sd15_openpose.pth"
                  list={controlNetModelOptions.length > 0 ? "comfyui-controlnet-options" : undefined}
                />
              </Field>
              <Field label="Strength">
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                  value={comfyUiControlNetStrength}
                  onChange={(e) => setComfyUiControlNetStrength(e.target.value)}
                  placeholder="1"
                />
              </Field>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-zinc-600">
              Only applies when a generation actually attaches a control image. Leave the model blank to disable ControlNet.
            </p>
          </div>

          <div className="mt-3 border-t border-zinc-800 pt-3">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
              Identity reference on local edits (IPAdapter) — requires the ComfyUI_IPAdapter_plus custom node pack
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Preset">
                <select
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 text-xs"
                  value={comfyUiIpAdapterPreset}
                  onChange={(e) => setComfyUiIpAdapterPreset(e.target.value)}
                >
                  <option value="">Default (STANDARD — works on SD1.5 and SDXL)</option>
                  {IP_ADAPTER_PRESETS_CLIENT.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Weight">
                <input
                  type="number"
                  min={-1}
                  max={5}
                  step={0.05}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                  value={comfyUiIpAdapterWeight}
                  onChange={(e) => setComfyUiIpAdapterWeight(e.target.value)}
                  placeholder="1"
                />
              </Field>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-zinc-600">
              Automatically used whenever a local edit (in the character/asset library) carries an extra identity
              reference — no setup required beyond installing the node pack. The two &ldquo;SD1.5 only&rdquo; presets
              fail on an SDXL checkpoint; leave blank if unsure.
            </p>
          </div>

          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                LoRAs (checkpoint filenames as ComfyUI shows them, up to {MAX_COMFYUI_LORAS_CLIENT})
              </span>
              {configured && (
                <button
                  type="button"
                  className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] hover:bg-zinc-700"
                  onClick={() => fetchComfyUiOptions("LoraLoader", "lora_name")}
                  disabled={busy !== null}
                  title="Fetch the list of LoRA files ComfyUI can see (optional)"
                >
                  {busy === "loras" ? "…" : "Fetch LoRAs"}
                </button>
              )}
            </div>
            {loraOptions.length > 0 && (
              <datalist id="comfyui-lora-options">
                {loraOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            )}
            {loraRows.map((row, index) => (
              <div key={index} className="mb-1.5 flex gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                  value={row.name}
                  onChange={(e) => setLoraRows((rows) => rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))}
                  placeholder="detail_tweaker_xl.safetensors"
                  aria-label={`LoRA ${index + 1} filename`}
                  list={loraOptions.length > 0 ? "comfyui-lora-options" : undefined}
                />
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  className="w-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                  value={row.strength}
                  onChange={(e) => setLoraRows((rows) => rows.map((r, i) => (i === index ? { ...r, strength: e.target.value } : r)))}
                  placeholder="1"
                  aria-label={`LoRA ${index + 1} strength`}
                />
                <button
                  type="button"
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 text-xs hover:bg-zinc-700"
                  onClick={() => setLoraRows((rows) => rows.filter((_, i) => i !== index))}
                  aria-label={`Remove LoRA ${index + 1}`}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {loraRows.length < MAX_COMFYUI_LORAS_CLIENT && (
              <button
                type="button"
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
                onClick={() => setLoraRows((rows) => [...rows, emptyLoraRow()])}
              >
                + Add LoRA
              </button>
            )}
          </div>
        </details>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
          onClick={save}
          disabled={busy !== null || !canSave}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700 disabled:opacity-40"
          onClick={test}
          disabled={busy !== null || !configured}
          title={
            !configured
              ? "Save first, then test"
              : (kind === "image" || kind === "background") && summary?.providerType === "custom"
                ? "Runs one real minimal generation to verify the mapping"
                : "Round-trip to the provider"
          }
        >
          {busy === "test" ? "Testing…" : "Test Connection"}
        </button>
        <div className="flex-1" />
        {configured && summary?.source === "session" && (
          <button className="text-xs text-zinc-500 hover:text-red-400" onClick={forget} disabled={busy !== null}>
            Forget credentials
          </button>
        )}
      </div>

      {message && (
        <p className={`mt-2 text-xs ${message.ok ? "text-emerald-400" : "text-red-400"}`}>{message.text}</p>
      )}
      {preview && (
        <details className="mt-2 rounded-md bg-[var(--bg-elevated)] p-2">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-zinc-500">
            Request preview (secrets redacted)
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-zinc-400">
            {`${preview.method} ${preview.url}\n` +
              Object.entries((preview.headers as Record<string, string>) ?? {})
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n") +
              `\n\n${JSON.stringify(preview.body, null, 2)}`}
          </pre>
        </details>
      )}
      {footnote && <p className="mt-2 text-[11px] leading-4 text-zinc-500">{footnote}</p>}
    </section>
  );
}

/**
 * Fallback providers — entirely different vendors/endpoints tried, in
 * order, once the primary provider (and all its backup keys) are
 * exhausted. Keys can never be read back from the server, so editing this
 * list always starts from a clean slate: `onBeginEditing` seeds the rows
 * from the safe (non-secret) summary with empty key fields the user must
 * retype, and the whole list is resubmitted together on Save.
 */
/**
 * Live-managed backup key rows for the PRIMARY provider — add, toggle
 * enabled, edit weight, test, reorder, and remove one key at a time
 * through `/api/provider/backup-keys` and `/api/provider/test-key`,
 * instead of the old single textarea that required retyping the whole
 * list for any change. Every action here is independent of the dialog's
 * big Save button and applies immediately, because none of it involves a
 * secret the client has to type fresh — a stored key's value is never
 * rendered (there is nothing to render it FROM), only its `weight`/
 * `enabled` metadata, which is safe to round-trip.
 *
 * Fallback providers' own backup keys are intentionally NOT covered here —
 * see `FallbackProvidersEditor`'s docstring; they keep the bulk textarea
 * until a later pass unifies the two.
 */
function BackupKeysList({
  kind,
  summary,
  onChanged,
}: {
  kind: "agent" | "image" | "background";
  summary: ProviderSummary | null;
  onChanged: () => Promise<void>;
}) {
  const [newKey, setNewKey] = useState("");
  const [busyIndex, setBusyIndex] = useState<number | "add" | "test-all" | null>(null);
  const [results, setResults] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [error, setError] = useState<string | null>(null);
  /**
   * `checked`/`value` below are fully controlled from `summary.backupKeys`,
   * which only updates once `onChanged()`'s refetch round-trips. Setting
   * `busyIndex` (to disable the row mid-request) forces an immediate
   * re-render on the STILL-STALE summary — without this, that render snaps
   * a just-clicked checkbox straight back to its old value, since React
   * always syncs a controlled input to its prop. The override merges the
   * optimistic new value in for that gap; `onChanged()` is awaited before
   * clearing it, so the clear never itself causes the same flicker back to
   * a stale value the fetch hasn't overwritten yet. Caught by a real
   * Playwright `.uncheck()` failing with "did not change its state".
   */
  const [overrides, setOverrides] = useState<Record<number, { weight?: number; enabled?: boolean }>>({});

  const keys = (summary?.backupKeys ?? []).map((entry, index) => ({ ...entry, ...overrides[index] }));

  const call = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/provider/backup-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...body }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Action failed");
    return json;
  };

  const add = async () => {
    const key = newKey.trim();
    if (!key) return;
    setBusyIndex("add");
    setError(null);
    try {
      await call({ action: "add", key });
      setNewKey("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add key");
    } finally {
      setBusyIndex(null);
    }
  };

  const update = async (index: number, patch: { weight?: number; enabled?: boolean }) => {
    setBusyIndex(index);
    setError(null);
    setOverrides((o) => ({ ...o, [index]: { ...o[index], ...patch } }));
    try {
      await call({ action: "update", index, ...patch });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setOverrides((o) => {
        const rest = { ...o };
        delete rest[index];
        return rest;
      });
      setBusyIndex(null);
    }
  };

  // remove/reorder change what row an index POINTS to, and test results are
  // keyed by index — so any structural change (not a plain weight/enabled
  // update, which never moves rows) drops every stored result rather than
  // risk one lingering on the wrong row after the shift.
  const remove = async (index: number) => {
    setBusyIndex(index);
    setError(null);
    setResults({});
    setOverrides({});
    try {
      await call({ action: "remove", index });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove key");
    } finally {
      setBusyIndex(null);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const toIndex = index + direction;
    if (toIndex < 0 || toIndex >= keys.length) return;
    setBusyIndex(index);
    setError(null);
    setResults({});
    setOverrides({});
    try {
      await call({ action: "reorder", fromIndex: index, toIndex });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reorder");
    } finally {
      setBusyIndex(null);
    }
  };

  const testOne = async (index: number) => {
    setBusyIndex(index);
    try {
      const response = await fetch("/api/provider/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, target: { backupIndex: index } }),
      });
      const json = await response.json();
      setResults((r) => ({
        ...r,
        [index]: { ok: Boolean(json.ok), text: json.ok ? "Connected" : (json.error ?? "Failed") },
      }));
    } catch {
      setResults((r) => ({ ...r, [index]: { ok: false, text: "Endpoint unreachable" } }));
    } finally {
      setBusyIndex(null);
    }
  };

  const testAll = async () => {
    setBusyIndex("test-all");
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].enabled) await testOne(i);
    }
    setBusyIndex(null);
  };

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Backup API keys</span>
        {keys.length > 0 && (
          <button
            type="button"
            className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
            disabled={busyIndex !== null}
            onClick={testAll}
          >
            {busyIndex === "test-all" ? "Testing all…" : "Test all keys"}
          </button>
        )}
      </div>

      {keys.length === 0 && <p className="mb-1.5 text-[11px] text-zinc-500">No backup keys yet — add one below.</p>}

      <div className="space-y-1.5">
        {keys.map((entry, index) => (
          <div key={index} className="rounded border border-zinc-800 bg-zinc-950/50 p-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                aria-label={`Enable backup key ${index + 1}`}
                title="Enabled"
                checked={entry.enabled}
                disabled={busyIndex !== null}
                onChange={(e) => update(index, { enabled: e.target.checked })}
              />
              <span className="flex-1 truncate font-mono text-[11px] text-zinc-600">••••••••••••••</span>
              <input
                type="number"
                aria-label={`Weight for backup key ${index + 1}`}
                title="Priority when rotation strategy is Random"
                min={0.1}
                max={100}
                step={0.5}
                className="w-14 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[11px]"
                value={entry.weight}
                disabled={busyIndex !== null}
                onChange={(e) => update(index, { weight: Number(e.target.value) || 1 })}
              />
              <button
                type="button"
                aria-label={`Test backup key ${index + 1}`}
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] hover:bg-zinc-700 disabled:opacity-40"
                disabled={busyIndex !== null}
                onClick={() => testOne(index)}
              >
                {busyIndex === index ? "…" : "Test"}
              </button>
              <button
                type="button"
                aria-label={`Move backup key ${index + 1} up`}
                title="Move up"
                className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                disabled={index === 0 || busyIndex !== null}
                onClick={() => move(index, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move backup key ${index + 1} down`}
                title="Move down"
                className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                disabled={index === keys.length - 1 || busyIndex !== null}
                onClick={() => move(index, 1)}
              >
                ▼
              </button>
              <button
                type="button"
                aria-label={`Remove backup key ${index + 1}`}
                title="Remove"
                className="text-red-400 hover:text-red-300 disabled:opacity-40"
                disabled={busyIndex !== null}
                onClick={() => remove(index)}
              >
                ✕
              </button>
            </div>
            {results[index] && (
              <p className={`mt-1 text-[10px] ${results[index].ok ? "text-emerald-400" : "text-red-400"}`}>
                {results[index].text}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex gap-1.5">
        <input
          type="password"
          aria-label="New backup key"
          className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 font-mono text-xs"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Paste a key to add"
          autoComplete="off"
          disabled={busyIndex !== null}
        />
        <button
          type="button"
          className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700 disabled:opacity-40"
          disabled={busyIndex !== null || !newKey.trim()}
          onClick={add}
        >
          {busyIndex === "add" ? "Adding…" : "+ Add key"}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function FallbackProvidersEditor({
  kind,
  simpleProtocols,
  stored,
  touched,
  rows,
  onBeginEditing,
  onDiscard,
  onRowsChange,
}: {
  kind: "agent" | "image" | "background";
  simpleProtocols: { id: string; label: string; placeholder: string }[];
  stored: FallbackProviderSummary[];
  touched: boolean;
  rows: FallbackRow[];
  onBeginEditing: () => void;
  onDiscard: () => void;
  onRowsChange: (rows: FallbackRow[]) => void;
}) {
  const updateRow = (index: number, patch: Partial<FallbackRow>) =>
    onRowsChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeRow = (index: number) => onRowsChange(rows.filter((_, i) => i !== index));
  const addRow = () => onRowsChange([...rows, emptyFallbackRow(simpleProtocols[0].id)]);

  if (!touched) {
    return (
      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Fallback providers</span>
        {stored.length > 0 ? (
          <p className="mb-2 text-[11px] leading-4 text-zinc-500">
            {stored
              .map((fb) => `${fb.name || fb.providerType} (${fb.model})${fb.backupKeyCount ? ` +${fb.backupKeyCount} key(s)` : ""}`)
              .join(", ")}{" "}
            — tried in order if {kind === "agent" ? "the agent provider" : "image generation"} above is exhausted.
          </p>
        ) : (
          <p className="mb-2 text-[11px] leading-4 text-zinc-500">
            None configured — on repeated failure, generation stops instead of trying a different provider.
          </p>
        )}
        <button
          type="button"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
          onClick={onBeginEditing}
        >
          {stored.length > 0 ? "Edit fallback providers" : "Add a fallback provider"}
        </button>
        {stored.length > 0 && (
          <p className="mt-1 text-[10px] leading-4 text-zinc-600">
            Editing requires re-entering every fallback&apos;s key — they are never sent back from the server.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Fallback providers</span>
        <button type="button" className="text-[10px] text-zinc-500 hover:text-zinc-300" onClick={onDiscard}>
          Discard changes
        </button>
      </div>
      {rows.length === 0 && (
        <p className="mb-2 text-[11px] leading-4 text-zinc-500">No fallback providers — add one below.</p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="mb-2 rounded-md border border-zinc-800 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <select
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs"
              value={row.providerType}
              onChange={(e) => updateRow(index, { providerType: e.target.value, baseUrl: "" })}
            >
              {simpleProtocols.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-red-400"
              onClick={() => removeRow(index)}
              aria-label="Remove this fallback provider"
              title="Remove"
            >
              ✕
            </button>
          </div>
          <input
            className="mb-1.5 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs"
            value={row.name}
            onChange={(e) => updateRow(index, { name: e.target.value })}
            placeholder="Name (optional)"
          />
          <input
            className="mb-1.5 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 font-mono text-xs"
            value={row.baseUrl}
            onChange={(e) => updateRow(index, { baseUrl: e.target.value })}
            placeholder={simpleProtocols.find((p) => p.id === row.providerType)?.placeholder ?? "Base URL"}
          />
          <input
            type="password"
            className="mb-1.5 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 font-mono text-xs"
            value={row.apiKey}
            onChange={(e) => updateRow(index, { apiKey: e.target.value })}
            placeholder="API key"
            autoComplete="off"
          />
          {kind !== "background" && (
            <input
              className="mb-1.5 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 font-mono text-xs"
              value={row.model}
              onChange={(e) => updateRow(index, { model: e.target.value })}
              placeholder="Model"
            />
          )}
          <textarea
            className="h-12 w-full resize-y rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 font-mono text-[11px]"
            value={row.backupApiKeysText}
            onChange={(e) => updateRow(index, { backupApiKeysText: e.target.value })}
            placeholder="Backup keys for this fallback (one per line, optional)"
            autoComplete="off"
          />
        </div>
      ))}
      {rows.length < MAX_FALLBACK_PROVIDERS && (
        <button
          type="button"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
          onClick={addRow}
        >
          + Add fallback provider ({rows.length}/{MAX_FALLBACK_PROVIDERS})
        </button>
      )}
      <p className="mt-1 text-[10px] leading-4 text-zinc-600">
        Saved together with everything above — an incomplete row (missing key) will fail the save.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

/** Rebuild the custom form from a saved (non-secret) summary for re-editing. */
function hydrateCustomForm(kind: "agent" | "image" | "background", summary: ProviderSummary): CustomFormState {
  const base = emptyCustomForm(kind);
  const custom = (summary.custom ?? {}) as Record<string, never>;
  const auth = (custom.auth ?? {}) as { mode?: string; header?: string };
  const response = (custom.response ?? {}) as { type?: string; path?: string };
  const polling = (custom.polling ?? {}) as Record<string, string>;
  return {
    ...base,
    name: summary.name ?? "",
    endpoint: summary.baseUrl ?? "",
    model: summary.model ?? "",
    method: (custom.method as "POST" | "GET") ?? base.method,
    authMode: (auth.mode as CustomFormState["authMode"]) ?? base.authMode,
    authHeader: auth.header ?? base.authHeader,
    headers: (custom.headers as { name: string; value: string }[]) ?? [],
    requestTemplate: (custom.requestTemplate as string) ?? base.requestTemplate,
    responseType: (response.type as "url" | "base64") ?? base.responseType,
    responsePath: response.path ?? base.responsePath,
    referenceMode: (custom.referenceMode as CustomFormState["referenceMode"]) ?? base.referenceMode,
    execution: (custom.execution as "sync" | "async") ?? base.execution,
    polling: { ...base.polling, ...polling },
    responseTextPath: (custom.responseTextPath as string) ?? base.responseTextPath,
  };
}
