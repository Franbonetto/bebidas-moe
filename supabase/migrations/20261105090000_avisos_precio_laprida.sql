-- Aviso de "falta cambiar el cartel de góndola" para Laprida (pedido del
-- usuario 2026-11-05): cuando Olavarría o el dueño cambian un precio base,
-- una excepción, el precio en efectivo de un SKU, o una promoción que
-- corre en Laprida, la encargada de Laprida tiene que enterarse para
-- actualizar el cartel en la góndola. Hasta ahora no había nada: solo se
-- guardaba quién tocó el precio por última vez (precios.actualizado_por),
-- sin avisarle a nadie.
--
-- No es un historial de precios (no guarda precio anterior -> nuevo; para
-- eso ya está /reportes/stock con actualizado_en si hiciera falta
-- reconstruirlo). Es una cola de pendientes: se llena al cambiar algo que
-- afecta a Laprida, y se vacía cuando la empleada confirma que ya cambió
-- el cartel. Mismo criterio que pedidos_compra.visto_en
-- (20260922150000): escritura angosta por función SECURITY DEFINER en vez
-- de reabrir un update general.

begin;

create table avisos_precio_laprida (
  id uuid primary key default gen_random_uuid(),
  -- Union: un aviso de precio es de un SKU puntual (su cartel propio); uno
  -- de promoción es de la promo (el cartel que hay que cambiar es el de
  -- la promo, no el de cada producto que la compone).
  sku_id uuid references skus (id),
  promocion_id uuid references promociones (id) on delete cascade,
  tipo text not null check (tipo in ('precio', 'promocion')),
  check (
    (tipo = 'precio' and sku_id is not null and promocion_id is null)
    or (tipo = 'promocion' and promocion_id is not null)
  ),
  descripcion text not null,
  generado_en timestamptz not null default now(),
  generado_por uuid not null references usuarios (id),
  resuelto_en timestamptz,
  resuelto_por uuid references usuarios (id)
);

create index avisos_precio_laprida_sku_pendiente_idx
  on avisos_precio_laprida (sku_id) where resuelto_en is null;
create index avisos_precio_laprida_promocion_pendiente_idx
  on avisos_precio_laprida (promocion_id) where resuelto_en is null;

alter table avisos_precio_laprida enable row level security;

create policy avisos_precio_laprida_select on avisos_precio_laprida
  for select using (usuario_activo());

-- Sin políticas ni grants de insert/update/delete: solo las escriben las
-- dos funciones de abajo.

create or replace function generar_aviso_precio_laprida(
  p_tipo text,
  p_descripcion text,
  p_sku_id uuid default null,
  p_promocion_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  insert into avisos_precio_laprida (sku_id, promocion_id, tipo, descripcion, generado_por)
  values (p_sku_id, p_promocion_id, p_tipo, p_descripcion, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Quién puede marcarlo resuelto: quien opera Laprida (la empleada que
-- cambió el cartel), o el dueño. Mismo verbo "opera_sucursal" que ya usan
-- pedidos y transferencias.
create or replace function marcar_aviso_precio_resuelto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_laprida uuid;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select id into v_laprida from sucursales where es_central = false limit 1;

  if v_laprida is null or not opera_sucursal(v_laprida) then
    raise exception 'No tenes permiso para marcar este aviso como resuelto';
  end if;

  update avisos_precio_laprida
  set resuelto_en = now(), resuelto_por = auth.uid()
  where id = p_id and resuelto_en is null;
end;
$$;

-- La categoría nueva de /reportes/alertas (preferencias_alerta.categoria
-- es una lista cerrada, 20260905090000).
alter table preferencias_alerta drop constraint preferencias_alerta_categoria_check;
alter table preferencias_alerta add constraint preferencias_alerta_categoria_check
  check (categoria in (
    'stock', 'pedidos_transferencias', 'ventas_sin_stock', 'costos',
    'inmovilizado', 'rentabilidad', 'envases', 'precios_laprida'
  ));

grant select on all tables in schema public to authenticated;

commit;
