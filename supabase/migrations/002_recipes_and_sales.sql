-- Kitchen Ledger v2. Run once AFTER 001. Existing invoices and stock are retained.
begin;
alter function public.ledger_state() rename to ledger_state_v1;
alter function public.ledger_action(text,jsonb) rename to ledger_action_v1;
revoke all on function public.ledger_state_v1(),public.ledger_action_v1(text,jsonb) from public,anon,authenticated;

create table public.ledger_recipes (
 id uuid primary key, owner_id uuid not null references auth.users(id), name text not null check(length(trim(name))>0),
 yield_servings numeric not null check(yield_servings>0), revision integer not null, ingredients jsonb not null,
 updated_at timestamptz not null default now(), unique(owner_id,id)
);
create table public.ledger_sales_batches (
 id uuid primary key, owner_id uuid not null references auth.users(id), sales_date date not null,
 note text not null default '', request jsonb not null, entries jsonb not null, usage jsonb not null,
 created_at timestamptz not null default now(), voided_at timestamptz, unique(owner_id,id)
);
create table public.ledger_recipe_sales (
 owner_id uuid not null, batch_id uuid not null, recipe_id uuid not null, sales_date date not null,
 servings integer not null check(servings>0), voided boolean not null default false,
 primary key(batch_id,recipe_id),
 foreign key(owner_id,batch_id) references public.ledger_sales_batches(owner_id,id),
 foreign key(owner_id,recipe_id) references public.ledger_recipes(owner_id,id)
);
create unique index ledger_daily_recipe_once on public.ledger_recipe_sales(owner_id,recipe_id,sales_date) where not voided;
alter table public.ledger_movements add column sale_id uuid;
alter table public.ledger_movements add constraint ledger_movement_sale_owner foreign key(owner_id,sale_id) references public.ledger_sales_batches(owner_id,id);
do $$ declare t text; begin
 foreach t in array array['ledger_recipes','ledger_sales_batches','ledger_recipe_sales'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
 end loop;
end $$;

create function ledger_private.convert_unit(q numeric,f text,t text) returns numeric language plpgsql immutable set search_path='' as $$
declare fu text:=lower(trim(f));tu text:=lower(trim(t));fd text;td text;ff numeric;tf numeric;
begin
 fu:=case fu when 'kgs' then 'kg' when 'grams' then 'g' when 'lbs' then 'lb' when 'liters' then 'l' when 'litres' then 'l' when 'ea' then 'each' when 'pcs' then 'each' else fu end;
 tu:=case tu when 'kgs' then 'kg' when 'grams' then 'g' when 'lbs' then 'lb' when 'liters' then 'l' when 'litres' then 'l' when 'ea' then 'each' when 'pcs' then 'each' else tu end;
 if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or coalesce(fu,'')='' or coalesce(tu,'')='' then raise exception 'Invalid ingredient quantity or unit'; end if;
 if fu=tu then return q; end if;
 fd:=case when fu in ('kg','g','lb','oz') then 'mass' when fu in ('l','ml') then 'volume' when fu='each' then 'count' else null end;
 td:=case when tu in ('kg','g','lb','oz') then 'mass' when tu in ('l','ml') then 'volume' when tu='each' then 'count' else null end;
 if fd is null or td is null or fd<>td then raise exception 'Incompatible ingredient units: % to %',f,t; end if;
 ff:=case fu when 'kg' then 1000 when 'g' then 1 when 'lb' then 453.59237 when 'oz' then 28.349523125 when 'l' then 1000 else 1 end;
 tf:=case tu when 'kg' then 1000 when 'g' then 1 when 'lb' then 453.59237 when 'oz' then 28.349523125 when 'l' then 1000 else 1 end;
 return q*ff/tf;
end $$;
revoke all on function ledger_private.convert_unit(numeric,text,text) from public,anon,authenticated;

create function public.ledger_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s jsonb;
begin
 if u is null then raise exception 'Sign in first'; end if;
 s:=public.ledger_state_v1();
 return s||jsonb_build_object('version',2,
 'recipes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'yieldServings',r.yield_servings,'revision',r.revision,'ingredients',r.ingredients,'updatedAt',r.updated_at) order by r.name) from public.ledger_recipes r where r.owner_id=u),'[]'::jsonb),
 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'date',b.sales_date,'note',b.note,'entries',b.entries,'usage',b.usage,'at',b.created_at,'voidedAt',b.voided_at) order by b.created_at) from public.ledger_sales_batches b where b.owner_id=u),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'productId',m.product_id,'invoiceId',m.invoice_id,'itemId',m.item_id,'receiptId',m.receipt_id,'saleId',m.sale_id,'quantity',m.quantity,'type',m.movement_type,'reason',m.reason,'at',m.created_at) order by m.created_at) from public.ledger_movements m where m.owner_id=u),'[]'::jsonb));
end $$;

create function public.ledger_action(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();r public.ledger_recipes;old public.ledger_recipes;p public.ledger_products;b public.ledger_sales_batches;
 i jsonb;e jsonb;item jsonb;yield_n numeric;q numeric;sold numeric;available numeric;used numeric;d date;
 entries jsonb:='[]';usage jsonb:='[]';ingredients jsonb;demand jsonb:='{}';seen text[]:=array[]::text[];request_id uuid;demand_product_id uuid;request_date date;
begin
 if u is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if action='recipe_save' then
  select * into old from public.ledger_recipes where id=(payload->>'id')::uuid for update;
  if found and old.owner_id<>u then raise exception 'Recipe not found'; end if;
  if old.id is not null and (payload->>'revision')::integer is distinct from old.revision then raise exception 'Recipe changed elsewhere. Reload before saving'; end if;
  yield_n:=(payload->>'yieldServings')::numeric;
  if length(trim(coalesce(payload->>'name','')))=0 or yield_n is null or yield_n<=0 or yield_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a name and positive recipe yield'; end if;
  if jsonb_typeof(payload->'ingredients') is distinct from 'array' or jsonb_array_length(payload->'ingredients') not between 1 and 100 then raise exception 'Add between 1 and 100 ingredients'; end if;
  for i in select value from jsonb_array_elements(payload->'ingredients') loop
   select * into p from public.ledger_products where id=(i->>'productId')::uuid and owner_id=u and track_stock;
   if not found then raise exception 'Match every ingredient to your stock-tracked item'; end if;
   perform ledger_private.convert_unit((i->>'quantity')::numeric,i->>'unit',p.base_unit);
  end loop;
  insert into public.ledger_recipes(id,owner_id,name,yield_servings,revision,ingredients) values((payload->>'id')::uuid,u,trim(payload->>'name'),yield_n,coalesce(old.revision,0)+1,payload->'ingredients')
  on conflict(id) do update set name=excluded.name,yield_servings=excluded.yield_servings,revision=excluded.revision,ingredients=excluded.ingredients,updated_at=now();
 elsif action='sales_post' then
  request_id:=(payload->>'id')::uuid;
  select * into b from public.ledger_sales_batches where id=request_id;
  if found then
   if b.owner_id<>u then raise exception 'Sales request not found'; end if;
   if b.request is distinct from (payload-'id') then raise exception 'This request ID was already used for different sales'; end if;
   return public.ledger_state();
  end if;
  if coalesce(payload->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid sales date'; end if;
  request_date:=(payload->>'date')::date;
  if jsonb_typeof(payload->'entries') is distinct from 'array' or jsonb_array_length(payload->'entries') not between 1 and 100 then raise exception 'Enter sales for at least one recipe'; end if;
  for e in select value from jsonb_array_elements(payload->'entries') loop
   if e->>'recipeId'=any(seen) then raise exception 'A recipe can appear only once in a batch'; end if;
   seen:=array_append(seen,e->>'recipeId');
   select * into r from public.ledger_recipes where id=(e->>'recipeId')::uuid and owner_id=u;
   if not found then raise exception 'Recipe not found'; end if;
   if (e->>'revision')::integer is distinct from r.revision then raise exception 'Recipe changed. Reload the sales preview'; end if;
   sold:=(e->>'servings')::numeric;
   if sold is null or sold<=0 or sold<>trunc(sold) or sold::text in ('NaN','Infinity','-Infinity') or sold>2147483647 then raise exception 'Servings sold must be positive whole numbers'; end if;
   if exists(select 1 from public.ledger_recipe_sales where owner_id=u and recipe_id=r.id and sales_date=request_date and not voided) then raise exception 'Sales for % are already recorded on %. Void that batch before correcting it',r.name,request_date; end if;
   ingredients:='[]';
   for i in select value from jsonb_array_elements(r.ingredients) loop
    select * into p from public.ledger_products where id=(i->>'productId')::uuid and owner_id=u and track_stock;
    if not found then raise exception 'Recipe ingredient is no longer available'; end if;
    q:=ledger_private.convert_unit((i->>'quantity')::numeric,i->>'unit',p.base_unit)*sold/r.yield_servings;
    used:=coalesce((demand->>p.id::text)::numeric,0)+q;
    demand:=jsonb_set(demand,array[p.id::text],to_jsonb(used));
    ingredients:=ingredients||jsonb_build_array(jsonb_build_object('productId',p.id,'name',p.name,'unit',p.base_unit,'quantity',round(q,6)));
   end loop;
   entries:=entries||jsonb_build_array(jsonb_build_object('recipeId',r.id,'revision',r.revision,'name',r.name,'servings',sold,'yieldServings',r.yield_servings,'ingredients',ingredients));
  end loop;
  for demand_product_id,used in select key::uuid,value::numeric from jsonb_each_text(demand) loop
   used:=round(used,6);if used<=0 or used::text in ('NaN','Infinity','-Infinity') then raise exception 'Calculated usage is invalid or too small to post'; end if;
   select * into p from public.ledger_products where id=demand_product_id and owner_id=u;
   select coalesce(sum(quantity),0) into available from public.ledger_movements where owner_id=u and product_id=p.id;
   if available<used then raise exception 'Not enough %: need % %, available %',p.name,used,p.base_unit,available; end if;
   usage:=usage||jsonb_build_array(jsonb_build_object('productId',p.id,'name',p.name,'unit',p.base_unit,'quantity',used,'available',available,'remaining',available-used));
  end loop;
  insert into public.ledger_sales_batches(id,owner_id,sales_date,note,request,entries,usage) values(request_id,u,request_date,coalesce(payload->>'note',''),payload-'id',entries,usage);
  for e in select value from jsonb_array_elements(entries) loop
   insert into public.ledger_recipe_sales(owner_id,batch_id,recipe_id,sales_date,servings) values(u,request_id,(e->>'recipeId')::uuid,request_date,(e->>'servings')::integer);
  end loop;
  for item in select value from jsonb_array_elements(usage) loop
   insert into public.ledger_movements(owner_id,product_id,sale_id,quantity,movement_type,reason,created_at) values(u,(item->>'productId')::uuid,request_id,-(item->>'quantity')::numeric,'recipe_usage','Recipe sales · '||request_date::text,(request_date::timestamp+interval '12 hours') at time zone 'UTC');
  end loop;
 elsif action='sales_void' then
  select * into b from public.ledger_sales_batches where id=(payload->>'id')::uuid and owner_id=u for update;
  if not found then raise exception 'Sales batch not found'; end if;
  if b.voided_at is not null then return public.ledger_state(); end if;
  for item in select value from jsonb_array_elements(b.usage) loop
   insert into public.ledger_movements(owner_id,product_id,sale_id,quantity,movement_type,reason) values(u,(item->>'productId')::uuid,b.id,(item->>'quantity')::numeric,'recipe_reversal','Voided recipe sales · '||b.sales_date::text);
  end loop;
  update public.ledger_sales_batches set voided_at=now() where id=b.id;
  update public.ledger_recipe_sales set voided=true where batch_id=b.id;
 else
  perform public.ledger_action_v1(action,payload);
  return public.ledger_state();
 end if;
 return public.ledger_state();
end $$;
revoke all on function public.ledger_state(),public.ledger_action(text,jsonb) from public,anon;
grant execute on function public.ledger_state(),public.ledger_action(text,jsonb) to authenticated;
commit;
