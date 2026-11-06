-- O Mercado Pago às vezes manda o mesmo aviso de pagamento várias vezes ao
-- mesmo tempo. A versão de 0012 checava "já está tudo pago?" antes de travar
-- os pedidos: duas chamadas simultâneas passavam pela checagem juntas e as
-- duas respondiam 'paid' (ingresso não duplicava, mas o e-mail ia em dobro).
-- Agora trava os pedidos da compra primeiro; a segunda chamada espera e já
-- encontra tudo pago. SUBSTITUI a de 0012.
create or replace function mark_compra_paid(p_compra uuid, p_payment_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_r  text;
begin
  perform 1 from orders where compra_id = p_compra order by id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not exists (select 1 from orders where compra_id = p_compra and status <> 'paid') then
    return 'already_paid';
  end if;

  begin
    for v_id in select id from orders where compra_id = p_compra order by id loop
      v_r := mark_order_paid(v_id, p_payment_id);
      if v_r = 'conflict' then raise exception 'COMPRA_CONFLICT'; end if;
    end loop;
  exception when raise_exception then
    if sqlerrm <> 'COMPRA_CONFLICT' then raise; end if;
    update orders set status = 'conflict', mp_payment_id = p_payment_id
     where compra_id = p_compra and status = 'pending';
    return 'conflict';
  end;
  return 'paid';
end $$;
