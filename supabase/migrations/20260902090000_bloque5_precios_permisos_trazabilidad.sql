-- Bloque 5 (correccion confirmada con el cliente): el encargado de
-- Olavarria tambien puede cargar precios de venta, no solo el dueño.
-- Razon operativa: la mercaderia llega, la encargada la controla y define
-- el precio en el momento -- si tiene que esperar al dueño, terminan
-- anotando precios en papel y el sistema deja de reflejar la realidad.
--
-- El control pasa de preventivo (solo dueño puede escribir) a detectivo
-- (ve_costos() puede escribir, se audita despues) -- mismo criterio que ya
-- usa el modulo de inventarios ("Ajustes de inventario sin aprobacion
-- previa. El control es detectivo, via auditoria", arquitectura.md 1.11).
-- Para que el control detectivo funcione hace falta trazabilidad real:
-- quien cargo cada precio y cuando, sin confiar en lo que mande el
-- cliente -- por eso `actualizado_por` lo pone un trigger con auth.uid(),
-- nunca la app.
--
-- Alcance: SOLO precios y precios_sucursal (el precio de venta en si).
-- recargos_sucursal, recargos_sku y descuentos_efectivo siguen exclusivos
-- del dueño: son decisiones de politica de precios (cuanto recargo tiene
-- una categoria, que descuento por efectivo se ofrece), no la carga
-- operativa de un precio puntual que motiva este cambio. Laprida sigue en
-- solo lectura en todo el bloque.

-- =========================================================
-- Trazabilidad: quien cargo/edito el precio, ademas de cuando
-- =========================================================

alter table precios add column actualizado_por uuid references usuarios (id);
alter table precios_sucursal add column actualizado_por uuid references usuarios (id);

-- Backfill defensivo por si ya hay filas cargadas antes de esta migracion:
-- no hay forma de saber retroactivamente quien las cargo, se atribuyen al
-- dueño para no dejar la columna en null.

update precios set actualizado_por = (select id from usuarios where rol = 'dueno' limit 1)
  where actualizado_por is null;
update precios_sucursal set actualizado_por = (select id from usuarios where rol = 'dueno' limit 1)
  where actualizado_por is null;

alter table precios alter column actualizado_por set not null;
alter table precios_sucursal alter column actualizado_por set not null;

-- Reemplaza el trigger de solo-UPDATE del bloque 5 original: ahora corre
-- tambien en INSERT (para fijar actualizado_por desde la primera carga) y
-- toma el autor de auth.uid(), ignorando lo que mande el cliente -- el
-- control detectivo necesita que este dato sea confiable, no autoreportado.

drop trigger if exists precios_tocar_actualizado_en on precios;
drop trigger if exists precios_sucursal_tocar_actualizado_en on precios_sucursal;

create or replace function registrar_autor_precio()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

create trigger precios_registrar_autor
  before insert or update on precios
  for each row
  execute function registrar_autor_precio();

create trigger precios_sucursal_registrar_autor
  before insert or update on precios_sucursal
  for each row
  execute function registrar_autor_precio();

-- =========================================================
-- RLS: ve_costos() puede escribir precios y precios_sucursal
-- =========================================================

drop policy precios_insert on precios;
drop policy precios_update on precios;
drop policy precios_delete on precios;

create policy precios_insert on precios for insert with check (ve_costos());
create policy precios_update on precios for update using (ve_costos()) with check (ve_costos());
create policy precios_delete on precios for delete using (ve_costos());

drop policy precios_sucursal_insert on precios_sucursal;
drop policy precios_sucursal_update on precios_sucursal;
drop policy precios_sucursal_delete on precios_sucursal;

create policy precios_sucursal_insert on precios_sucursal for insert with check (ve_costos());
create policy precios_sucursal_update on precios_sucursal for update using (ve_costos()) with check (ve_costos());
create policy precios_sucursal_delete on precios_sucursal for delete using (ve_costos());

-- Los grants de insert/update/delete a `authenticated` sobre precios y
-- precios_sucursal ya existen desde el bloque 5 original -- RLS sigue
-- siendo quien decide quien puede escribir de verdad, no hace falta
-- tocarlos.
