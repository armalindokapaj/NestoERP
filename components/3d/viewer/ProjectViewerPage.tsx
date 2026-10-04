"use client";

import { SignOutButton } from "@/components/auth/sign-out-button";

import * as React from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";

import { useThreeDTranslations } from "@/components/3d/three-d-text";
import Link from "@/components/navigation/nav-link";
import { project3DBootstrapSchema, type Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import type { ModelLoadStatus } from "@/lib/3d/runtime/render-engine/RenderEngine";
import { adaptProjectViewerBootstrap } from "@/lib/3d/viewer/bootstrap-adapter";
import { ViewerSplash, type ViewerBrand } from "./shared/ViewerSplash";
import { useViewerAvailability } from "./hooks/use-viewer-availability";

type StatusBody = { available?: unknown; token?: unknown } | undefined;
const readCompanyStatus = (body: unknown) => {
  const status = body as StatusBody;
  return { available: status?.available === true, token: typeof status?.token === "string" ? status.token : null };
};

type ApiEnvelope = { data?: unknown; error?: { message?: string } };

// Three.js and the renderer only ever run in the browser; the page is client-only, so the chunk loads lazily.
const ProjectViewerRuntime = React.lazy(() => import("./ProjectViewerRuntime").then((module) => ({ default: module.ProjectViewerRuntime })));

/**
 * The Company Project viewer page: reads the published release through the
 * bootstrap API (company-scoped and trimmed to the reader's permissions),
 * adapts it to the ported Rozaris runtime and mounts it full screen.
 *
 * Model files arrive on short-lived signed URLs. If one fails to load (an
 * expired signature, a network drop) the reader gets a retry that fetches a
 * fresh bootstrap, rather than a half-loaded scene.
 */
export function ProjectViewerPage({ projectId, projectName, brand = { name: "", logoUrl: null }, apiBase = `/api/projects/${encodeURIComponent(projectId)}/3d`, backHref = `/projects/${projectId}` }: {
  projectId: string;
  projectName: string;
  /** The owner's mark for the loading screen (group logo, else the company's). */
  brand?: ViewerBrand;
  /** Where bootstrap and status are read; Platform Admin reads its own copy. */
  apiBase?: string;
  backHref?: string;
}) {
  const [bootstrap, setBootstrap] = React.useState<Project3DBootstrap | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [modelStatus, setModelStatus] = React.useState<ModelLoadStatus>({ state: "loading" });
  const [token, setToken] = React.useState<string | null>(null);
  const t = useThreeDTranslations();

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setModelStatus({ state: "loading" });
    try {
      const response = await fetch(`${apiBase}/bootstrap`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const json = await response.json() as ApiEnvelope;
      if (!response.ok) throw new Error(json.error?.message ?? t("page.openFailed"));
      const parsed = project3DBootstrapSchema.safeParse(json.data);
      if (!parsed.success) throw new Error(t("page.releaseUnreadable"));
      // The grant this bootstrap was issued under, so a later change is noticed.
      const status = await fetch(`${apiBase}/status`, { cache: "no-store", signal });
      const statusBody = status.ok ? readCompanyStatus((await status.json() as ApiEnvelope).data) : { available: false, token: null };
      setBootstrap(parsed.data);
      setToken(statusBody.token);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setBootstrap(null);
      setError(failure instanceof Error ? failure.message : t("page.openFailed"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiBase, t]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const { availability, check } = useViewerAvailability({ statusUrl: `${apiBase}/status`, token, read: readCompanyStatus });
  // Revoked (audience, entitlement, membership, deletion): the scene goes, not just a banner (ADM-04A §8).
  React.useEffect(() => {
    if (availability !== "revoked") return;
    setBootstrap(null);
    setToken(null);
    setError(t("page.noLongerAvailable"));
  }, [availability, t]);
  // A failed model request is a reason to ask at once.
  React.useEffect(() => {
    if (modelStatus.state === "failed") check();
  }, [check, modelStatus]);

  const runtimeBootstrap = React.useMemo(() => (bootstrap ? adaptProjectViewerBootstrap(bootstrap) : null), [bootstrap]);

  if (!runtimeBootstrap || !bootstrap) {
    if (loading) return <ViewerSplash brand={brand} />;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface p-4">
        <div className="viewer-glass w-full max-w-sm rounded-panel p-5 text-center" role="alert">
          <p className="text-sm font-semibold text-fg">{error ?? t("page.noExperience")}</p>
          <p className="mt-1 text-xs text-fg/55">{projectName}</p>
          <SignOutButton className="mt-4" />
          <div className="mt-4 flex gap-2">
            <Link
              href={backHref}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-control border border-fg/15 text-[13px] font-semibold text-fg/85 hover:bg-fg/10 hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t("page.backToProject")}
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control bg-accent text-[13px] font-semibold text-accent-fg hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.tryAgain")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="project-3d-viewer" data-release={bootstrap.release.number}>
      <React.Suspense fallback={<ViewerSplash brand={brand} />}>
        <ProjectViewerRuntime
          // A fresh bootstrap (new signed URLs) rebuilds the renderer from scratch.
          key={`${bootstrap.release.id}:${bootstrap.models.map((model) => model.asset.expiresAt).join(":")}`}
          bootstrap={runtimeBootstrap}
          channel="company"
          brand={brand}
          onModelLoadStatus={setModelStatus}
        />
      </React.Suspense>
      {availability === "changed" ? (
        <div className="absolute inset-x-0 top-16 z-[60] flex justify-center px-3 sm:top-20">
          <div className="glass-panel-dark flex max-w-md items-center gap-3 rounded-panel px-4 py-3 text-fg" role="status">
            <p className="min-w-0 text-xs font-semibold">{t("page.updatedTitle")}</p>
            <button type="button" onClick={() => void load()} disabled={loading} className="flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent disabled:opacity-60">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.reload")}
            </button>
          </div>
        </div>
      ) : null}
      {modelStatus.state === "failed" ? (
        <div className="absolute inset-x-0 top-16 z-[60] flex justify-center px-3 sm:top-20">
          <div className="glass-panel-dark flex max-w-md items-center gap-3 rounded-panel px-4 py-3 text-fg" role="alert">
            <div className="min-w-0">
              <p className="text-xs font-semibold">{t("page.modelsFailed")}</p>
              <p className="mt-0.5 truncate text-[11px] text-fg/55">
                {modelStatus.forbidden ? t("page.modelAccessExpired") : t("page.affected", { models: modelStatus.models.join(", ") })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.retry")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
