-- Run this only on a NEW, private Piko Books Supabase project, never TROC.
-- Server-only REST access; there is no browser role access to the records.
create table if not exists public.piko_books_expenses (
 id uuid primary key default gen_random_uuid(),
 expense_date date not null,
 description text not null check(length(description) between 1 and 450),
 seller text not null default '',
 category text not null check(category in ('inventory','shipping','packaging','platform_fees','software','equipment','office','other')),
 amount_cents bigint not null check(amount_cents>0),
 gst_cents bigint not null default 0 check(gst_cents>=0),
 qst_cents bigint not null default 0 check(qst_cents>=0),
 quantity integer check(quantity>=0),
 payment_source text not null check(payment_source in ('personal','business')),
 seller_receipt boolean not null default false,
 proof_path text,
 source text not null default 'manual',
 created_at timestamptz not null default now()
);
create index if not exists piko_books_expenses_date on public.piko_books_expenses(expense_date desc);
alter table public.piko_books_expenses enable row level security;
revoke all on public.piko_books_expenses from anon, authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('piko-books-evidence','piko-books-evidence',false,2000000,array['image/jpeg','image/png','image/webp','application/pdf'])
 on conflict(id) do nothing;
-- Intentionally no storage.objects policies for anon or authenticated roles.
