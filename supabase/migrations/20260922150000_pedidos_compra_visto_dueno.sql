-- Badge rojo en "Pedidos" para el dueño: cuántos pedidos de compra
-- pendientes todavía no abrió (pedido del usuario 2026-09-22: "si hay un
-- pedido que no vio aún que aparezca un 1 rojo").
--
-- pedidos_compra.visto_en queda null hasta que el dueño abre el detalle.
-- Como la migración anterior (20260922130000) le sacó al dueño el update
-- directo sobre esta tabla (solo visualiza), marcar visto_en necesita su
-- propia función SECURITY DEFINER con permiso acotado -- mismo criterio
-- que registrar_movimiento()/confirmar_recepcion(): un camino angosto y
-- auditable en vez de reabrir el update general para el dueño.

begin;

alter table pedidos_compra add column visto_en timestamptz;

create or replace function marcar_pedido_compra_visto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not es_dueno() then
    raise exception 'Solo el dueño marca sus propios pedidos de compra como vistos';
  end if;

  update pedidos_compra set visto_en = now() where id = p_id and visto_en is null;
end;
$$;

commit;
