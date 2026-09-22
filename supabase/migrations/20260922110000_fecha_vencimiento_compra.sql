-- Fecha de vencimiento por línea de compra (opcional -- pedido del usuario
-- 2026-09-22: "eso debe ser opcional en caso de que el producto lo
-- requiera, ejemplo vinos no tiene fecha de vencimiento pero sí gaseosa").
--
-- Vive en compra_items (se carga en el momento, en "Cargar mercadería") y
-- se copia a historial_costos al confirmar la recepción, porque el
-- vencimiento es un dato de lote -- historial_costos ya es "una fila por
-- lote recibido, nunca se sobrescribe" (CLAUDE.md regla 5, ver comentario
-- en 20260820150000_bloque4_compras.sql). El stock en sí sigue sin
-- rastrear de qué lote sale cada unidad (arquitectura.md), esto es
-- solamente historial para poder consultar próximos vencimientos por lote.

begin;

alter table compra_items add column fecha_vencimiento date;
alter table historial_costos add column fecha_vencimiento date;

-- =========================================================
-- confirmar_recepcion(): copiar fecha_vencimiento del compra_item al lote
-- =========================================================

create or replace function confirmar_recepcion(p_recepcion_id uuid)
returns setof movimientos_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra_id uuid;
  v_proveedor_id uuid;
  v_sucursal_id uuid;
  v_item record;
  v_recibido_previo integer;
  v_pendiente_antes integer;
  v_diferencia integer;
  v_mov movimientos_stock;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para confirmar recepciones de compra';
  end if;

  select c.id, c.proveedor_id, c.sucursal_destino_id
  into v_compra_id, v_proveedor_id, v_sucursal_id
  from recepciones_compra r
  join compras c on c.id = r.compra_id
  where r.id = p_recepcion_id and r.estado = 'pendiente'
  for update of r;

  if not found then
    raise exception 'La recepcion no existe o ya fue confirmada';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para recibir mercaderia en esta sucursal';
  end if;

  perform set_config('bebidas_moe.recepcion_en_curso', 'on', true);

  for v_item in
    select ri.id, ri.compra_item_id, ri.sku_id, ri.cantidad_recibida, ri.motivo_diferencia,
           ci.cantidad as cantidad_pedida, ci.costo_unitario, ci.fecha_vencimiento
    from recepcion_items ri
    join compra_items ci on ci.id = ri.compra_item_id
    where ri.recepcion_id = p_recepcion_id
  loop
    select coalesce(sum(ri2.cantidad_recibida), 0) into v_recibido_previo
    from recepcion_items ri2
    join recepciones_compra r2 on r2.id = ri2.recepcion_id
    where ri2.compra_item_id = v_item.compra_item_id and r2.estado = 'recibida';

    v_pendiente_antes := v_item.cantidad_pedida - v_recibido_previo;
    v_diferencia := v_item.cantidad_recibida - v_pendiente_antes;

    if v_diferencia <> 0 and v_item.motivo_diferencia is null then
      raise exception
        'Falta motivo_diferencia en el sku % (se esperaban %, llegaron %)',
        v_item.sku_id, v_pendiente_antes, v_item.cantidad_recibida;
    end if;

    update recepcion_items set diferencia = v_diferencia where id = v_item.id;

    if v_item.cantidad_recibida > 0 then
      v_mov := registrar_movimiento(
        p_sku_id => v_item.sku_id,
        p_sucursal_id => v_sucursal_id,
        p_tipo => 'compra',
        p_cantidad => v_item.cantidad_recibida,
        p_motivo => v_item.motivo_diferencia,
        p_documento_tipo => 'recepcion_compra',
        p_documento_id => p_recepcion_id
      );
      return next v_mov;

      insert into historial_costos (sku_id, proveedor_id, recepcion_id, costo_unitario, cantidad, fecha, fecha_vencimiento)
      values (v_item.sku_id, v_proveedor_id, p_recepcion_id, v_item.costo_unitario, v_item.cantidad_recibida, now(), v_item.fecha_vencimiento);

      update skus set costo_actual = v_item.costo_unitario where id = v_item.sku_id;
    end if;
  end loop;

  update recepciones_compra set estado = 'recibida' where id = p_recepcion_id;

  -- cierre automatico: solo si ninguna linea de la compra tiene pendiente > 0.
  if not exists (
    select 1
    from compra_items ci
    where ci.compra_id = v_compra_id
      and ci.cantidad > coalesce((
        select sum(ri.cantidad_recibida)
        from recepcion_items ri
        join recepciones_compra r on r.id = ri.recepcion_id
        where ri.compra_item_id = ci.id and r.estado = 'recibida'
      ), 0)
  ) then
    update compras set estado = 'cerrada' where id = v_compra_id and estado = 'confirmada';
  end if;

  perform set_config('bebidas_moe.recepcion_en_curso', 'off', true);
end;
$$;

-- =========================================================
-- cargar_compra_directa(): aceptar fecha_vencimiento opcional por línea
-- =========================================================

create or replace function cargar_compra_directa(
  p_proveedor_id uuid,
  p_numero_factura text,
  p_fecha_factura date,
  p_lineas jsonb -- [{sku_id, cantidad, costo_unitario, fecha_vencimiento}, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_compra_id uuid;
  v_recepcion_id uuid;
  v_linea jsonb;
  v_cantidad integer;
  v_costo_unitario numeric(12, 2);
  v_fecha_vencimiento date;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para cargar compras';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La compra necesita al menos un producto';
  end if;

  select id into v_sucursal_id from sucursales where es_central = true;
  if v_sucursal_id is null then
    raise exception 'No se encontro la sucursal central';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para recibir mercaderia en esta sucursal';
  end if;

  insert into compras (proveedor_id, sucursal_destino_id, numero_factura, fecha_factura, usuario_id)
  values (p_proveedor_id, v_sucursal_id, p_numero_factura, p_fecha_factura, auth.uid())
  returning id into v_compra_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_cantidad := (v_linea ->> 'cantidad')::integer;
    v_costo_unitario := (v_linea ->> 'costo_unitario')::numeric;
    v_fecha_vencimiento := nullif(v_linea ->> 'fecha_vencimiento', '')::date;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad tiene que ser un entero mayor a cero';
    end if;
    if v_costo_unitario is null or v_costo_unitario < 0 then
      raise exception 'El costo unitario no puede ser negativo';
    end if;

    insert into compra_items (compra_id, sku_id, cantidad, costo_unitario, fecha_vencimiento)
    values (v_compra_id, (v_linea ->> 'sku_id')::uuid, v_cantidad, v_costo_unitario, v_fecha_vencimiento);
  end loop;

  update compras set estado = 'confirmada' where id = v_compra_id;

  insert into recepciones_compra (compra_id, usuario_id)
  values (v_compra_id, auth.uid())
  returning id into v_recepcion_id;

  insert into recepcion_items (recepcion_id, compra_item_id, sku_id, cantidad_recibida)
  select v_recepcion_id, ci.id, ci.sku_id, ci.cantidad
  from compra_items ci
  where ci.compra_id = v_compra_id;

  perform confirmar_recepcion(v_recepcion_id);

  return v_compra_id;
end;
$$;

commit;
