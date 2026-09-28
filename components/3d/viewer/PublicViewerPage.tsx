"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";

import { useThreeDTranslations } from "@/components/3d/three-d-text";
import { public3DBootstrapSchema, type Public3DBootstrap } from "@/lib/3d/public/public-manifest";
import type { ModelLoadStatus } from "@/lib/3d/runtime/render-engine/RenderEngine";
import { adaptPublicViewerBootstrap } from "@/lib/3d/viewer/bootstrap-adapter";
import { useViewerAvailability } from "./hooks/use-viewer-availability";

const ProjectViewerRuntime = dynamic(
  () => import("./ProjectViewerRuntime").then((module) => module.ProjectViewerRuntime),
  { ssr: false, loading: () => <Splash /> },
);

function Splash() {
  const t = useThreeDTranslations();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-900" role="status" aria-label={t("page.opening")}>
      <div className="viewer-loading-bar h-[2px] w-32 rounded-full" />
    </div>
  );
}

const readPublicStatus = (body: unknown) => {
  const status = body as { state?: unknown; token?: unknown } | undefined;
  return { available: status?.state === "AVAILABLE", token: typeof status?.token === "string" ? status.token : null };
};

/**
 * The anonymous viewer (ADM-04A §7): the shared renderer fed only the public
 * projection, through gated asset URLs. It checks its own availability while
 * visible and clears the scene the moment the experience goes offline, becomes
 * company-only, is deleted or loses its entitlement.
 *
 * `previewUrl` turns it into the Platform Admin's public preview: the same
 * content, loaded through a Platform-only endpoint, with no polling.
 */
export function PublicViewerPage({ publicId, previewUrl }: { publicId: string; previewUrl?: string }) {
  const t = useThreeDTranslations();
  const [bootstrap, setBootstrap] = React.useState<Public3DBootstrap | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [modelStatus, setModelStatus] = React.useState<ModelLoadStatus>({ state: "loading" });

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setMessage(null);
    setModelStatus({ state: "loading" });
    try {
      const response = await fetch(previewUrl ?? `/api/public/3d/${encodeURIComponent(publicId)}`, { cache: "no-store", credentials: "same-origin", signal });
      const json = await response.json() as { data?: { bootstrap?: unknown; prepared?: boolean } };
      const parsed = public3DBootstrapSchema.safeParse(json.data?.bootstrap);
      if (!response.ok || !parsed.success) {
        setBootstrap(null);
        setMessage(t("page.unavailableTitle"));
        return;
      }
      setBootstrap(parsed.data);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setBootstrap(null);
      setMessage(t("page.openFailed"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [previewUrl, publicId, t]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const { availability, check } = useViewerAvailability({
    statusUrl: `/api/public/3d/${encodeURIComponent(publicId)}/status`,
    token: previewUrl ? null : bootstrap?.token ?? null,
    read: readPublicStatus,
  });
  React.useEffect(() => {
    if (availability !== "revoked") return;
    setBootstrap(null);
    setMessage(t("page.noLongerAvailable"));
  }, [availability, t]);
  React.useEffect(() => {
    if (modelStatus.state === "failed" && !previewUrl) check();
  }, [check, modelStatus, previewUrl]);

  const runtime = React.useMemo(() => (bootstrap ? adaptPublicViewerBootstrap(bootstrap, publicId) : null), [bootstrap, publicId]);

  if (!runtime || !bootstrap) {
    if (loading) return <Splash />;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 p-4">
        <div className="viewer-glass w-full max-w-sm rounded-panel p-5 text-center" role="alert">
          <p className="text-sm font-semibold text-white">{message ?? t("page.unavailableTitle")}</p>
          <p className="mt-1 text-xs text-white/55">{t("page.unavailableBody")}</p>
          <button type="button" onClick={() => void load()} className="mt-4 inline-flex h-11 items-center justify-center gap-1.5 rounded-control bg-brand-500 px-4 text-[13px] font-semibold text-white hover:bg-brand-600">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="public-3d-viewer" data-release={bootstrap.releaseNumber}>
      <ProjectViewerRuntime key={bootstrap.token} bootstrap={runtime} channel="public" onModelLoadStatus={setModelStatus} />
      {previewUrl ? (
        <div className="pointer-events-none absolute left-3 top-3 z-[60] rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-neutral-900">{t("page.previewBadge")}</div>
      ) : null}
      {availability === "changed" ? (
        <div className="absolute inset-x-0 top-16 z-[60] flex justify-center px-3 sm:top-20">
          <div className="glass-panel-dark flex max-w-md items-center gap-3 rounded-panel px-4 py-3 text-white" role="status">
            <p className="min-w-0 text-xs font-semibold">{t("page.updatedTitle")}</p>
            <button type="button" onClick={() => void load()} disabled={loading} className="flex h-11 shrink-0 items-center gap-1.5 rounded-control bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t("page.reload")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
