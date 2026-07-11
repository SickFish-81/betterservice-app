"use client";

export default function Error({ reset }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Something went wrong</h1>
      <p className="mt-2 text-zinc-600">This page hit an unexpected error. Try again, or head back to the dashboard.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={() => reset()} className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700">Try again</button>
        <a href="/dashboard" className="rounded-lg border border-zinc-300 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50">Dashboard</a>
      </div>
    </main>
  );
}
