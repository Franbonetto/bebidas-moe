-- Bloque: libreta de clientes para facturar (pedido del usuario
-- 2026-10-20: "que se guarden los datos de los clientes que piden
-- factura A, así es más simple para la empleada").
--
-- Qué había antes: el formulario de facturar autocompletaba la razón
-- social leyendo el historial de `comprobantes_fiscales` cuando la
-- vendedora tipeaba un CUIT ya facturado. Eso tenía tres límites que el
-- usuario sintió en el mostrador: había que tipear el CUIT completo y
-- exacto (no se podía buscar por nombre), no guardaba la condición de
-- IVA, y un dato mal escrito quedaba mal para siempre porque un
-- comprobante es inmutable. Además se evaporaba con cualquier limpieza
-- de comprobantes, como la del paso a producción de hoy.
--
-- ALCANCE: esto es explícitamente el primer paso del CRM de clientes que
-- `CLAUDE.md` tenía como etapa posterior. Se adelanta a pedido del
-- usuario y se limita a lo que hace falta para emitir un comprobante:
-- CUIT, razón social y condición de IVA. No hay historial de compras por
-- cliente, ni cuenta corriente, ni contacto. Eso sigue siendo etapa
-- posterior.
--
-- Decisiones de implementación:
--
--   1. Se escribe DIRECTO vía RLS, sin función SECURITY DEFINER de por
--      medio. Es catálogo, igual que proveedores o categorías: no toca
--      stock, ni caja, ni comprobantes, así que no hay inconsistencia
--      posible que una transacción tenga que proteger. Por eso lleva
--      `grant insert, update` (CLAUDE.md: el grant es prerrequisito de
--      Postgres para que la política de RLS llegue a evaluarse).
--   2. Lectura y escritura para cualquier `usuario_activo()`, no
--      `ve_costos()`. La encargada de Laprida también factura (tiene su
--      punto de venta desde 20260917090000_arca_multisucursal.sql) y un
--      cliente no es un dato de costos.
--   3. SIN política de delete: un cliente no se borra, se corrige. Si se
--      borrara, los comprobantes ya emitidos a ese CUIT quedarían
--      huérfanos de contexto. No hay grant de delete tampoco.
--   4. `cuit` es único y con formato validado: es la identidad del
--      cliente y la clave por la que lo busca la vendedora. El dígito
--      verificador se valida en la app (lib/cuit.ts), no acá: un check
--      constraint con el cálculo de módulo 11 sería ilegible en SQL y
--      más difícil de corregir si ARCA algún día cambia el criterio.
--   5. `condicion_iva_id` es obligatorio: es el campo que ARCA exige en
--      cada comprobante desde la RG 5616, y el motivo principal por el
--      que esta tabla existe (que la vendedora no lo tenga que elegir a
--      mano cada vez).

create table clientes (
  id uuid primary key default gen_random_uuid(),
  cuit text not null unique check (cuit ~ '^[0-9]{11}$'),
  razon_social text not null check (length(trim(razon_social)) > 0),
  condicion_iva_id uuid not null references condicion_iva (id),
  -- auth.uid() como default: esta tabla se escribe directo desde la app,
  -- no hay función que lo pueda poner, y la política de insert de abajo
  -- se encarga de que nadie pueda atribuirle un alta a otro usuario.
  creado_por uuid not null references usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index clientes_condicion_iva_id_idx on clientes (condicion_iva_id);

create trigger clientes_tocar_actualizado_en
  before update on clientes
  for each row
  execute function tocar_actualizado_en();

alter table clientes enable row level security;

create policy clientes_select on clientes
  for select using (usuario_activo());

create policy clientes_insert on clientes
  for insert with check (usuario_activo() and creado_por = auth.uid());

create policy clientes_update on clientes
  for update using (usuario_activo()) with check (usuario_activo());

grant select on clientes to authenticated;
grant insert, update on clientes to authenticated;
