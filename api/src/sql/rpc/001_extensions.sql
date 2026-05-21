create extension if not exists pgcrypto;

-- Caller identity injection: each request opens a transaction and does
-- `SET LOCAL app.user_id = '<uuid>'` so RPC functions can read it.
create schema if not exists app;

create or replace function app.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
