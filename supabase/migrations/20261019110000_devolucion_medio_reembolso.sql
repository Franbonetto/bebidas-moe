-- Devolver dinero por posnet, no solo en efectivo (pedido del usuario
-- 2026-10-19).
--
-- Hasta ahora `confirmar_devolucion()` daba por sentado que toda devolución
-- de dinero era en efectivo -- era la decisión 1 de
-- 20260904090000_devoluciones_cliente.sql: "se resuelve siempre en
-- efectivo (mismo espíritu que las promociones: 'efectivo = billete en
-- mano' es el único medio con semántica de caja física)".
--
-- En el mostrador no es así: si el cliente pagó con tarjeta, la plata se le
-- devuelve por el posnet. Esa devolución NO sale del cajón, así que
-- contarla contra el efectivo del día hacía que el arqueo pidiera menos
-- plata de la que realmente tenía que haber.
--
-- Qué cambia:
--
--   1. `devoluciones.medio_reembolso`: con qué se le devolvió la plata.
--      Obligatorio si resolucion = 'dinero', null si es un cambio por otro
--      producto (ahí no hay plata). Los medios son los mismos que los de
--      una venta (venta_pagos), para que el reporte de caja los pueda
--      cruzar con lo cobrado.
--
--   2. `cerrar_caja()`: del efectivo esperado solo se descuentan las
--      devoluciones con medio_reembolso = 'efectivo'. Las de posnet,
--      transferencia o QR quedan registradas pero no tocan el cajón.
--
--   3. `confirmar_devolucion()`: toma el medio como parámetro. Sigue
--      exigiendo caja abierta para cualquier devolución de dinero, también
--      la de posnet: la devolución es una operación del mostrador de hoy y
--      `caja_id` es lo que la ata a un día y a una sucursal en los
--      reportes.
--
-- No se toca ninguna devolución histórica más que para completarle el medio
-- (ver abajo): los registros son inmutables (CLAUDE.md, regla 2).

-- =========================================================
-- 1. La columna
-- =========================================================

alter table devoluciones add column medio_reembolso text
  check (medio_reembolso in ('efectivo', 'debito', 'credito', 'transferencia', 'qr'));

comment on column devoluciones.medio_reembolso is
  'Con que se le devolvio la plata al cliente. Obligatorio si resolucion = dinero, null si es cambio por otro producto. Solo el efectivo descuenta del arqueo (cerrar_caja).';

-- Las devoluciones de dinero que ya existen fueron todas en efectivo: era
-- el único camino que el sistema ofrecía. Se les completa el medio para que
-- la constraint de coherencia de abajo pueda entrar y para que el reporte
-- no las muestre sin medio.
--
-- Va dentro de un DO porque `devoluciones` tiene el trigger que bloquea la
-- escritura directa (solo confirmar_devolucion() escribe): hay que prender
-- el flag en la misma transacción.
do $$
begin
  perform set_config('bebidas_moe.devolucion_en_curso', 'on', true);

  update devoluciones
  set medio_reembolso = 'efectivo'
  where resolucion = 'dinero' and medio_reembolso is null;

  perform set_config('bebidas_moe.devolucion_en_curso', 'off', true);
end $$;

-- dinero <=> tiene medio. cambio <=> no tiene.
alter table devoluciones add constraint devoluciones_medio_reembolso_coherente
  check ((resolucion = 'dinero') = (medio_reembolso is not null));

-- =========================================================
-- 2. cerrar_caja(): solo el efectivo descuenta del cajón
-- =========================================================

-- Mismo cuerpo que 20261008090000_empleado_caja.sql, con el filtro de
-- medio_reembolso en v_devoluciones_dinero (1 lugar). La firma no cambia.
create or replace function cerrar_caja(
  p_caja_id uuid,
  p_efectivo_declarado numeric,
  p_empleado_id uuid
)
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
  v_devoluciones_efectivo numeric(12, 2);
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

  if p_empleado_id is null then
    raise exception 'Decime quien cierra la caja';
  end if;

  -- Contra la sucursal de la caja, no contra la del usuario: el dueño opera
  -- las dos y podria cerrar la de Laprida desde Olavarria.
  if not exists (
    select 1 from empleados
    where id = p_empleado_id and sucursal_id = v_sucursal_id and activo = true
  ) then
    raise exception 'Esa persona no trabaja en esta sucursal o esta dada de baja';
  end if;

  select coalesce(sum(vp.monto), 0) into v_efectivo_ventas
  from venta_pagos vp
  join ventas v on v.id = vp.venta_id
  where v.caja_id = p_caja_id and v.estado = 'confirmada' and vp.medio_pago = 'efectivo';

  -- Solo las devueltas en efectivo salieron del cajon. Una devolucion por
  -- posnet le vuelve a la tarjeta del cliente: queda registrada, pero el
  -- arqueo no la tiene que esperar.
  select coalesce(sum(monto_reembolsado), 0) into v_devoluciones_efectivo
  from devoluciones
  where caja_id = p_caja_id and resolucion = 'dinero' and medio_reembolso = 'efectivo';

  select coalesce(sum(monto), 0) into v_entradas
  from movimientos_caja
  where caja_id = p_caja_id and tipo = 'entrada';

  select coalesce(sum(monto), 0) into v_salidas
  from movimientos_caja
  where caja_id = p_caja_id and tipo = 'salida';

  v_efectivo_sistema :=
    v_monto_apertura + v_efectivo_ventas - v_devoluciones_efectivo + v_entradas - v_salidas;

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
    empleado_cierre_id = p_empleado_id,
    cerrada_en = now()
  where id = p_caja_id
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;

comment on column cajas.efectivo_sistema is
  'Snapshot al cerrar: monto_apertura + ventas en efectivo (venta_pagos) - devoluciones devueltas EN EFECTIVO + entradas - salidas de caja. Las devoluciones por posnet/transferencia/QR no entran: no salen del cajon.';

-- =========================================================
-- 3. confirmar_devolucion(): recibe el medio
-- =========================================================

-- La firma cambia (un parametro nuevo), asi que se dropea la vieja en vez
-- de reemplazarla: un `create or replace` con un parametro extra crearia
-- una SEGUNDA funcion y las llamadas de 5 argumentos quedarian ambiguas.
drop function if exists confirmar_devolucion(uuid, jsonb, text, jsonb, text);

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

  -- El medio solo aplica a la devolucion de dinero. En un cambio por otro
  -- producto no hay plata que devolver, asi que se ignora lo que venga.
  if p_resolucion = 'dinero' then
    v_medio_reembolso := coalesce(p_medio_reembolso, 'efectivo');
    if v_medio_reembolso not in ('efectivo', 'debito', 'credito', 'transferencia', 'qr') then
      raise exception 'Medio de reembolso invalido: %', v_medio_reembolso;
    end if;
  else
    v_medio_reembolso := null;
  end if;

  -- Caja abierta para cualquier devolucion de dinero, tambien la de
  -- posnet: es una operacion del mostrador de hoy y caja_id es lo que la
  -- ata a un dia y a una sucursal. Lo que cambia es el arqueo, no el
  -- requisito (ver cerrar_caja mas arriba).
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

    -- Un producto particular no reingresa a stock: no existe en el
    -- catalogo, no hay cantidad que corregir. Se devuelve la plata (o se
    -- toma como valor para un cambio) y nada mas.
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
