-- Adapted PLpgSQL RPCs. `auth.uid()` is replaced with `app.uid()` (reads
-- from a per-transaction GUC). Storage and Supabase-auth dependent functions
-- (create_staff_account, update_staff_pin, delete_staff_account,
-- delete_own_account, handle_new_user trigger) have moved to backend code.

create or replace function public.current_staff_owner_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select p.owner_id
  from public.profiles p
  where p.id = app.uid()
    and p.role = 'staff'
  limit 1
$$;

create or replace function public.prevent_issuing_disabled_campaign_card()
returns trigger as $$
declare
  campaign_enabled boolean;
begin
  if new.campaign_id is null then
    return new;
  end if;

  select c.is_enabled
  into campaign_enabled
  from public.campaigns c
  where c.id = new.campaign_id;

  if found and campaign_enabled = false then
    raise exception 'CAMPAIGN_DISABLED: This campaign is disabled and cannot issue new cards.';
  end if;

  return new;
end;
$$ language plpgsql
set search_path = public;

drop trigger if exists issued_cards_block_disabled_campaign on public.issued_cards;
create trigger issued_cards_block_disabled_campaign
  before insert on public.issued_cards
  for each row
  execute function public.prevent_issuing_disabled_campaign_card();

create or replace function public.activate_license_key(key_input text)
returns jsonb as $$
declare
  key_row public.license_keys%rowtype;
  one_year_later timestamptz;
  caller uuid := app.uid();
begin
  if caller is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into key_row
  from public.license_keys
  where license_key = key_input
    and status = 'active'
    and profile_id is null
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid or already used license key');
  end if;

  one_year_later := now() + interval '1 year';

  update public.license_keys
  set profile_id = caller,
      activated_at = now(),
      expires_at = one_year_later
  where id = key_row.id;

  update public.profiles
  set tier = 'pro',
      tier_expires_at = one_year_later
  where id = caller;

  return jsonb_build_object('success', true, 'expires_at', one_year_later);
end;
$$ language plpgsql
set search_path = public;

create or replace function public.get_scan_entry_context(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_row record;
  card_row record;
begin
  select id, slug, business_name into owner_row
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select unique_id into card_row
  from public.issued_cards
  where unique_id = card_unique_id and owner_id = owner_row.id;
  if not found then return null; end if;

  return jsonb_build_object(
    'owner', jsonb_build_object(
      'id', owner_row.id,
      'slug', owner_row.slug,
      'businessName', owner_row.business_name
    ),
    'card', jsonb_build_object(
      'uniqueId', card_row.unique_id
    )
  );
end;
$$ language plpgsql
set search_path = public;

create or replace function public.inspect_scanned_card(card_unique_id uuid)
returns jsonb as $$
declare
  actor_row record;
  card_row record;
  actor_owner_id uuid;
  caller uuid := app.uid();
begin
  if caller is null then
    return jsonb_build_object('status', 'missing');
  end if;

  select id, role, owner_id into actor_row
  from public.profiles
  where id = caller;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  actor_owner_id := case
    when actor_row.role = 'owner' then actor_row.id
    else actor_row.owner_id
  end;

  if actor_owner_id is null then
    return jsonb_build_object('status', 'missing');
  end if;

  select owner_id into card_row
  from public.issued_cards
  where unique_id = card_unique_id;

  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  if card_row.owner_id <> actor_owner_id then
    return jsonb_build_object('status', 'foreign');
  end if;

  return jsonb_build_object('status', 'owned');
end;
$$ language plpgsql
set search_path = public;

create or replace function public.is_slug_available(slug_input text)
returns boolean as $$
begin
  return not exists (
    select 1 from public.profiles
    where slug = lower(trim(slug_input))
    and role = 'owner'
  );
end;
$$ language plpgsql
set search_path = public;

create or replace function public.get_public_campaign_signup_context(slug_input text, campaign_id_input text)
returns jsonb as $$
declare
  owner_row record;
  campaign_row record;
begin
  select id, slug, business_name
  into owner_row
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select id, name, is_enabled
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = owner_row.id;
  if not found then return null; end if;

  return jsonb_build_object(
    'owner', jsonb_build_object(
      'id', owner_row.id,
      'slug', owner_row.slug,
      'businessName', owner_row.business_name
    ),
    'campaign', jsonb_build_object(
      'id', campaign_row.id,
      'name', campaign_row.name,
      'isEnabled', campaign_row.is_enabled
    )
  );
end;
$$ language plpgsql
set search_path = public;

create or replace function public.register_public_campaign_signup(
  slug_input text,
  campaign_id_input text,
  customer_name_input text,
  customer_email_input text default null,
  customer_mobile_input text default null
)
returns jsonb as $$
declare
  owner_row record;
  campaign_row public.campaigns%rowtype;
  customer_row public.customers%rowtype;
  existing_card_row record;
  normalized_name text;
  normalized_email text;
  normalized_mobile text;
  now_ts timestamptz := now();
  new_card_id text;
  new_unique_id uuid;
begin
  normalized_name := trim(coalesce(customer_name_input, ''));
  normalized_email := nullif(lower(trim(coalesce(customer_email_input, ''))), '');
  normalized_mobile := nullif(regexp_replace(coalesce(customer_mobile_input, ''), '[^0-9]+', '', 'g'), '');

  if normalized_name = '' then
    return jsonb_build_object('outcome', 'error', 'error', 'Name is required.');
  end if;

  select id, slug, business_name
  into owner_row
  from public.profiles
  where slug = slug_input and role = 'owner';
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Business not found.');
  end if;

  select *
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = owner_row.id;
  if not found then
    return jsonb_build_object('outcome', 'error', 'error', 'Campaign not found.');
  end if;

  if normalized_email is not null or normalized_mobile is not null then
    select *
    into customer_row
    from public.customers c
    where c.owner_id = owner_row.id
      and (
        (normalized_email is not null and nullif(lower(trim(c.email)), '') = normalized_email)
        or
        (normalized_mobile is not null and nullif(regexp_replace(coalesce(c.mobile, ''), '[^0-9]+', '', 'g'), '') = normalized_mobile)
      )
    order by c.created_at asc
    limit 1;
  end if;

  if customer_row.id is not null then
    select ic.unique_id
    into existing_card_row
    from public.issued_cards ic
    where ic.owner_id = owner_row.id
      and ic.campaign_id = campaign_row.id
      and ic.customer_id = customer_row.id
      and ic.status = 'Active'
    order by ic.created_at asc
    limit 1;

    if found then
      return jsonb_build_object('outcome', 'redirect_existing', 'uniqueId', existing_card_row.unique_id);
    end if;
  end if;

  if campaign_row.is_enabled = false then
    return jsonb_build_object('outcome', 'campaign_disabled_no_existing');
  end if;

  if customer_row.id is null then
    insert into public.customers (id, owner_id, name, email, mobile, status)
    values (
      gen_random_uuid()::text,
      owner_row.id,
      normalized_name,
      coalesce(normalized_email, ''),
      normalized_mobile,
      'Active'
    )
    returning * into customer_row;
  end if;

  new_card_id := gen_random_uuid()::text;
  new_unique_id := gen_random_uuid();

  insert into public.issued_cards (
    id,
    unique_id,
    customer_id,
    campaign_id,
    owner_id,
    campaign_name,
    stamps,
    last_visit,
    status,
    template_snapshot
  )
  values (
    new_card_id,
    new_unique_id,
    customer_row.id,
    campaign_row.id,
    owner_row.id,
    campaign_row.name,
    0,
    current_date,
    'Active',
    jsonb_build_object(
      'id', campaign_row.id,
      'name', campaign_row.name,
      'description', campaign_row.description,
      'rewardName', campaign_row.reward_name,
      'tagline', campaign_row.tagline,
      'backgroundImage', campaign_row.background_image,
      'backgroundOpacity', campaign_row.background_opacity,
      'logoImage', campaign_row.logo_image,
      'showLogo', campaign_row.show_logo,
      'titleSize', campaign_row.title_size,
      'iconKey', campaign_row.icon_key,
      'colors', campaign_row.colors,
      'totalStamps', campaign_row.total_stamps,
      'social', campaign_row.social
    )
  );

  insert into public.transactions (
    id,
    card_id,
    type,
    amount,
    date,
    "timestamp",
    title
  )
  values (
    gen_random_uuid()::text,
    new_card_id,
    'issued',
    0,
    to_char(now_ts, 'Mon FMDD, YYYY FMHH12:MI AM'),
    floor(extract(epoch from now_ts) * 1000)::bigint,
    'Card Issued'
  );

  return jsonb_build_object('outcome', 'issued', 'uniqueId', new_unique_id);
end;
$$ language plpgsql
set search_path = public;

create or replace function public.delete_campaign_preserve_cards(campaign_id_input text)
returns jsonb as $$
declare
  campaign_row public.campaigns%rowtype;
  campaign_snapshot jsonb;
  caller uuid := app.uid();
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into campaign_row
  from public.campaigns
  where id = campaign_id_input
    and owner_id = caller;

  if not found then
    raise exception 'Campaign not found or not owned by current user';
  end if;

  campaign_snapshot := jsonb_build_object(
    'id', campaign_row.id,
    'name', campaign_row.name,
    'description', campaign_row.description,
    'rewardName', campaign_row.reward_name,
    'tagline', campaign_row.tagline,
    'backgroundImage', campaign_row.background_image,
    'backgroundOpacity', campaign_row.background_opacity,
    'logoImage', campaign_row.logo_image,
    'showLogo', campaign_row.show_logo,
    'titleSize', campaign_row.title_size,
    'iconKey', campaign_row.icon_key,
    'colors', campaign_row.colors,
    'totalStamps', campaign_row.total_stamps,
    'social', campaign_row.social
  );

  update public.issued_cards
  set template_snapshot = coalesce(template_snapshot, campaign_snapshot),
      campaign_name = coalesce(nullif(campaign_name, ''), campaign_row.name)
  where campaign_id = campaign_row.id;

  delete from public.campaigns
  where id = campaign_row.id;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql
set search_path = public;

create or replace function public.get_public_card(slug_input text, card_unique_id uuid)
returns jsonb as $$
declare
  owner_row record;
  card_row record;
  customer_row record;
  campaign_payload jsonb;
  history_data jsonb;
begin
  select id, slug, business_name into owner_row
  from public.profiles where slug = slug_input and role = 'owner';
  if not found then return null; end if;

  select * into card_row
  from public.issued_cards where unique_id = card_unique_id and owner_id = owner_row.id;
  if not found then return null; end if;

  select * into customer_row
  from public.customers where id = card_row.customer_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'description', c.description,
    'reward_name', c.reward_name,
    'tagline', c.tagline,
    'background_image', c.background_image,
    'background_opacity', c.background_opacity,
    'logo_image', c.logo_image,
    'show_logo', c.show_logo,
    'title_size', c.title_size,
    'icon_key', c.icon_key,
    'colors', c.colors,
    'total_stamps', c.total_stamps,
    'social', c.social
  )
  into campaign_payload
  from public.campaigns c
  where c.id = card_row.campaign_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'type', t.type, 'amount', t.amount,
      'date', t.date, 'timestamp', t."timestamp", 'title', t.title
    ) order by t."timestamp"
  ), '[]'::jsonb)
  into history_data
  from public.transactions t where t.card_id = card_row.id;

  return jsonb_build_object(
    'card', jsonb_build_object(
      'id', card_row.id, 'uniqueId', card_row.unique_id,
      'campaignId', card_row.campaign_id, 'campaignName', card_row.campaign_name,
      'stamps', card_row.stamps, 'lastVisit', card_row.last_visit,
      'status', card_row.status, 'completedDate', card_row.completed_date,
      'templateSnapshot', card_row.template_snapshot,
      'history', history_data
    ),
    'customer', jsonb_build_object(
      'id', customer_row.id, 'name', customer_row.name
    ),
    'campaign', campaign_payload
  );
end;
$$ language plpgsql
set search_path = public;
