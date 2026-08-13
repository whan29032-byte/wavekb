export default function MemberProfileLoading() {
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10 md:px-6 md:py-14" aria-label="正在加载用户主页" aria-busy="true">
      <div className="h-80 rounded-xl bg-muted" />
      <div className="h-24 rounded-xl bg-muted" />
      <div className="h-48 rounded-xl bg-muted" />
    </main>
  );
}
