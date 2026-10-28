-- Agrega "Mercado Pago" y "Cuenta DNI" como medios de pago discriminados,
-- separados del QR genérico (pedido del usuario 2026-10-28: el dueño los
-- quiere ver aparte en los cierres de caja y en su panel, no mezclados
-- dentro de "QR"). Mismo tratamiento que débito/crédito/transferencia/QR:
-- no son "billete en mano", así que no disparan descuento de efectivo ni
-- promociones, y sí disparan la facturación automática (dejan rastro
-- bancario, igual razón que QR en 20260921090000_agregar_medio_pago_qr.sql).
--
-- En el POS van 2do y 3ro, justo después de Efectivo (pedido del usuario):
-- Efectivo (F1), Mercado Pago (F2), Cuenta DNI (F3), QR (F4), Transferencia
-- (F5). Débito y Crédito pierden su tecla F dedicada -- ya no quedan F-keys
-- libres sin pisar Cantidad (F6), Entrada/Egresos (F7/F8), Ver precio (F9),
-- Buscar (F10), Nuevo ticket (F11) y Cobrar (F12) -- pero siguen
-- seleccionables con el mouse, igual que antes.
--
-- Se busca el nombre real de cada constraint en vez de asumirlo (mismo
-- criterio que 20260919100000_venta_pagos.sql), salvo las dos que esta
-- misma migración de antecesores ya nombró explícitamente.

alter table ventas drop constraint ventas_medio_pago_check;
alter table ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo', 'debito', 'credito', 'transferencia', 'qr', 'mercado_pago', 'cuenta_dni', 'mixto'));

alter table venta_pagos drop constraint venta_pagos_medio_pago_check;
alter table venta_pagos add constraint venta_pagos_medio_pago_check
  check (medio_pago in ('efectivo', 'debito', 'credito', 'transferencia', 'qr', 'mercado_pago', 'cuenta_dni'));

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'devoluciones'
    and con.contype = 'c'
    and att.attname = 'medio_reembolso';

  if v_constraint_name is not null then
    execute format('alter table devoluciones drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table devoluciones add constraint devoluciones_medio_reembolso_check
  check (medio_reembolso in ('efectivo', 'debito', 'credito', 'transferencia', 'qr', 'mercado_pago', 'cuenta_dni'));

-- confirmar_venta(): mismo cuerpo que 20261020130000_venta_idempotente.sql,
-- solo se agregan 'mercado_pago' y 'cuenta_dni' a la lista de medios
-- válidos. La firma no cambia, así que alcanza con reemplazar.
create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_pagos jsonb,
  p_lineas jsonb,
  p_es_envio boolean default false,
  p_motomandado text default null,
  p_direccion_envio text default null,
  p_envio_pagado boolean default null,
  p_idempotency_key uuid default null
)
returns ventas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja_id uuid;
  v_caja_estado text;
  v_venta ventas;
  v_item record;
  v_pago record;
  v_subtotal numeric(12, 2) := 0;
  v_descuentos numeric(12, 2) := 0;
  v_deposito numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_suma_pagos numeric(12, 2) := 0;
  v_cantidad_pagos integer;
  v_es_efectivo_puro boolean;
  v_medio_pago_venta text;
  v_tipo_envase_id uuid;
  v_valor_deposito numeric(12, 2);
  v_stock_actual integer;
  v_sin_stock boolean;
  v_descripcion text;
  v_recargo numeric(12, 2);
  v_editado boolean;
  v_toca_precio boolean;
  v_puede_tocar_precios boolean;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para vender en esta sucursal';
  end if;

  if p_idempotency_key is not null then
    select * into v_venta from ventas where idempotency_key = p_idempotency_key;
    if found then
      return v_venta;
    end if;
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El ticket no tiene productos';
  end if;

  if p_es_envio and (coalesce(trim(p_motomandado), '') = '' or coalesce(trim(p_direccion_envio), '') = '') then
    raise exception 'Un envio necesita motomandado y direccion';
  end if;

  if p_es_envio and p_envio_pagado is null then
    raise exception 'Un envio necesita saber si el pedido ya esta pago';
  end if;

  v_cantidad_pagos := coalesce(jsonb_array_length(p_pagos), 0);
  if v_cantidad_pagos < 1 or v_cantidad_pagos > 3 then
    raise exception 'La venta tiene que tener entre 1 y 3 medios de pago';
  end if;

  for v_pago in select * from jsonb_to_recordset(p_pagos) as x(medio_pago text, monto numeric)
  loop
    if v_pago.medio_pago not in ('efectivo', 'debito', 'credito', 'transferencia', 'qr', 'mercado_pago', 'cuenta_dni') then
      raise exception 'Medio de pago invalido: %', v_pago.medio_pago;
    end if;
    if v_pago.monto is null or v_pago.monto <= 0 then
      raise exception 'El monto de cada medio de pago tiene que ser mayor a cero';
    end if;
    v_suma_pagos := v_suma_pagos + v_pago.monto;
  end loop;

  v_es_efectivo_puro := v_cantidad_pagos = 1 and (p_pagos->0->>'medio_pago') = 'efectivo';
  v_medio_pago_venta := case when v_cantidad_pagos = 1 then p_pagos->0->>'medio_pago' else 'mixto' end;

  v_puede_tocar_precios := ve_costos();

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  select id, estado into v_caja_id, v_caja_estado
  from cajas
  where sucursal_id = p_sucursal_id and fecha = fecha_operativa();

  if v_caja_id is null then
    raise exception 'Todavia no se abrio la caja de hoy en esta sucursal';
  end if;

  if v_caja_estado <> 'abierta' then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  begin
    insert into ventas (
      sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id,
      es_envio, motomandado, direccion_envio, envio_pagado, idempotency_key
    )
    values (
      p_sucursal_id, auth.uid(), v_medio_pago_venta, 0, 0, v_caja_id,
      p_es_envio, nullif(trim(p_motomandado), ''), nullif(trim(p_direccion_envio), ''),
      case when p_es_envio then p_envio_pagado else null end,
      p_idempotency_key
    )
    returning * into v_venta;
  exception when unique_violation then
    select * into v_venta from ventas where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    perform set_config('bebidas_moe.venta_en_curso', 'off', true);
    return v_venta;
  end;

  for v_item in
    select * from jsonb_to_recordset(p_lineas) as x(
      sku_id uuid, descripcion text, cantidad integer, precio_unitario numeric,
      precio_lista_unitario numeric, promocion_id uuid, con_envase boolean,
      recargo_frio numeric, precio_editado boolean, precio_catalogo numeric
    )
  loop
    v_descripcion := nullif(trim(coalesce(v_item.descripcion, '')), '');
    v_recargo := coalesce(v_item.recargo_frio, 0);
    v_editado := coalesce(v_item.precio_editado, false);
    v_toca_precio := v_recargo > 0 or v_editado;

    if v_item.sku_id is null and v_descripcion is null then
      raise exception 'Una linea del ticket no tiene ni SKU ni descripcion';
    end if;
    if v_item.sku_id is not null and v_descripcion is not null then
      raise exception 'Una linea del ticket tiene SKU y descripcion a la vez';
    end if;
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor a cero';
    end if;
    if v_item.precio_unitario is null or v_item.precio_unitario < 0
       or v_item.precio_lista_unitario is null or v_item.precio_lista_unitario < 0 then
      raise exception 'El precio no puede ser negativo';
    end if;
    if v_item.precio_unitario > v_item.precio_lista_unitario then
      raise exception 'El precio final no puede ser mayor al precio de lista';
    end if;

    if v_toca_precio then
      if not v_puede_tocar_precios then
        raise exception 'No tenes permiso para tocar precios en el punto de venta';
      end if;
      if v_item.sku_id is null then
        raise exception 'Un producto particular no lleva recargo ni precio editado: su precio ya se carga a mano';
      end if;
      if v_item.promocion_id is not null then
        raise exception 'Una linea con promocion no se puede editar: el precio de la promo lo reparte el sistema';
      end if;
      if v_editado and v_item.precio_unitario <> v_item.precio_lista_unitario then
        raise exception 'Un precio tocado a mano no lleva descuento: el precio que se carga es el final';
      end if;
      if v_recargo > v_item.precio_unitario then
        raise exception 'El recargo por frio no puede ser mayor al precio que se cobra';
      end if;
    end if;

    if v_recargo < 0 then
      raise exception 'El recargo por frio no puede ser negativo';
    end if;

    if not v_es_efectivo_puro
       and (v_item.promocion_id is not null or v_item.precio_unitario <> v_item.precio_lista_unitario) then
      raise exception 'Las promociones y el descuento por efectivo solo aplican pagando 100%% en efectivo';
    end if;

    if v_item.sku_id is null then
      if v_item.promocion_id is not null then
        raise exception 'Un producto particular no puede tener promocion';
      end if;
      if coalesce(v_item.con_envase, false) then
        raise exception 'Un producto particular no puede llevar envase retornable';
      end if;
      if v_item.precio_unitario <> v_item.precio_lista_unitario then
        raise exception 'Un producto particular no lleva descuento: el precio que se carga es el final';
      end if;

      insert into venta_items (
        venta_id, sku_id, descripcion, cantidad, precio_unitario,
        precio_lista_unitario, promocion_id, con_envase, vendido_sin_stock
      ) values (
        v_venta.id, null, v_descripcion, v_item.cantidad, v_item.precio_unitario,
        v_item.precio_lista_unitario, null, false, false
      );

      v_subtotal := v_subtotal + v_item.precio_lista_unitario * v_item.cantidad;

      continue;
    end if;

    select coalesce(cantidad, 0) into v_stock_actual
    from stock_sucursal
    where sku_id = v_item.sku_id and sucursal_id = p_sucursal_id;

    v_sin_stock := coalesce(v_stock_actual, 0) < v_item.cantidad;

    insert into venta_items (
      venta_id, sku_id, cantidad, precio_unitario, precio_lista_unitario,
      promocion_id, con_envase, vendido_sin_stock,
      recargo_frio, precio_editado, precio_catalogo
    ) values (
      v_venta.id, v_item.sku_id, v_item.cantidad, v_item.precio_unitario,
      v_item.precio_lista_unitario, v_item.promocion_id,
      coalesce(v_item.con_envase, false), v_sin_stock,
      v_recargo, v_editado, case when v_editado then v_item.precio_catalogo end
    );

    perform registrar_movimiento(
      p_sku_id => v_item.sku_id,
      p_sucursal_id => p_sucursal_id,
      p_tipo => 'venta',
      p_cantidad => v_item.cantidad,
      p_motivo => case when v_sin_stock then 'Venta registrada sin stock suficiente' else null end,
      p_documento_tipo => 'venta',
      p_documento_id => v_venta.id
    );

    v_subtotal := v_subtotal + v_item.precio_lista_unitario * v_item.cantidad;
    v_descuentos := v_descuentos + (v_item.precio_lista_unitario - v_item.precio_unitario) * v_item.cantidad;

    if coalesce(v_item.con_envase, false) then
      select tipo_envase_id into v_tipo_envase_id from skus where id = v_item.sku_id;

      if v_tipo_envase_id is null then
        raise exception 'El SKU % no es retornable, no puede venderse con envase', v_item.sku_id;
      end if;

      select valor_deposito into v_valor_deposito from tipos_envase where id = v_tipo_envase_id;
      v_deposito := v_deposito + coalesce(v_valor_deposito, 0) * v_item.cantidad;

      perform registrar_movimiento_envase(
        p_tipo_envase_id => v_tipo_envase_id,
        p_sucursal_id => p_sucursal_id,
        p_tipo => 'ingreso_cliente',
        p_cantidad => v_item.cantidad,
        p_venta_id => v_venta.id
      );
    end if;
  end loop;

  v_total := v_subtotal - v_descuentos + v_deposito;

  if abs(v_suma_pagos - v_total) > 0.01 then
    raise exception 'La suma de los medios de pago ($%) no coincide con el total de la venta ($%)', v_suma_pagos, v_total;
  end if;

  update ventas set
    subtotal = v_subtotal,
    descuentos = v_descuentos,
    deposito_envases = v_deposito,
    total = v_total
  where id = v_venta.id
  returning * into v_venta;

  insert into venta_pagos (venta_id, medio_pago, monto)
  select v_venta.id, x.medio_pago, x.monto
  from jsonb_to_recordset(p_pagos) as x(medio_pago text, monto numeric);

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_venta;
end;
$$;

-- confirmar_devolucion(): mismo cuerpo que
-- 20261019110000_devolucion_medio_reembolso.sql, solo se agregan
-- 'mercado_pago' y 'cuenta_dni' a la lista de medios válidos. La firma no
-- cambia.
create or replace function confirmar_devolucion(
  p_venta_id uuid,
  p_items jsonb,
  p_resolucion text,
  p_cambio_items jsonb default null,
  p_observaciones text default null,
  p_medio_reembolso text default null
)
returns devoluciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_caja_id uuid;
  v_devolucion_id uuid;
  v_devolucion devoluciones;
  v_monto_reembolsado numeric(12, 2) := 0;
  v_medio_reembolso text;
  v_item record;
  v_venta_item record;
  v_ya_devuelto integer;
  v_cambio record;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id into v_sucursal_id from ventas where id = p_venta_id;
  if v_sucursal_id is null then
    raise exception 'La venta no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para hacer devoluciones en esta sucursal';
  end if;

  if p_resolucion not in ('dinero', 'cambio') then
    raise exception 'Resolucion invalida: %', p_resolucion;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La devolucion no tiene productos';
  end if;

  if p_resolucion = 'cambio' and (p_cambio_items is null or jsonb_array_length(p_cambio_items) = 0) then
    raise exception 'El cambio necesita al menos un producto de reemplazo';
  end if;

  if p_resolucion = 'dinero' then
    v_medio_reembolso := coalesce(p_medio_reembolso, 'efectivo');
    if v_medio_reembolso not in ('efectivo', 'debito', 'credito', 'transferencia', 'qr', 'mercado_pago', 'cuenta_dni') then
      raise exception 'Medio de reembolso invalido: %', v_medio_reembolso;
    end if;
  else
    v_medio_reembolso := null;
  end if;

  if p_resolucion = 'dinero' then
    select id into v_caja_id
    from cajas
    where sucursal_id = v_sucursal_id and fecha = fecha_operativa() and estado = 'abierta';

    if v_caja_id is null then
      raise exception 'Hace falta abrir la caja de hoy en esta sucursal para devolver dinero';
    end if;
  end if;

  perform set_config('bebidas_moe.devolucion_en_curso', 'on', true);

  insert into devoluciones (
    venta_id, sucursal_id, usuario_id, resolucion, caja_id, observaciones, medio_reembolso
  )
  values (
    p_venta_id, v_sucursal_id, auth.uid(), p_resolucion, v_caja_id, p_observaciones, v_medio_reembolso
  )
  returning id into v_devolucion_id;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      venta_item_id uuid, cantidad integer, destino text
    )
  loop
    if v_item.venta_item_id is null then
      raise exception 'Falta el item de venta a devolver';
    end if;
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad a devolver debe ser mayor a cero';
    end if;
    if v_item.destino not in ('stock', 'merma') then
      raise exception 'Destino invalido: %', v_item.destino;
    end if;

    select sku_id, cantidad, precio_unitario into v_venta_item
    from venta_items
    where id = v_item.venta_item_id and venta_id = p_venta_id;

    if not found then
      raise exception 'El item % no pertenece a la venta indicada', v_item.venta_item_id;
    end if;

    select coalesce(sum(cantidad), 0) into v_ya_devuelto
    from devolucion_items
    where venta_item_id = v_item.venta_item_id;

    if v_ya_devuelto + v_item.cantidad > v_venta_item.cantidad then
      raise exception
        'Se esta devolviendo mas cantidad de la vendida (vendido % , ya devuelto %, intentando devolver %)',
        v_venta_item.cantidad, v_ya_devuelto, v_item.cantidad;
    end if;

    insert into devolucion_items (devolucion_id, venta_item_id, cantidad, destino, precio_unitario)
    values (v_devolucion_id, v_item.venta_item_id, v_item.cantidad, v_item.destino, v_venta_item.precio_unitario);

    if v_venta_item.sku_id is not null then
      perform registrar_movimiento(
        p_sku_id => v_venta_item.sku_id,
        p_sucursal_id => v_sucursal_id,
        p_tipo => 'devolucion_entrada',
        p_cantidad => v_item.cantidad,
        p_documento_tipo => 'devolucion',
        p_documento_id => v_devolucion_id
      );

      if v_item.destino = 'merma' then
        perform registrar_movimiento(
          p_sku_id => v_venta_item.sku_id,
          p_sucursal_id => v_sucursal_id,
          p_tipo => 'merma',
          p_cantidad => v_item.cantidad,
          p_motivo => 'Devuelto por cliente, no reingresa a stock',
          p_documento_tipo => 'devolucion',
          p_documento_id => v_devolucion_id
        );
      end if;
    end if;

    v_monto_reembolsado := v_monto_reembolsado + v_item.cantidad * v_venta_item.precio_unitario;
  end loop;

  if p_resolucion = 'cambio' then
    for v_cambio in
      select * from jsonb_to_recordset(p_cambio_items) as x(sku_id uuid, cantidad integer)
    loop
      if v_cambio.sku_id is null then
        raise exception 'Falta el SKU de reemplazo del cambio';
      end if;
      if v_cambio.cantidad is null or v_cambio.cantidad <= 0 then
        raise exception 'La cantidad de reemplazo debe ser mayor a cero';
      end if;
      if not exists (select 1 from skus where id = v_cambio.sku_id) then
        raise exception 'El SKU de reemplazo % no existe', v_cambio.sku_id;
      end if;

      insert into devolucion_cambio_items (devolucion_id, sku_id, cantidad)
      values (v_devolucion_id, v_cambio.sku_id, v_cambio.cantidad);

      perform registrar_movimiento(
        p_sku_id => v_cambio.sku_id,
        p_sucursal_id => v_sucursal_id,
        p_tipo => 'cambio_salida',
        p_cantidad => v_cambio.cantidad,
        p_documento_tipo => 'devolucion',
        p_documento_id => v_devolucion_id
      );
    end loop;
  end if;

  update devoluciones
  set monto_reembolsado = case when p_resolucion = 'dinero' then v_monto_reembolsado else null end
  where id = v_devolucion_id
  returning * into v_devolucion;

  perform set_config('bebidas_moe.devolucion_en_curso', 'off', true);

  return v_devolucion;
end;
$$;
