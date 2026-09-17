-- Pantalla de administracion de promociones (docs/arquitectura.md, Parte 3:
-- "Pantalla de administracion de promociones -- pendiente de implementar").
-- El motor y las tablas (promociones/promocion_items) ya existen desde el
-- bloque 6; hoy solo se pueden cargar por SQL directo. Este bloque agrega
-- una unica funcion para poder cargarlas desde /precios.
--
-- Por que una funcion SECURITY DEFINER y no dos inserts sueltos desde la
-- app (como el alta de producto/SKU del bloque 2): cargar una promocion
-- son dos escrituras (promociones + N promocion_items), y
-- promocion_items tiene un trigger DEFERRED que exige la forma correcta
-- (>=2 SKU distintos para combo, exactamente 1 SKU con
-- cantidad_requerida >= 2 para cantidad). Ese trigger solo valida "al
-- final" de una misma transaccion. Con el cliente Supabase normal cada
-- .insert()/.update() es su propia transaccion implicita, asi que un
-- fallo en el segundo paso dejaria una promocion a medio armar. Envolver
-- todo en una sola funcion hace que la llamada RPC completa sea una unica
-- transaccion (regla 5 de CLAUDE.md: trazabilidad antes que velocidad).

create or replace function guardar_promocion(
  p_id uuid,
  p_nombre text,
  p_tipo text,
  p_sucursal_id uuid,
  p_vigente_desde date,
  p_vigente_hasta date,
  p_activo boolean,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tipo_actual text;
  v_cantidad_items integer;
begin
  if not ve_costos() then
    raise exception 'No tenes permiso para cargar promociones';
  end if;

  if p_tipo not in ('combo', 'cantidad') then
    raise exception 'Tipo de promocion invalido: %', p_tipo;
  end if;

  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'Falta el nombre de la promocion';
  end if;

  if p_vigente_desde is not null and p_vigente_hasta is not null
     and p_vigente_desde > p_vigente_hasta then
    raise exception 'La vigencia desde no puede ser posterior a la vigencia hasta';
  end if;

  select count(*) into v_cantidad_items from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
  if v_cantidad_items = 0 then
    raise exception 'La promocion necesita al menos un SKU';
  end if;

  if p_id is not null then
    select tipo into v_tipo_actual from promociones where id = p_id;
    if not found then
      raise exception 'La promocion no existe';
    end if;
    -- El tipo no se puede cambiar en una edicion (cambia la forma que
    -- exige el trigger de promocion_items): para eso se crea una nueva.
    if v_tipo_actual <> p_tipo then
      raise exception 'No se puede cambiar el tipo de una promocion existente';
    end if;

    update promociones set
      nombre = p_nombre,
      sucursal_id = p_sucursal_id,
      vigente_desde = p_vigente_desde,
      vigente_hasta = p_vigente_hasta,
      activo = coalesce(p_activo, true)
    where id = p_id;

    v_id := p_id;

    delete from promocion_items where promocion_id = v_id;
  else
    insert into promociones (nombre, tipo, sucursal_id, vigente_desde, vigente_hasta, activo)
    values (p_nombre, p_tipo, p_sucursal_id, p_vigente_desde, p_vigente_hasta, coalesce(p_activo, true))
    returning id into v_id;
  end if;

  insert into promocion_items (promocion_id, sku_id, cantidad_requerida, precio_promocional)
  select v_id, x.sku_id, x.cantidad_requerida, x.precio_promocional
  from jsonb_to_recordset(p_items) as x(
    sku_id uuid, cantidad_requerida integer, precio_promocional numeric
  );

  return v_id;
end;
$$;
