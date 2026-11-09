-- Despacho directo de Olavarría a Laprida (pedido del usuario 2026-11-09).
--
-- Hasta hoy toda transferencia nacía de un pedido que armaba Laprida
-- (borrador -> enviado -> en_preparacion -> preparado -> despachado). Ahora
-- Olavarría también puede armar el envío mirando lo que Laprida vendió en
-- un rango de fechas, y mandarlo directo, sin esos pasos intermedios.
-- Decisión de negocio confirmada por el usuario el 2026-11-09:
--
--   1. Se saltea "Laprida pide, Olavarría despacha": Olavarría arma y manda.
--   2. Los dos caminos conviven: el pedido de Laprida sigue funcionando
--      igual. El despacho directo queda marcado en pedidos.iniciado_por_origen.
--
-- Cómo se hace sin tocar el circuito: despachar_directo() crea un pedido ya
-- en estado 'despachado' (con cantidad solicitada = preparada = despachada)
-- y llama a despachar_pedido() tal cual existe. Así el stock sigue
-- cambiando únicamente por registrar_movimiento() (regla inviolable 1), el
-- stock queda "en tránsito" hasta que Laprida confirma la recepción con
-- confirmar_recepcion_transferencia() -- que acredita su stock y exige
-- motivo si llegó menos --, y el pedido se cierra solo al recibir.
--
-- Todo ocurre en UNA transacción: si falta stock en Olavarría para
-- cualquier línea, no queda ni el pedido, ni la transferencia, ni el
-- movimiento.

-- =========================================================
-- pedidos.iniciado_por_origen
-- =========================================================

alter table pedidos
  add column iniciado_por_origen boolean not null default false;

comment on column pedidos.iniciado_por_origen is
  'true cuando el envío lo armó y despachó Olavarría directo (despachar_directo()), sin que Laprida lo pidiera.';

-- =========================================================
-- pedido_items: permitir el INSERT de las líneas SOLO dentro de
-- despachar_directo()
-- =========================================================
-- Mismo cuerpo que la versión original (20260821090000). Única diferencia:
-- el bloque marcado abajo. Un pedido que ya salió de borrador no admite
-- líneas nuevas; despachar_directo() inserta el pedido directamente
-- despachado, así que necesita una excepción acotada, con su propia marca de
-- sesión (bebidas_moe.despacho_directo) que solo esa función prende y apaga.

create or replace function validar_edicion_pedido_items()
returns trigger
language plpgsql
as $$
declare
  v_estado text;
begin
  select estado into v_estado from pedidos where id = coalesce(new.pedido_id, old.pedido_id);

  -- DELETE en cascada desde un pedido borrador recien borrado: Postgres ya
  -- elimino la fila padre antes de disparar el ON DELETE CASCADE, asi que
  -- esta consulta da NULL. pedidos_delete ya garantizo que ese pedido
  -- estaba en borrador (unica transicion que permite borrarlo), asi que se
  -- deja pasar.
  if tg_op = 'DELETE' and v_estado is null then
    return old;
  end if;

  if v_estado = 'borrador' then
    if tg_op <> 'DELETE' and (new.cantidad_preparada is not null or new.cantidad_pendiente is not null) then
      raise exception 'Un pedido en borrador todavia no tiene cantidad preparada ni pendiente';
    end if;
    return coalesce(new, old);
  end if;

  -- Despacho directo (2026-11-09): solo el INSERT, solo dentro de
  -- despachar_directo().
  if tg_op = 'INSERT'
    and coalesce(current_setting('bebidas_moe.despacho_directo', true), 'off') = 'on'
  then
    return new;
  end if;

  -- fuera de borrador: solo las funciones del sistema tocan estas filas.
  if coalesce(current_setting('bebidas_moe.pedido_en_curso', true), 'off') <> 'on' then
    raise exception 'Los items de un pedido ya enviado solo los actualiza el sistema (preparacion/cierre)';
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'No se pueden agregar ni quitar lineas de un pedido que ya fue enviado';
  end if;

  if new.pedido_id is distinct from old.pedido_id
    or new.sku_id is distinct from old.sku_id
    or new.cantidad_solicitada is distinct from old.cantidad_solicitada
    or new.cantidad_sugerida_sistema is distinct from old.cantidad_sugerida_sistema
    or new.observacion_encargado is distinct from old.observacion_encargado
  then
    raise exception 'Lo solicitado por Laprida no se edita despues de enviar el pedido';
  end if;

  return new;
end;
$$;

-- =========================================================
-- despachar_directo()
-- =========================================================
-- p_lineas: [{ "sku_id": uuid, "cantidad": int, "cantidad_sugerida_sistema": int|null }]
-- Devuelve la transferencia creada (en_transito).

create or replace function despachar_directo(
  p_lineas jsonb,
  p_observaciones text default null
)
returns transferencias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_central_id uuid;
  v_destino_id uuid;
  v_pedido_id uuid;
  v_linea record;
  v_item_id uuid;
  v_lineas_despacho jsonb := '[]'::jsonb;
  v_transferencia transferencias;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select id into strict v_central_id from sucursales where es_central = true;
  select id into strict v_destino_id from sucursales where es_central = false;

  -- Despacha Olavarría: mismo chequeo que despachar_pedido().
  if not opera_sucursal(v_central_id) then
    raise exception 'No tenes permiso para despachar desde esta sucursal';
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'No hay lineas para despachar';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lineas) as x(sku_id uuid, cantidad integer, cantidad_sugerida_sistema integer)
    group by x.sku_id
    having count(*) > 1
  ) then
    raise exception 'Hay un producto repetido en el envio';
  end if;

  insert into pedidos (
    sucursal_origen_id, sucursal_destino_id, estado, fecha_envio,
    usuario_creador_id, usuario_preparador_id, iniciado_por_origen
  ) values (
    v_central_id, v_destino_id, 'despachado', now(),
    auth.uid(), auth.uid(), true
  )
  returning id into v_pedido_id;

  perform set_config('bebidas_moe.despacho_directo', 'on', true);

  for v_linea in
    select * from jsonb_to_recordset(p_lineas)
    as x(sku_id uuid, cantidad integer, cantidad_sugerida_sistema integer)
  loop
    if v_linea.sku_id is null then
      raise exception 'Falta el producto en alguna linea del envio';
    end if;

    if v_linea.cantidad is null or v_linea.cantidad <= 0 then
      raise exception 'La cantidad a despachar tiene que ser mayor a cero';
    end if;

    insert into pedido_items (
      pedido_id, sku_id, cantidad_solicitada, cantidad_sugerida_sistema,
      cantidad_preparada, cantidad_pendiente
    ) values (
      v_pedido_id, v_linea.sku_id, v_linea.cantidad, v_linea.cantidad_sugerida_sistema,
      v_linea.cantidad, 0
    )
    returning id into v_item_id;

    v_lineas_despacho := v_lineas_despacho
      || jsonb_build_object('pedido_item_id', v_item_id, 'cantidad', v_linea.cantidad);
  end loop;

  perform set_config('bebidas_moe.despacho_directo', 'off', true);

  -- Descuenta Olavarría (registrar_movimiento + validación de stock en
  -- origen) y deja la mercadería en stock_transito.
  select * into v_transferencia
  from despachar_pedido(v_pedido_id, v_lineas_despacho, p_observaciones);

  return v_transferencia;
end;
$$;
