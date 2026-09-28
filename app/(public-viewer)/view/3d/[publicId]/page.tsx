import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";

import { PublicLoginRequired } from "@/components/3d/viewer/PublicLoginRequired";
import { PublicViewerPage } from "@/components/3d/viewer/PublicViewerPage";
import { resolveUserContext } from "@/lib/context/resolve-user-context";
import { getTranslations } from "@/lib/i18n/server";
import { getPublic3DStatus, resolveCompanyViewerForPublicId } from "@/lib/modules/project-3d/project-3d.public";

type Params = { params: Promise<{ publicId: string }> };

export const dynamic = "force-dynamic";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// A public address is not an invitation to index it (ADM-04A §6). noindex is not access control.
export const metadata: Metadata = { title: "3D viewer", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A 3D experience's stable share address (ADM-04A §7). Public: the anonymous
 * viewer. Company login only: a signed-in person with access goes on to the
 * canonical company viewer — an address built on the server, never taken from
 * the request — and anyone else sees the sign-in guidance. Anything else is
 * the same not-found as an address that never existed.
 */
export default async function PublicThreeDPage({ params }: Params) {
  const { publicId } = await params;
  const status = await getPublic3DStatus(publicId);
  if (status.state === "AVAILABLE") return <PublicViewerPage publicId={publicId} />;
  if (status.state !== "LOGIN_REQUIRED") notFound();

  const session = await resolveUserContext();
  if (session.ok) {
    const destination = await resolveCompanyViewerForPublicId(session.context, publicId);
    if (destination) redirect(destination);
  }
  const t = await getTranslations("threeD");
  return (
    <PublicLoginRequired
      title={t("page.loginTitle")}
      body={t("page.loginBody")}
      signIn={t("page.signIn")}
      signInHref={session.ok ? null : `/login?callbackUrl=${encodeURIComponent(`/view/3d/${publicId}`)}`}
    />
  );
}
