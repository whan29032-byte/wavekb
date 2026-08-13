export default function WorkbenchLoading() {
  return <main className="mx-auto grid max-w-6xl gap-5 px-4 py-12 md:px-6"><div className="h-10 w-56 rounded-lg bg-muted" /><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-11 rounded-lg bg-muted" />)}</div><div className="grid gap-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-32 rounded-xl border bg-surface" />)}</div></main>;
}
