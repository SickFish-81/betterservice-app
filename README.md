# Betterservice Tepuke — shop management app

Next.js + Supabase app for a motorcycle & ATV repair shop (Betterservice Tepuke, Te Puke NZ).

## What it does
- **Staff back office** (login): job cards → labour/parts → owner-approved invoice → PDF filed + emailed; customers, machines, parts/inventory, staff, due-for-service reminders, invoices/cashflow tracker, shop settings.
- **Public site**: shop home, used-ATV gallery, Neuton batteries page.
- **Automated email**: invoices + service reminders via Resend + Supabase Edge Functions.

## Run locally
```bash
npm install
npm run dev   # http://localhost:3000
```
Requires a `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (never committed).

## Stack
Next.js (App Router) · React · Tailwind CSS v4 · Supabase (Postgres / Auth / Storage / Edge Functions) · Resend · jsPDF.
# betterservice-app
