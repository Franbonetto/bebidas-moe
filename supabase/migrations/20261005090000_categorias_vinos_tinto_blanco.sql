-- Categorías: "Vinos" se abre en "Vinos tintos" y "Vinos blancos".
--
-- Pedido del usuario 2026-09-29. Tiene sentido de negocio además del
-- ordenamiento: el recargo de Laprida es un monto fijo por categoría
-- (arquitectura.md 1.7) y el ejemplo que dio el cliente fue justamente
-- "+$500 en vinos tintos" -- con una sola categoría "Vinos" no se le puede
-- poner un recargo distinto al blanco.
--
-- Tres cosas que hay que cuidar al partir una categoría, y por eso esto no
-- es un simple delete + insert:
--
--   1. Los PRODUCTOS que ya estén en "Vinos". No hay forma de adivinar cuál
--      es tinto y cuál blanco, así que no se tocan ni se borra la categoría
--      si tiene alguno: se desactiva (deja de aparecer en los
--      desplegables, que filtran por activo = true) y la migración avisa
--      cuántos y cuáles quedaron para reasignar a mano.
--   2. El RECARGO DE LAPRIDA de la categoría (recargos_sucursal). Si no se
--      copia a las dos nuevas, los vinos de Laprida pierden el recargo en
--      silencio y quedan al precio de Olavarría.
--   3. La ALÍCUOTA DE IVA de la categoría, que las nuevas heredan.

begin;

do $$
declare
  v_vinos uuid;
  v_padre uuid;
  v_alicuota numeric(5, 2);
  v_tintos uuid;
  v_blancos uuid;
  v_productos integer := 0;
  v_nombres text;
begin
  select id, categoria_padre_id, alicuota_iva
  into v_vinos, v_padre, v_alicuota
  from categorias
  where lower(trim(nombre)) = 'vinos';

  -- Si no existía "Vinos", las nuevas se crean igual, en la raíz y al 21%
  -- (la tasa general, la misma que tiene hoy todo el catálogo).
  v_alicuota := coalesce(v_alicuota, 21);

  insert into categorias (nombre, categoria_padre_id, alicuota_iva)
  values ('Vinos tintos', v_padre, v_alicuota)
  on conflict (nombre) do update set activo = true
  returning id into v_tintos;

  insert into categorias (nombre, categoria_padre_id, alicuota_iva)
  values ('Vinos blancos', v_padre, v_alicuota)
  on conflict (nombre) do update set activo = true
  returning id into v_blancos;

  if v_vinos is null then
    raise notice 'No existía la categoría "Vinos". Se crearon "Vinos tintos" y "Vinos blancos".';
    return;
  end if;

  -- El recargo de Laprida se hereda tal cual: si después quiere cobrar
  -- distinto el tinto que el blanco, lo cambia desde Precios.
  insert into recargos_sucursal (sucursal_id, categoria_id, monto_fijo)
  select rs.sucursal_id, nueva.id, rs.monto_fijo
  from recargos_sucursal rs
  cross join (values (v_tintos), (v_blancos)) as nueva(id)
  where rs.categoria_id = v_vinos
  on conflict (sucursal_id, categoria_id) do nothing;

  select count(*), string_agg(nombre, ', ' order by nombre)
  into v_productos, v_nombres
  from productos where categoria_id = v_vinos;

  if v_productos = 0 then
    delete from recargos_sucursal where categoria_id = v_vinos;
    delete from categorias where id = v_vinos;
    raise notice 'Listo: "Vinos" no tenía productos, se eliminó. Quedan "Vinos tintos" y "Vinos blancos".';
  else
    update categorias set activo = false where id = v_vinos;
    raise notice
      '"Vinos" tenía % producto(s), así que NO se eliminó: quedó desactivada (ya no aparece en los desplegables). Hay que reasignarlos a tinto o blanco: %',
      v_productos, v_nombres;
  end if;
end;
$$;

commit;
