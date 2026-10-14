-- Precio en efectivo por SKU (monto fijo), ademas del descuento por
-- categoria que ya existia.
--
-- Pedido del usuario 2026-10-14: "en carga inicial donde pregunta precio
-- quiero agregar la opcion de q se pueda agregar otro precio pagando en
-- efectivo, y el sistema lo convierta en el punto de venta automatico si es
-- q es efectivo". Ejemplo del usuario: Abrasado $6.000 de lista, $5.000
-- pagando en efectivo, mas un 2x solo en efectivo.
--
-- Es el caso 3 de los postergados en arquitectura.md 3.4 ("Descuento por
-- efectivo fuera de vinos ... requiere que el descuento se pueda definir
-- por SKU ademas de por categoria"), resuelto como MONTO FIJO en vez de
-- porcentaje: decision del usuario 2026-10-14, porque con el producto en la
-- mano se piensa en el numero que se va a cobrar, no en un porcentaje. La
-- contra conocida y aceptada es la misma que la excepcion de Laprida: si
-- cambia el precio de lista, este numero queda viejo y hay que tocarlo.
--
-- El 2x del pedido NO necesita nada nuevo: ya existe como promocion tipo
-- 'cantidad' (bloque 6 + 20261010090000_promocion_precio_total.sql). Lo que
-- se agrega en la app es poder cargarlo desde carga inicial, con la misma
-- funcion guardar_promocion() que usa /precios.
--
-- Decisiones de implementacion (documentadas, no improvisadas):
--
--   1. Tabla propia por sucursal (sucursal_id, sku_id), mismo patron que
--      precios_sucursal: Olavarria y Laprida no manejan los mismos precios,
--      y agregar una tercera sucursal no cambia el esquema.
--
--   2. El monto fijo del SKU le gana al porcentaje de la categoria
--      (descuentos_efectivo) y tambien al override de precios_sucursal: es
--      la instruccion mas especifica que existe para "cuanto sale esto
--      pagando en efectivo". Mismo criterio que recargos_sku sobre
--      recargos_sucursal. Un SKU sin fila aca sigue exactamente como hasta
--      ahora: el 10% de Vinos en Olavarria no se toca.
--
--   3. Solo afecta al precio en efectivo. Debito, credito, transferencia y
--      QR siguen pagando el precio de lista (arquitectura.md 1.7,
--      "efectivo = billete en mano").
--
--   4. La resolucion de que precio gana sigue viviendo en lib/precios.ts,
--      no en SQL -- mismo criterio que todo el bloque 5: el precio se
--      resuelve al vuelo, nunca se guarda calculado.
--
--   5. Escritura ve_costos() y actualizado_por por trigger, igual que
--      precios y precios_sucursal desde
--      20260902090000_bloque5_precios_permisos_trazabilidad.sql: el
--      encargado de Olavarria carga el precio sin aprobacion previa y la
--      trazabilidad reemplaza al control preventivo (arquitectura.md 1.11).
--
--   6. No hay constraint que impida un precio en efectivo mayor al de
--      lista: el de lista sale de precios + recargos y no se puede
--      referenciar desde un CHECK. Se valida en la app, y ahi SI se
--      bloquea (no es un aviso como el de precio bajo el costo):
--      confirmar_venta() rechaza toda linea con precio_unitario >
--      precio_lista_unitario, asi que un efectivo mas alto que el de lista
--      no se cobra mas caro -- deja al producto sin poder venderse.

begin;

-- =========================================================
-- precios_efectivo
-- =========================================================

create table precios_efectivo (
  sucursal_id uuid not null references sucursales (id),
  sku_id uuid not null references skus (id),
  -- Lo que paga el cliente por UNA unidad pagando en efectivo. No es un
  -- descuento ni un porcentaje: es el precio final, cargado a mano.
  precio_efectivo numeric(12, 2) not null check (precio_efectivo >= 0),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid not null references usuarios (id),
  primary key (sucursal_id, sku_id)
);

create index precios_efectivo_sku_id_idx on precios_efectivo (sku_id);

comment on table precios_efectivo is
  'Precio en efectivo por SKU y sucursal, como monto fijo. Le gana al porcentaje de descuentos_efectivo y al override de precios_sucursal. Sin fila, rige el descuento de la categoria como siempre.';

alter table precios_efectivo enable row level security;

-- Lectura: cualquier usuario activo. El POS de las dos sucursales necesita
-- resolver el precio, mismo gate que precios/precios_sucursal -- es el
-- precio final que el encargado de Laprida ya ve, no la composicion del
-- precio (recargos/descuentos), que sigue siendo ve_costos().
create policy precios_efectivo_select on precios_efectivo for select using (usuario_activo());
create policy precios_efectivo_insert on precios_efectivo for insert with check (ve_costos());
create policy precios_efectivo_update on precios_efectivo
  for update using (ve_costos()) with check (ve_costos());
create policy precios_efectivo_delete on precios_efectivo for delete using (ve_costos());

-- Mismo trigger que precios y precios_sucursal: el autor sale de auth.uid(),
-- nunca de lo que mande la app.
create trigger precios_efectivo_registrar_autor
  before insert or update on precios_efectivo
  for each row
  execute function registrar_autor_precio();

commit;

-- =========================================================
-- Permisos
-- =========================================================
-- precios_efectivo la escribe la app directo (politicas RLS de insert/
-- update/delete, igual que precios_sucursal), asi que necesita el grant:
-- sin el, la politica no llega a evaluarse (ver NOTAS DEL ENTORNO en
-- CLAUDE.md).

grant select on all tables in schema public to authenticated;
grant insert, update, delete on precios_efectivo to authenticated;
