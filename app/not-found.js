import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Page not found</h1>
      <p className="mt-2 text-zinc-600">That page doesn&apos;t exist or may have moved.</p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700">Back to site</Link>
    </main>
  );
}
