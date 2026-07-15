import Link from "next/link";

const cards = [
  { href: "/jobs", title: "Job Cards", desc: "Take a job from first contact to a filed invoice." },
  { href: "/counter-sales", title: "Counter Sale", desc: "Sell parts & accessories over the counter, no job card." },
  { href: "/invoices", title: "Invoices", desc: "What\u2019s billed and what\u2019s still owing." },
  { href: "/due", title: "Due For Service", desc: "Machines overdue for a service — chase them to book work." },
  { href: "/parts", title: "Parts & Inventory", desc: "Stock levels, prices, and low-stock alerts." },
  { href: "/secondhand", title: "For Sale (manage)", desc: "Add & manage second-hand listings + photos." },
  { href: "/customers", title: "Customers", desc: "The people the shop serves." },
  { href: "/machines", title: "Machines", desc: "Bikes & ATVs, linked to their owner." },
  { href: "/staff", title: "Staff", desc: "Who works on jobs, and who can send invoices." },
  { href: "/templates", title: "Checklist Templates", desc: "Standard task lists to drop onto a job." },
  { href: "/settings", title: "Shop Settings", desc: "Business details, GST # & bank shown on invoices." },
];

export default function Dashboard() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Shop Dashboard</h1>
      <p className="mt-2 text-zinc-600">Betterservice Te Puke — back office.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-red-300 hover:shadow-md">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900">{c.title}</h2>
              <span className="text-red-600 transition group-hover:translate-x-0.5">→</span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">{c.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
