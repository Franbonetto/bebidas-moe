-- Atajo de un solo paso para el caso normal de compras: llega toda la
-- mercadería junta y se carga y confirma en el momento (arquitectura.md 1.6,
-- pedido explícito del usuario 2026-09-20: "que no se tengan que mover entre
-- dos paneles la encargada... cargue cuánto entró el SKU y el precio").
--
-- No reemplaza el flujo de 20260820150000_bloque4_compras.sql: ese sigue
-- existiendo tal cual para el caso de entregas parciales en varias tandas
-- (el proveedor manda la mitad hoy y el resto después), donde sí hace falta
-- crear la compra, confirmarla, y recibir en más de una recepción con
-- diferencias y motivo.
--
-- cargar_compra_directa() no inventa lógica de movimiento de stock nueva:
-- encadena, dentro de una sola transacción, los mismos pasos que hoy hace la
-- encargada a mano (crear compra -> confirmarla -> crear una recepción que
-- cubre el 100% de lo cargado -> confirmarla), reutilizando
-- confirmar_recepcion() para la parte que efectivamente mueve stock,
-- registra el lote en historial_costos y actualiza costo_actual. Como la
-- recepción que arma cubre exactamente lo cargado, diferencia siempre da 0 y
-- confirmar_recepcion() no exige motivo.

begin;

create or replace function cargar_compra_directa(
  p_proveedor_id uuid,
  p_numero_factura text,
  p_fecha_factura date,
  p_lineas jsonb -- [{sku_id, cantidad, costo_unitario}, ...]
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

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad tiene que ser un entero mayor a cero';
    end if;
    if v_costo_unitario is null or v_costo_unitario < 0 then
      raise exception 'El costo unitario no puede ser negativo';
    end if;

    insert into compra_items (compra_id, sku_id, cantidad, costo_unitario)
    values (v_compra_id, (v_linea ->> 'sku_id')::uuid, v_cantidad, v_costo_unitario);
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
