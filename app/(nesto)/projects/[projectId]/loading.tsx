export default function ProjectWorkspaceLoading() {
  return (
    <div className="space-y-7" aria-busy="true" aria-label="Loading project workspace">
      <div className="h-5 w-72 animate-pulse rounded bg-surface-muted" />
      <div className="grid min-h-[430px] overflow-hidden rounded-3xl border border-line lg:grid-cols-2"><div className="animate-pulse bg-surface-muted" /><div className="grid grid-cols-2 gap-px bg-line"><div className="col-span-2 animate-pulse bg-surface" /><div className="animate-pulse bg-surface" /><div className="animate-pulse bg-surface" /></div></div>
      <div className="nesto-card grid gap-6 p-6 lg:grid-cols-3"><div className="h-28 animate-pulse rounded-xl bg-surface-muted" /><div className="h-28 animate-pulse rounded-xl bg-surface-muted lg:col-span-2" /></div>
      <div className="grid gap-5 lg:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="nesto-card h-56 animate-pulse bg-surface-muted" />)}</div>
    </div>
  );
}
