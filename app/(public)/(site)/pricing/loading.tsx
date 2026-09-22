export default function PricingLoading() {
  return (
    <main className="bg-canvas">
      <section className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8 lg:px-12" aria-busy="true" aria-label="Loading pricing configurator">
        <div className="h-4 w-44 animate-pulse rounded bg-line" />
        <div className="mt-5 h-12 max-w-2xl animate-pulse rounded bg-line" />
        <div className="mt-4 h-5 max-w-xl animate-pulse rounded bg-line" />
        <div className="mt-12 grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="h-[620px] animate-pulse rounded-2xl border border-line bg-surface" />
          <div className="h-[520px] animate-pulse rounded-2xl border border-line bg-surface" />
        </div>
      </section>
    </main>
  );
}
