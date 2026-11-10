-- Botón "Ya cambié todos los carteles" de Laprida (pedido del usuario
-- 2026-11-10): resuelve de una sola vez todos los avisos de precio/promo
-- pendientes, en vez de una llamada por aviso (había cientos acumulados).
--
-- Mismo permiso que marcar_aviso_precio_resuelto(): quien opera Laprida o el
-- dueño. No borra nada: solo completa resuelto_en / resuelto_por, así que
-- queda registrado quién y cuándo.

begin;

create or replace function marcar_avisos_precio_resueltos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_laprida uuid;
  v_cantidad integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select id into v_laprida from sucursales where es_central = false limit 1;

  if v_laprida is null or not opera_sucursal(v_laprida) then
    raise exception 'No tenes permiso para marcar estos avisos como resueltos';
  end if;

  update avisos_precio_laprida
  set resuelto_en = now(), resuelto_por = auth.uid()
  where resuelto_en is null;

  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

commit;
