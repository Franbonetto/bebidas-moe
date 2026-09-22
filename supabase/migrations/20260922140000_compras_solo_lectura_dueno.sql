-- El dueño solo visualiza compras y recepciones -- las carga la encargada
-- de Olavarría, el dueño no recepciona mercadería (pedido del usuario
-- 2026-09-22: "el dueño no pueda recepcionar mercadería, solo visualiza
-- lo que la encargada carga"). Mismo criterio que la migración anterior
-- para pedidos_compra (20260922130000).
--
-- Estas dos funciones son SECURITY DEFINER: corren como dueñas de la
-- tabla y no pasan por RLS, así que el chequeo de permiso tiene que vivir
-- adentro de la función -- restringir solo RLS no alcanza, el dueño podría
-- seguir llamando al RPC directo.

begin;

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

  if not ve_costos() or es_dueno() then
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

  if not ve_costos() or es_dueno() then
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

-- =========================================================
-- RLS: insert/update/delete de compras/compra_items/recepciones también
-- pasan a excluir al dueño (defensa en profundidad -- en la práctica hoy
-- solo se escribe vía las dos funciones de arriba, pero las tablas
-- también tenían grant directo desde el bloque 4).
-- =========================================================

drop policy if exists compras_insert on compras;
drop policy if exists compras_update on compras;
drop policy if exists compras_delete on compras;

create policy compras_insert on compras for insert
  with check (ve_costos() and not es_dueno() and estado = 'borrador' and usuario_id = auth.uid());
create policy compras_update on compras for update
  using (ve_costos() and not es_dueno()) with check (ve_costos() and not es_dueno());
create policy compras_delete on compras for delete
  using (ve_costos() and not es_dueno() and estado = 'borrador');

drop policy if exists compra_items_insert on compra_items;
drop policy if exists compra_items_update on compra_items;
drop policy if exists compra_items_delete on compra_items;

create policy compra_items_insert on compra_items for insert with check (ve_costos() and not es_dueno());
create policy compra_items_update on compra_items for update using (ve_costos() and not es_dueno()) with check (ve_costos() and not es_dueno());
create policy compra_items_delete on compra_items for delete using (ve_costos() and not es_dueno());

drop policy if exists recepciones_compra_insert on recepciones_compra;
drop policy if exists recepciones_compra_delete on recepciones_compra;

create policy recepciones_compra_insert on recepciones_compra for insert
  with check (ve_costos() and not es_dueno() and estado = 'pendiente' and usuario_id = auth.uid());
create policy recepciones_compra_delete on recepciones_compra for delete
  using (ve_costos() and not es_dueno() and estado = 'pendiente');

drop policy if exists recepcion_items_insert on recepcion_items;
drop policy if exists recepcion_items_update on recepcion_items;
drop policy if exists recepcion_items_delete on recepcion_items;

create policy recepcion_items_insert on recepcion_items for insert with check (ve_costos() and not es_dueno());
create policy recepcion_items_update on recepcion_items for update using (ve_costos() and not es_dueno()) with check (ve_costos() and not es_dueno());
create policy recepcion_items_delete on recepcion_items for delete using (ve_costos() and not es_dueno());

commit;
