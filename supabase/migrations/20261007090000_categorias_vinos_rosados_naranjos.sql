-- Categorías: se agregan "Vinos rosados" y "Vinos naranjos".
--
-- Pedido del usuario 2026-09-29, cargando el catálogo de vinos. Completa la
-- apertura que arrancó en 20261005090000 (tintos y blancos).
--
-- Igual que en aquella: las nuevas heredan el padre, la alícuota de IVA y el
-- RECARGO DE LAPRIDA de las que ya existen. Lo del recargo no es un detalle
-- estético -- si una categoría no tiene monto cargado, el precio de Laprida
-- para esos productos sale igual al de Olavarría y nadie se entera hasta que
-- alguien mira un ticket. Se hereda el del tinto como punto de partida; si
-- el rosado tiene que llevar otro monto, se cambia desde Precios.

begin;

do $$
declare
  v_referencia uuid;
  v_padre uuid;
  v_alicuota numeric(5, 2);
  v_nueva uuid;
  v_nombre text;
begin
  -- Se toma como molde la primera categoría de vinos que exista, en este
  -- orden: tintos (la que seguro está), después la vieja "Vinos".
  select id, categoria_padre_id, alicuota_iva
  into v_referencia, v_padre, v_alicuota
  from categorias
  where lower(trim(nombre)) in ('vinos tintos', 'vinos')
  order by case lower(trim(nombre)) when 'vinos tintos' then 1 else 2 end
  limit 1;

  v_alicuota := coalesce(v_alicuota, 21);

  foreach v_nombre in array array['Vinos rosados', 'Vinos naranjos'] loop
    insert into categorias (nombre, categoria_padre_id, alicuota_iva)
    values (v_nombre, v_padre, v_alicuota)
    on conflict (nombre) do update set activo = true
    returning id into v_nueva;

    if v_referencia is not null then
      insert into recargos_sucursal (sucursal_id, categoria_id, monto_fijo)
      select rs.sucursal_id, v_nueva, rs.monto_fijo
      from recargos_sucursal rs
      where rs.categoria_id = v_referencia
      on conflict (sucursal_id, categoria_id) do nothing;
    end if;
  end loop;

  if v_referencia is null then
    raise notice 'No había ninguna categoría de vinos de referencia: las nuevas quedaron al 21%% y sin recargo de Laprida. Cargá el monto desde Precios.';
  else
    raise notice 'Listo: "Vinos rosados" y "Vinos naranjos" creadas, heredando alícuota y recargo de Laprida.';
  end if;
end;
$$;

commit;
