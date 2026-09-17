-- Server-authoritative store for boroughs and app settings.
-- One shared database per deployment: any client talking to this server
-- sees the same towns and the same settings.

create table if not exists towns (
  id text primary key,
  name text not null,
  seed integer not null,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  souls integer not null default 0,
  buildings integer not null default 0,
  day integer not null default 1,
  hour integer not null default 0,
  save jsonb not null
);

create index if not exists towns_updated_at_ms_idx on towns (updated_at_ms desc);

create table if not exists app_kv (
  key text primary key,
  value jsonb not null,
  updated_at_ms bigint not null
);
