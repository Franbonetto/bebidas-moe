-- Bloque: pedido de compra semanal de Olavarría hacia el dueño.
-- Ver conversación del 2026-09-09: la encargada de Olavarría arma
-- semanalmente qué hace falta comprarle a los proveedores externos y esa
-- lista tiene que "llegarle" al dueño (que es quien de verdad hace el
-- pedido por WhatsApp, arquitectura.md — proveedores sin datos de contacto
-- a propósito). Es un objeto persistente, mismo patrón que un pedido
-- interno, pero sin transferencia: acá no se mueve stock ni se genera un
-- movimiento — el stock entra después, normal, cuando el dueño compre y
-- alguien cargue la recepción en Compras.
--
-- Decisiones de implementacion:
--   1. Solo dos estados (pendiente/resuelto): no hay despacho ni
--      transferencia de por medio, así que no hace falta la máquina de
--      estados completa de `pedidos`.
--   2. sucursal_id siempre central (Olavarría) -- se valida contra
--      sucursales.es_central por trigger, no hardcodeado, mismo criterio
--      que compras.sucursal_destino_id y pedidos.sucursal_*_id.
--   3. RLS con ve_costos() para todo (select/insert/update/delete): es
--      información de compras/costos, Laprida no la ve ni la toca --
--      mismo gate que proveedores/compras. Dueño y encargado de Olavarría
--      son simétricos acá (control detectivo, no preventivo, mismo
--      criterio que precios).
--   4. Se escribe directo por RLS, sin función SECURITY DEFINER: no hay
--      riesgo de inconsistencia de stock porque esto no toca stock.
--   5. Numeración PC-XXXX autogenerada, mismo mecanismo que LP-XXXX de
--      pedidos.

create sequence pedidos_compra_numero_seq;

create table pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  sucursal_id uuid not null references sucursales (id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'resuelto')),
  fecha_creacion timestamptz not null default now(),
  fecha_resolucion timestamptz,
  usuario_creador_id uuid not null references usuarios (id),
  usuario_resolucion_id uuid references usuarios (id),
  observaciones text,
  check (estado <> 'resuelto' or (fecha_resolucion is not null and usuario_resolucion_id is not null))
);

create index pedidos_compra_sucursal_id_idx on pedidos_compra (sucursal_id);

create table pedidos_compra_items (
  id uuid primary key default gen_random_uuid(),
  pedido_compra_id uuid not null references pedidos_compra (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad_sugerida integer not null check (cantidad_sugerida >= 0),
  cantidad_solicitada integer not null check (cantidad_solicitada > 0)
);

create index pedidos_compra_items_pedido_compra_id_idx on pedidos_compra_items (pedido_compra_id);

-- =========================================================
-- pedidos_compra: sucursal siempre central + numeración PC-XXXX
-- =========================================================

create or replace function validar_sucursal_pedido_compra()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from sucursales where id = new.sucursal_id and es_central = true) then
    raise exception 'Los pedidos de compra solo se arman para la sucursal central';
  end if;
  return new;
end;
$$;

create trigger pedidos_compra_validar_sucursal
  before insert or update on pedidos_compra
  for each row
  execute function validar_sucursal_pedido_compra();

create or replace function generar_numero_pedido_compra()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    new.numero := 'PC-' || lpad(nextval('pedidos_compra_numero_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger pedidos_compra_generar_numero
  before insert on pedidos_compra
  for each row
  execute function generar_numero_pedido_compra();

-- =========================================================
-- RLS + grants
-- =========================================================

alter table pedidos_compra enable row level security;
alter table pedidos_compra_items enable row level security;

create policy pedidos_compra_select on pedidos_compra for select using (ve_costos());
create policy pedidos_compra_insert on pedidos_compra for insert with check (ve_costos());
create policy pedidos_compra_update on pedidos_compra for update using (ve_costos()) with check (ve_costos());
create policy pedidos_compra_delete on pedidos_compra for delete using (ve_costos());

create policy pedidos_compra_items_select on pedidos_compra_items for select using (ve_costos());
create policy pedidos_compra_items_insert on pedidos_compra_items for insert with check (ve_costos());
create policy pedidos_compra_items_update on pedidos_compra_items for update using (ve_costos()) with check (ve_costos());
create policy pedidos_compra_items_delete on pedidos_compra_items for delete using (ve_costos());

grant select, insert, update, delete on pedidos_compra, pedidos_compra_items to authenticated;

-- =========================================================
-- sugerir_compra_semanal(): análoga a sugerir_pedido() (bloque 7) pero
-- para compras externas de Olavarría en vez de pedidos internos a
-- Laprida. "En camino" acá es lo ya comprado (compras.estado =
-- 'confirmada') que todavía no se recibió -- no hay "pedidos abiertos"
-- ni "arrastre" porque esos conceptos son del flujo de pedidos internos,
-- no aplican a comprarle a un proveedor.
-- =========================================================

create or replace function sugerir_compra_semanal()
returns table (
  sku_id uuid,
  stock_actual integer,
  en_camino integer,
  stock_objetivo integer,
  sugerido integer
)
language plpgsql
stable
as $$
declare
  v_central_id uuid;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select id into v_central_id from sucursales where es_central = true;

  if not opera_sucursal(v_central_id) then
    raise exception 'No tenes permiso para ver la sugerencia de compra';
  end if;

  return query
  with en_camino as (
    select ci.sku_id, sum(ci.cantidad)::integer as cantidad
    from compra_items ci
    join compras c on c.id = ci.compra_id
    where c.sucursal_destino_id = v_central_id and c.estado = 'confirmada'
    group by ci.sku_id
  )
  select
    s.id,
    coalesce(ss.cantidad, 0),
    coalesce(ec.cantidad, 0),
    s.stock_objetivo,
    greatest(s.stock_objetivo - coalesce(ss.cantidad, 0) - coalesce(ec.cantidad, 0), 0)
  from skus s
  left join stock_sucursal ss on ss.sku_id = s.id and ss.sucursal_id = v_central_id
  left join en_camino ec on ec.sku_id = s.id
  where s.activo = true;
end;
$$;
