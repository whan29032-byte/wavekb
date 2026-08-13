export default function BoardLoading() {
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14" aria-label="正在加载板块" aria-busy="true">
      <div className="grid gap-3"><div className="h-10 w-44 rounded-lg bg-muted" /><div className="h-5 w-80 max-w-full rounded bg-muted" /></div>
      <div className="flex gap-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-10 w-24 rounded-lg bg-muted" />)}</div>
      <div className="grid gap-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-40 rounded-xl bg-muted" />)}</div>
    </main>
  );
}
