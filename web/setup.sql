-- Kitchen Ledger v1. Run once in your Supabase SQL Editor.
-- Each authenticated app user owns a separate restaurant workspace in v1.
begin;
create schema if not exists ledger_private;
revoke all on schema ledger_private from public, anon, authenticated;

create table public.ledger_suppliers (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name))>0), account text not null default '', email text not null default '',
 unique(owner_id,id)
);
create table public.ledger_products (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name))>0), category text not null,
 base_unit text not null check(length(trim(base_unit))>0), storage_area text not null,
 track_stock boolean not null default true, reorder_level numeric not null default 0 check(reorder_level>=0),
 unique(owner_id,id)
);
create table public.ledger_invoices (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 supplier_id uuid, number text not null default '', status text not null default 'draft' check(status in ('draft','approved')),
 revision integer not null default 1, data jsonb not null,
 created_at timestamptz not null default now(), approved_at timestamptz,
 foreign key(owner_id,supplier_id) references public.ledger_suppliers(owner_id,id),
 unique(owner_id,id)
);
create unique index ledger_invoice_identity on public.ledger_invoices(owner_id,supplier_id,upper(trim(number))) where status='approved';
create table public.ledger_invoice_items (
 id uuid primary key, owner_id uuid not null, invoice_id uuid not null, product_id uuid not null,
 line_data jsonb not null, base_quantity numeric not null check(base_quantity>=0), received_quantity numeric not null default 0 check(received_quantity>=0 and received_quantity<=base_quantity),
 foreign key(owner_id,invoice_id) references public.ledger_invoices(owner_id,id),
 foreign key(owner_id,product_id) references public.ledger_products(owner_id,id), unique(owner_id,id)
);
create table public.ledger_movements (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), product_id uuid not null,
 invoice_id uuid, item_id uuid, receipt_id uuid, quantity numeric not null check(quantity<>0), movement_type text not null,
 reason text not null, created_at timestamptz not null default now(),
 foreign key(owner_id,product_id) references public.ledger_products(owner_id,id),
 foreign key(owner_id,invoice_id) references public.ledger_invoices(owner_id,id),
 foreign key(owner_id,item_id) references public.ledger_invoice_items(owner_id,id)
);
create table public.ledger_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), invoice_id uuid,
 action text not null, details jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(owner_id,invoice_id) references public.ledger_invoices(owner_id,id)
);
create index ledger_movement_product on public.ledger_movements(owner_id,product_id);
create index ledger_event_invoice on public.ledger_events(owner_id,invoice_id);

-- Expose read-only tables. All writes go through the permission-checking RPC.
do $$ declare t text; begin
 foreach t in array array['ledger_suppliers','ledger_products','ledger_invoices','ledger_invoice_items','ledger_movements','ledger_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t);
 end loop;
end $$;

create function public.ledger_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'Sign in first'; end if;
 select jsonb_build_object('version',1,
 'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'account',s.account,'email',s.email) order by s.name) from public.ledger_suppliers s where s.owner_id=u),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'baseUnit',p.base_unit,'storage',p.storage_area,'trackStock',p.track_stock,'reorder',p.reorder_level) order by p.name) from public.ledger_products p where p.owner_id=u),'[]'::jsonb),
 'invoices',coalesce((select jsonb_agg(i.data || jsonb_build_object('id',i.id,'supplierId',coalesce(i.supplier_id::text,''),'number',i.number,'status',i.status,'revision',i.revision,'approvedAt',i.approved_at,'items',case when i.status='approved' then coalesce((select jsonb_agg(li.line_data || jsonb_build_object('received',li.received_quantity) order by (li.line_data->>'lineNumber')::integer) from public.ledger_invoice_items li where li.invoice_id=i.id),'[]'::jsonb) else i.data->'items' end) order by i.created_at) from public.ledger_invoices i where i.owner_id=u),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'productId',m.product_id,'invoiceId',m.invoice_id,'itemId',m.item_id,'receiptId',m.receipt_id,'quantity',m.quantity,'type',m.movement_type,'reason',m.reason,'at',m.created_at) order by m.created_at) from public.ledger_movements m where m.owner_id=u),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'invoiceId',e.invoice_id,'action',e.action,'at',e.created_at) order by e.created_at) from public.ledger_events e where e.owner_id=u),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.ledger_action(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); inv public.ledger_invoices; prod public.ledger_products;
 l jsonb; q numeric; amount numeric; line_sum numeric:=0; subtotal numeric; tax numeric; charges numeric; discount numeric; total numeric;
 item public.ledger_invoice_items; receipt uuid:=gen_random_uuid(); count_changes integer:=0; rownum integer:=0; balance numeric; new_revision integer;
begin
 if u is null then raise exception 'Sign in first'; end if;
 -- Serialize operations for one owner, including duplicate approvals and receipts.
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if action='supplier' then
  insert into public.ledger_suppliers(id,owner_id,name,account,email) values((payload->>'id')::uuid,u,trim(payload->>'name'),coalesce(payload->>'account',''),coalesce(payload->>'email',''));
 elsif action='product' then
  insert into public.ledger_products(id,owner_id,name,category,base_unit,storage_area,track_stock,reorder_level) values((payload->>'id')::uuid,u,trim(payload->>'name'),coalesce(payload->>'category','Other'),trim(payload->>'baseUnit'),coalesce(payload->>'storage','Dry store'),coalesce((payload->>'trackStock')::boolean,true),coalesce((payload->>'reorder')::numeric,0));
 elsif action='save_invoice' then
  select * into inv from public.ledger_invoices where id=(payload->>'id')::uuid;
  if found and inv.owner_id<>u then raise exception 'Invoice not found'; end if;
  if inv.status='approved' then raise exception 'Approved invoices cannot be edited'; end if;
  if inv.id is not null and coalesce((payload->>'revision')::integer,0)<>inv.revision then raise exception 'Draft changed elsewhere. Reload before saving'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' then raise exception 'Invoice items must be an array'; end if;
  if jsonb_array_length(payload->'items')>200 then raise exception 'Maximum 200 invoice lines'; end if;
  if payload->>'storagePath' is not null and split_part(payload->>'storagePath','/',1)<>u::text then raise exception 'Invalid file owner'; end if;
  new_revision:=coalesce(inv.revision,0)+1;
  insert into public.ledger_invoices(id,owner_id,supplier_id,number,data,revision) values((payload->>'id')::uuid,u,nullif(payload->>'supplierId','')::uuid,coalesce(payload->>'number',''),payload - 'approvedAt' || jsonb_build_object('status','draft'),new_revision)
  on conflict(id) do update set supplier_id=excluded.supplier_id,number=excluded.number,data=excluded.data,revision=excluded.revision;
  insert into public.ledger_events(owner_id,invoice_id,action,details) values(u,(payload->>'id')::uuid,'Draft saved',jsonb_build_object('revision',new_revision));
 elsif action='approve' then
  select * into inv from public.ledger_invoices where id=(payload->>'id')::uuid and owner_id=u for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status='approved' then return public.ledger_state(); end if;
  if (payload->>'revision')::integer is distinct from inv.revision then raise exception 'Draft changed elsewhere. Reload before approving'; end if;
  if inv.supplier_id is null or length(trim(inv.number))=0 then raise exception 'Supplier and invoice number are required'; end if;
  if inv.data->>'currency' is distinct from 'USD' then raise exception 'Only USD is supported in v1'; end if;
  if coalesce(inv.data->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invoice date is required'; end if;
  perform (inv.data->>'date')::date;
  if coalesce(inv.data->>'dueDate','')<>'' then perform (inv.data->>'dueDate')::date; end if;
  if jsonb_array_length(inv.data->'items')=0 then raise exception 'At least one invoice line is required'; end if;
  for l in select value from jsonb_array_elements(inv.data->'items') loop
   rownum:=rownum+1;
   select * into prod from public.ledger_products where id=nullif(l->>'productId','')::uuid and owner_id=u;
   if not found then raise exception 'Match every line to an item or expense'; end if;
   if length(trim(coalesce(l->>'description','')))=0 or length(trim(coalesce(l->>'billingUnit','')))=0 then raise exception 'Description and billing unit are required'; end if;
   q:=(l->>'quantity')::numeric; amount:=(l->>'amount')::numeric;
   if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or (l->>'price')::numeric is null or (l->>'price')::numeric<0 or amount is null or amount<0 or abs(round(q*(l->>'price')::numeric,2)-amount)>0.011 then raise exception 'Line arithmetic or quantity is invalid'; end if;
   if amount::text in ('NaN','Infinity','-Infinity') or ((l->>'price')::numeric)::text in ('NaN','Infinity','-Infinity') then raise exception 'Amounts must be finite'; end if;
   if (l->>'baseQuantity')::numeric is null or (l->>'baseQuantity')::numeric<0 or ((l->>'baseQuantity')::numeric)::text in ('NaN','Infinity','-Infinity') or (prod.track_stock and (l->>'baseQuantity')::numeric<=0) then raise exception 'Confirm stock quantity'; end if;
   line_sum:=line_sum+amount;
   insert into public.ledger_invoice_items(id,owner_id,invoice_id,product_id,line_data,base_quantity) values((l->>'id')::uuid,u,inv.id,prod.id,l || jsonb_build_object('lineNumber',rownum,'received',0),(l->>'baseQuantity')::numeric);
  end loop;
  subtotal:=(inv.data->>'subtotal')::numeric; tax:=(inv.data->>'tax')::numeric; charges:=(inv.data->>'charges')::numeric; discount:=(inv.data->>'discount')::numeric; total:=(inv.data->>'total')::numeric;
  if subtotal is null or tax is null or charges is null or discount is null or total is null or least(subtotal,tax,charges,discount,total)<0 then raise exception 'Enter all nonnegative invoice totals'; end if;
  if subtotal::text in ('NaN','Infinity','-Infinity') or tax::text in ('NaN','Infinity','-Infinity') or charges::text in ('NaN','Infinity','-Infinity') or discount::text in ('NaN','Infinity','-Infinity') or total::text in ('NaN','Infinity','-Infinity') then raise exception 'Totals must be finite'; end if;
  if abs(round(line_sum,2)-subtotal)>0.011 or abs(round(subtotal+tax+charges-discount,2)-total)>0.011 then raise exception 'Invoice totals do not reconcile'; end if;
  update public.ledger_invoices set status='approved',approved_at=now() where id=inv.id;
  insert into public.ledger_events(owner_id,invoice_id,action,details) values(u,inv.id,'Invoice approved',jsonb_build_object('revision',inv.revision));
 elsif action='receive' then
  select * into inv from public.ledger_invoices where id=(payload->>'id')::uuid and owner_id=u for update;
  if not found or inv.status<>'approved' then raise exception 'Approve the invoice first'; end if;
  for item in select * from public.ledger_invoice_items where invoice_id=inv.id for update loop
   select * into prod from public.ledger_products where id=item.product_id;
   if not prod.track_stock then continue; end if;
   q:=coalesce((payload->'quantities'->>item.id::text)::numeric,0);
   if q<0 or q::text in ('NaN','Infinity','-Infinity') or q>item.base_quantity-item.received_quantity then raise exception 'Receipt exceeds remaining quantity'; end if;
   if q>0 then
    update public.ledger_invoice_items set received_quantity=received_quantity+q where id=item.id;
    insert into public.ledger_movements(owner_id,product_id,invoice_id,item_id,receipt_id,quantity,movement_type,reason) values(u,item.product_id,inv.id,item.id,receipt,q,'receipt',inv.number);
    count_changes:=count_changes+1;
   end if;
  end loop;
  if count_changes=0 then raise exception 'Enter a quantity to receive'; end if;
  insert into public.ledger_events(owner_id,invoice_id,action,details) values(u,inv.id,'Delivery confirmed',jsonb_build_object('receiptId',receipt));
 elsif action='adjust' then
  select * into prod from public.ledger_products where id=(payload->>'productId')::uuid and owner_id=u;
  if not found or not prod.track_stock then raise exception 'Choose a stock item'; end if;
  q:=(payload->>'quantity')::numeric;
  if q is null or q=0 or q::text in ('NaN','Infinity','-Infinity') or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Enter a finite nonzero quantity and reason'; end if;
  if payload->>'type' not in ('waste','usage','return','adjustment') then raise exception 'Invalid movement type'; end if;
  if payload->>'type'<>'adjustment' and q>0 then raise exception 'Waste, usage, and returns must reduce stock'; end if;
  select coalesce(sum(quantity),0) into balance from public.ledger_movements where owner_id=u and product_id=prod.id;
  if balance+q<0 then raise exception 'Stock cannot be negative'; end if;
  insert into public.ledger_movements(owner_id,product_id,quantity,movement_type,reason) values(u,prod.id,q,payload->>'type',payload->>'reason');
 else raise exception 'Unknown action'; end if;
 return public.ledger_state();
end $$;
revoke all on function public.ledger_state() from public, anon;
revoke all on function public.ledger_action(text,jsonb) from public, anon;
grant execute on function public.ledger_state(), public.ledger_action(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('invoices','invoices',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp','text/plain','application/json']) on conflict(id) do nothing;
create policy ledger_upload on storage.objects for insert to authenticated with check(bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy ledger_read on storage.objects for select to authenticated using(bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
