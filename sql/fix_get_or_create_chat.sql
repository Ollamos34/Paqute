-- Fix for Supabase error 42702:
-- column reference "user_a" is ambiguous

create or replace function public.get_or_create_chat(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_a uuid := user_a;
  p_b uuid := user_b;
  found_id uuid;
  lo uuid;
  hi uuid;
begin
  if p_a = p_b then
    select c.id
      into found_id
      from public.chats as c
     where c.user_a = p_a
       and c.user_b = p_b
     limit 1;

    if found_id is null then
      insert into public.chats (user_a, user_b)
      values (p_a, p_b)
      returning id into found_id;
    end if;

    return found_id;
  end if;

  if p_a < p_b then
    lo := p_a;
    hi := p_b;
  else
    lo := p_b;
    hi := p_a;
  end if;

  select c.id
    into found_id
    from public.chats as c
   where (c.user_a = lo and c.user_b = hi)
      or (c.user_a = hi and c.user_b = lo)
   limit 1;

  if found_id is null then
    insert into public.chats (user_a, user_b)
    values (lo, hi)
    returning id into found_id;
  end if;

  return found_id;
end;
$$;

grant execute on function public.get_or_create_chat(uuid, uuid)
to authenticated;