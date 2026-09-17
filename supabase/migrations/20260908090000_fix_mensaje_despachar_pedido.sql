-- Fix: despachar_pedido() mostraba el sku_id crudo (uuid) en sus mensajes
-- de error en vez del nombre del producto, ilegible para el encargado que
-- está despachando ("No se puede despachar 1 del sku 017b0fd6-...").
-- Mismo cuerpo que la versión original (20260821090000), solo se agrega
-- la resolución del nombre del producto para los dos raise exception que
-- mencionan la línea.

create or replace function despachar_pedido(
  p_pedido_id uuid,
  p_lineas jsonb,
  p_observaciones text default null
)
returns transferencias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_origen_id uuid;
  v_destino_id uuid;
  v_transferencia transferencias;
  v_linea record;
  v_pedido_item record;
  v_ya_despachado integer;
  v_disponible integer;
  v_stock_origen integer;
  v_nombre_producto text;
  v_alguna_linea boolean := false;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select estado, sucursal_origen_id, sucursal_destino_id
  into v_estado, v_origen_id, v_destino_id
  from pedidos where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido no existe';
  end if;

  if not opera_sucursal(v_origen_id) then
    raise exception 'No tenes permiso para despachar pedidos de esta sucursal';
  end if;

  if v_estado not in ('preparado', 'despachado') then
    raise exception 'Solo se puede despachar un pedido preparado (o con despachos parciales en curso)';
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'on', true);
  perform set_config('bebidas_moe.transferencia_en_curso', 'on', true);

  insert into transferencias (
    pedido_id, sucursal_origen_id, sucursal_destino_id, usuario_despacho_id, observaciones
  ) values (
    p_pedido_id, v_origen_id, v_destino_id, auth.uid(), p_observaciones
  )
  returning * into v_transferencia;

  for v_linea in
    select * from jsonb_to_recordset(p_lineas) as x(pedido_item_id uuid, cantidad integer)
  loop
    if v_linea.cantidad is null or v_linea.cantidad <= 0 then
      raise exception 'La cantidad a despachar tiene que ser mayor a cero';
    end if;

    select id, sku_id, cantidad_preparada into v_pedido_item
    from pedido_items
    where id = v_linea.pedido_item_id and pedido_id = p_pedido_id;

    if not found then
      raise exception 'El item % no pertenece a este pedido', v_linea.pedido_item_id;
    end if;

    select p.nombre into v_nombre_producto
    from skus s
    join productos p on p.id = s.producto_id
    where s.id = v_pedido_item.sku_id;

    select coalesce(sum(ti.cantidad_despachada), 0) into v_ya_despachado
    from transferencia_items ti
    where ti.pedido_item_id = v_pedido_item.id;

    v_disponible := coalesce(v_pedido_item.cantidad_preparada, 0) - v_ya_despachado;

    if v_linea.cantidad > v_disponible then
      raise exception
        'No se puede despachar % de %: solo quedan % unidades preparadas sin despachar',
        v_linea.cantidad, v_nombre_producto, v_disponible;
    end if;

    -- No se puede despachar mas mercaderia de la que hay fisicamente en
    -- origen: distinto del POS, donde vender sin stock se permite a
    -- proposito. Una transferencia interna no tiene razon de mandar algo
    -- que no existe. Lockea la fila para que dos lineas del mismo sku (o
    -- despachos concurrentes) no lean el mismo stock viejo.
    select ss.cantidad into v_stock_origen
    from stock_sucursal ss
    where ss.sku_id = v_pedido_item.sku_id and ss.sucursal_id = v_origen_id
    for update;

    v_stock_origen := coalesce(v_stock_origen, 0);

    if v_linea.cantidad > v_stock_origen then
      raise exception
        'No se puede despachar % de %: el stock disponible en origen es % unidades',
        v_linea.cantidad, v_nombre_producto, v_stock_origen;
    end if;

    insert into transferencia_items (transferencia_id, pedido_item_id, sku_id, cantidad_despachada)
    values (v_transferencia.id, v_pedido_item.id, v_pedido_item.sku_id, v_linea.cantidad);

    perform registrar_movimiento(
      p_sku_id => v_pedido_item.sku_id,
      p_sucursal_id => v_origen_id,
      p_tipo => 'transferencia_salida',
      p_cantidad => v_linea.cantidad,
      p_documento_tipo => 'transferencia',
      p_documento_id => v_transferencia.id
    );

    insert into stock_transito (sku_id, transferencia_id, cantidad)
    values (v_pedido_item.sku_id, v_transferencia.id, v_linea.cantidad);

    v_alguna_linea := true;
  end loop;

  if not v_alguna_linea then
    raise exception 'No hay lineas para despachar';
  end if;

  if v_estado = 'preparado' then
    update pedidos set estado = 'despachado' where id = p_pedido_id;
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'off', true);
  perform set_config('bebidas_moe.transferencia_en_curso', 'off', true);

  return v_transferencia;
end;
$$;
