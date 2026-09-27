export default function PlatformAdminLoading() {
  return <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading platform administration"><div className="h-10 w-72 animate-pulse rounded-lg bg-hover" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-line bg-surface" />)}</div><div className="h-96 animate-pulse rounded-xl border border-line bg-surface" /></div>;
}
