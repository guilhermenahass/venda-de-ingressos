create extension if not exists pgcrypto;

create table if not exists seats (
  id      text primary key,          -- ex.: 'A-12'
  sector  text not null,
  "row"   text not null,
  number  int  not null,
  x       int  not null,
  y       int  not null
);

create table if not exists events (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,
  name   text not null,
  date   timestamptz not null,
  status text not null default 'draft' check (status in ('draft','open','closed'))
);

create table if not exists event_sectors (
  event_id      uuid not null references events(id),
  sector        text not null,
  price_cents   int  not null check (price_cents >= 0),
  sales_open_at timestamptz not null,
  primary key (event_id, sector)
);

create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id),
  buyer_name       text not null,
  email            text not null,
  phone            text not null,
  seat_ids         text[] not null,
  total_cents      int  not null,
  status           text not null default 'pending'
                   check (status in ('pending','paid','expired','conflict','refunded')),
  mp_preference_id text,
  mp_init_point    text,
  mp_payment_id    text,
  created_at       timestamptz not null default now()
);
create index if not exists orders_email_idx on orders (lower(email));
create index if not exists orders_phone_idx on orders (phone);

create table if not exists event_seats (
  event_id   uuid not null references events(id),
  seat_id    text not null references seats(id),
  status     text not null default 'free' check (status in ('free','held','sold')),
  held_until timestamptz,
  order_id   uuid references orders(id),
  primary key (event_id, seat_id)
);
create index if not exists event_seats_order_idx on event_seats (order_id);

create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id),
  seat_id       text not null references seats(id),
  qr_token      uuid not null unique default gen_random_uuid(),
  checked_in_at timestamptz,
  revoked_at    timestamptz
);

-- RLS ligado e sem policies: anon/authenticated não leem nada. Só a service role acessa.
alter table seats         enable row level security;
alter table events        enable row level security;
alter table event_sectors enable row level security;
alter table orders        enable row level security;
alter table event_seats   enable row level security;
alter table tickets       enable row level security;
