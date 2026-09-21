-- Pago dividido: una venta puede cobrarse combinando hasta 3 medios de
-- pago (ej. parte efectivo, parte débito). Decisiones de negocio
-- confirmadas con el usuario 2026-09-19:
--   1. Si el pago no es 100% efectivo, se pierde el precio/descuento de
--      efectivo para TODA la venta (nada de prorratear qué línea
--      corresponde a qué medio) -- mismo criterio que ya regía
--      "efectivo = billete en mano", ahora extendido a "100% efectivo".
--   2. Los montos por medio los tipea la cajera a mano; tienen que sumar
--      exacto el total de la venta.
--
-- `ventas.medio_pago` se mantiene (para no romper lo que ya lo lee) pero
-- ahora puede valer 'mixto' cuando hay 2 o 3 pagos -- el detalle real
-- (qué medio, cuánto) vive en `venta_pagos`. Cualquier cálculo de
-- reconciliación de efectivo (cerrar_caja, la vista previa de /vender/
-- caja) tiene que leer `venta_pagos`, no `ventas.total`, porque una venta
-- 'mixta' puede tener una porción real en efectivo.

-- Se busca el nombre real de la constraint en vez de asumirlo (mismo
-- criterio que 20260910090000_unidad_volumen_un_gramo.sql).
do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'ventas'
    and con.contype = 'c'
    and att.attname = 'medio_pago';

  if v_constraint_name is not null then
    execute format('alter table ventas drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo', 'debito', 'credito', 'transferencia', 'mixto'));

create table venta_pagos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas (id),
  medio_pago text not null check (medio_pago in ('efectivo', 'debito', 'credito', 'transferencia')),
  monto numeric(12, 2) not null check (monto > 0)
);

create index venta_pagos_venta_id_idx on venta_pagos (venta_id);

-- Mismo mecanismo de bloqueo que ventas/venta_items: se reusa la función y
-- el flag existentes porque venta_pagos se escribe dentro de la misma
-- transacción de confirmar_venta().
create trigger venta_pagos_bloquear_escritura_directa
  before insert or update or delete on venta_pagos
  for each row
  execute function bloquear_escritura_directa_ventas();

alter table venta_pagos enable row level security;

create policy venta_pagos_select on venta_pagos for select using (usuario_activo());

grant select on venta_pagos to authenticated;

-- =========================================================
-- confirmar_venta(): p_medio_pago (un solo valor) -> p_pagos (jsonb array
-- de {medio_pago, monto}, 1 a 3 elementos). El resto de la lógica de
-- líneas/stock/envases queda igual.
-- =========================================================

create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_pagos jsonb,
  p_lineas jsonb
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
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para vender en esta sucursal';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El ticket no tiene productos';
  end if;

  v_cantidad_pagos := coalesce(jsonb_array_length(p_pagos), 0);
  if v_cantidad_pagos < 1 or v_cantidad_pagos > 3 then
    raise exception 'La venta tiene que tener entre 1 y 3 medios de pago';
  end if;

  for v_pago in select * from jsonb_to_recordset(p_pagos) as x(medio_pago text, monto numeric)
  loop
    if v_pago.medio_pago not in ('efectivo', 'debito', 'credito', 'transferencia') then
      raise exception 'Medio de pago invalido: %', v_pago.medio_pago;
    end if;
    if v_pago.monto is null or v_pago.monto <= 0 then
      raise exception 'El monto de cada medio de pago tiene que ser mayor a cero';
    end if;
    v_suma_pagos := v_suma_pagos + v_pago.monto;
  end loop;

  v_es_efectivo_puro := v_cantidad_pagos = 1 and (p_pagos->0->>'medio_pago') = 'efectivo';
  v_medio_pago_venta := case when v_cantidad_pagos = 1 then p_pagos->0->>'medio_pago' else 'mixto' end;

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  -- La apertura de caja es explícita desde
  -- 20260903100000_apertura_caja.sql -- confirmar_venta() YA NO la crea
  -- sola. Esto reemplazó el "insert ... on conflict do nothing" que tenía
  -- la versión original del bloque 6 (esa versión vieja habría insertado
  -- una fila sin monto_apertura, que hoy es not null -- por eso el error
  -- "null value in column monto_apertura" que salió al probarlo).
  select id, estado into v_caja_id, v_caja_estado
  from cajas
  where sucursal_id = p_sucursal_id and fecha = current_date;

  if v_caja_id is null then
    raise exception 'Todavia no se abrio la caja de hoy en esta sucursal';
  end if;

  if v_caja_estado <> 'abierta' then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  insert into ventas (sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id)
  values (p_sucursal_id, auth.uid(), v_medio_pago_venta, 0, 0, v_caja_id)
  returning * into v_venta;

  for v_item in
    select * from jsonb_to_recordset(p_lineas) as x(
      sku_id uuid, cantidad integer, precio_unitario numeric,
      precio_lista_unitario numeric, promocion_id uuid, con_envase boolean
    )
  loop
    if v_item.sku_id is null then
      raise exception 'Falta el SKU en alguna linea del ticket';
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

    -- Regla inviolable: las promociones (combo/cantidad) y el descuento
    -- por efectivo son solo para pago 100% efectivo (arquitectura.md 1.7,
    -- extendido 2026-09-19 a pago dividido: si hay mas de un medio, o el
    -- unico medio no es efectivo, no corre ningun descuento).
    if not v_es_efectivo_puro
       and (v_item.promocion_id is not null or v_item.precio_unitario <> v_item.precio_lista_unitario) then
      raise exception 'Las promociones y el descuento por efectivo solo aplican pagando 100%% en efectivo';
    end if;

    select coalesce(cantidad, 0) into v_stock_actual
    from stock_sucursal
    where sku_id = v_item.sku_id and sucursal_id = p_sucursal_id;

    v_sin_stock := coalesce(v_stock_actual, 0) < v_item.cantidad;

    insert into venta_items (
      venta_id, sku_id, cantidad, precio_unitario, precio_lista_unitario,
      promocion_id, con_envase, vendido_sin_stock
    ) values (
      v_venta.id, v_item.sku_id, v_item.cantidad, v_item.precio_unitario,
      v_item.precio_lista_unitario, v_item.promocion_id,
      coalesce(v_item.con_envase, false), v_sin_stock
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

-- =========================================================
-- cerrar_caja(): el efectivo de ventas ahora sale de venta_pagos (una
-- venta 'mixta' puede tener una porcion real en efectivo), no de
-- ventas.total. El resto de la cuenta (apertura, devoluciones, entrada/
-- salida) queda igual que en 20260919090000_movimientos_caja.sql.
-- =========================================================

create or replace function cerrar_caja(p_caja_id uuid, p_efectivo_declarado numeric)
returns cajas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_estado text;
  v_monto_apertura numeric(12, 2);
  v_efectivo_ventas numeric(12, 2);
  v_devoluciones_dinero numeric(12, 2);
  v_entradas numeric(12, 2);
  v_salidas numeric(12, 2);
  v_efectivo_sistema numeric(12, 2);
  v_cantidad_tickets integer;
  v_caja cajas;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id, estado, monto_apertura into v_sucursal_id, v_estado, v_monto_apertura
  from cajas where id = p_caja_id
  for update;

  if not found then
    raise exception 'La caja no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para cerrar la caja de esta sucursal';
  end if;

  if v_estado <> 'abierta' then
    raise exception 'Esta caja ya esta cerrada';
  end if;

  if p_efectivo_declarado is null or p_efectivo_declarado < 0 then
    raise exception 'El efectivo declarado no puede ser negativo';
  end if;

  select coalesce(sum(vp.monto), 0) into v_efectivo_ventas
  from venta_pagos vp
  join ventas v on v.id = vp.venta_id
  where v.caja_id = p_caja_id and v.estado = 'confirmada' and vp.medio_pago = 'efectivo';

  select coalesce(sum(monto_reembolsado), 0) into v_devoluciones_dinero
  from devoluciones
  where caja_id = p_caja_id and resolucion = 'dinero';

  select coalesce(sum(monto), 0) into v_entradas
  from movimientos_caja
  where caja_id = p_caja_id and tipo = 'entrada';

  select coalesce(sum(monto), 0) into v_salidas
  from movimientos_caja
  where caja_id = p_caja_id and tipo = 'salida';

  v_efectivo_sistema := v_monto_apertura + v_efectivo_ventas - v_devoluciones_dinero + v_entradas - v_salidas;

  select count(*) into v_cantidad_tickets
  from ventas
  where caja_id = p_caja_id and estado = 'confirmada';

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  update cajas set
    estado = 'cerrada',
    efectivo_sistema = v_efectivo_sistema,
    efectivo_declarado = p_efectivo_declarado,
    diferencia = p_efectivo_declarado - v_efectivo_sistema,
    cantidad_tickets = v_cantidad_tickets,
    usuario_cierre_id = auth.uid(),
    cerrada_en = now()
  where id = p_caja_id
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;
