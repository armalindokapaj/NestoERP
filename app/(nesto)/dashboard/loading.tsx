import { DashboardSkeleton } from "@/components/layout/page-skeletons";

/**
 * Dashboard loading state (PRD #4 §75), in the shared skeleton set.
 *
 * No longer the only loading boundary in the authenticated app: NAV-01 §2.1
 * replaced that rule. See `app/(nesto)/loading.tsx` for the response contract.
 */
export default function Loading() {
  return <DashboardSkeleton />;
}
