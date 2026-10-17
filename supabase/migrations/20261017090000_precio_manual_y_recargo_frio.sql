-- Recargo por frio y precio editado a mano en el punto de venta.
--
-- Pedido del usuario 2026-10-17, dos cosas distintas que terminan siendo
-- el mismo mecanismo: poder decidir, sobre una linea del ticket, que esa
-- venta se cobra a otro precio.
--
--   1. RECARGO POR FRIO. Hay productos que se cobran mas caros frios (la
--      Coca de la heladera). Hoy el unico recargo por frio que existe esta
--      horneado en el precio de la lata individual (CLAUDE.md, "Precios"),
--      que no sirve cuando el que esta frio es cualquier otro producto.
--      Se carga en pesos POR UNIDAD sobre la linea elegida.
--
--   2. PRECIO EDITADO A MANO (el "lapiz"). Mientras dure la puesta en
--      marcha hay productos cargados mal o directamente sin precio, y el
--      mostrador no puede esperar a que alguien arregle el catalogo. El
--      lapiz arregla LA VENTA, no el catalogo: el SKU sigue con el precio
--      que tenia.
--
-- Decisiones del usuario 2026-10-17 (no volver a preguntarlas):
--
--   a. El precio editado REEMPLAZA al precio, no es un descuento. Viaja
--      como precio_unitario = precio_lista_unitario, asi que la venta se
--      puede cobrar con cualquier medio de pago y el precio puede subir o
--      bajar. Si fuera un descuento, confirmar_venta() la rechazaria por
--      partida doble: "el precio final no puede ser mayor al precio de
--      lista" y "las promociones y el descuento por efectivo solo aplican
--      pagando 100% en efectivo".
--
--   b. Lo pueden usar el dueno y el encargado de Olavarria, no Laprida
--      (ve_costos(), el mismo permiso que ya gobierna productos y precios
--      -- CLAUDE.md: Laprida tiene los precios de venta en solo lectura).
--      La validacion esta aca adentro, no solo en la UI: armando el
--      request a mano desde Laprida la base lo rechaza igual.
--
--   c. Ni el lapiz ni el recargo se permiten sobre una linea con
--      promocion. El precio de un combo lo reparte el sistema entre sus
--      productos (arquitectura.md 1.7, y el reparto no se muestra en
--      ninguna pantalla): tocar un componente lo desincroniza. Tampoco
--      sobre un producto particular, donde el precio ya se tipea a mano.
--
-- POR QUE COLUMNAS DE RASTRO Y NO UN PRECIO APARTE: el precio que se
-- guarda en precio_unitario ya viene con el recargo adentro. Las columnas
-- nuevas son el RASTRO de como se llego a ese numero, no una parte del
-- calculo.
-- Asi las devoluciones siguen reembolsando bien (leen precio_unitario), la
-- factura toma la base correcta sin tocar nada de ARCA, y el total de la
-- venta se calcula igual que siempre. Regla 5 de CLAUDE.md: trazabilidad
-- antes que velocidad.
--
-- Quien toco el precio no necesita columna propia: ventas.usuario_id y
-- ventas.fecha ya dicen quien cobro esa venta y cuando, y el precio solo
-- se puede tocar durante la venta.

begin;

-- =========================================================
-- venta_items
-- =========================================================

alter table venta_items add column recargo_frio numeric(12, 2) not null default 0;
alter table venta_items add column precio_editado boolean not null default false;
alter table venta_items add column precio_catalogo numeric(12, 2);

comment on column venta_items.recargo_frio is
  'Cuanto de precio_unitario es recargo por frio, por unidad. 0 = no hubo. El recargo YA esta sumado en precio_unitario.';

comment on column venta_items.precio_editado is
  'Alguien tipeo el precio de esta linea a mano en el POS, en vez de cobrar el del catalogo.';

-- Columna propia y no "precio_catalogo is not null" para saber si se toco:
-- el caso que motivo el lapiz es justamente el producto cargado SIN precio,
-- donde el precio del catalogo no existe y la columna queda en null igual
-- que si nadie hubiera tocado nada.
comment on column venta_items.precio_catalogo is
  'Que precio tenia el SKU antes de que lo editaran a mano. null = no tenia precio cargado. Solo se completa si precio_editado.';

alter table venta_items add constraint venta_items_recargo_frio_no_negativo
  check (recargo_frio >= 0);

alter table venta_items add constraint venta_items_precio_catalogo_no_negativo
  check (precio_catalogo is null or precio_catalogo >= 0);

-- El recargo esta contenido en el precio: nunca puede ser mas que el
-- precio que se cobro. Puede ser igual (producto sin precio cargado al que
-- solo se le puso el recargo).
alter table venta_items add constraint venta_items_recargo_frio_dentro_del_precio
  check (recargo_frio <= precio_unitario);

-- El precio del catalogo solo tiene sentido como "lo que valia antes de
-- que lo pisaran": sin edicion, no se guarda.
alter table venta_items add constraint venta_items_precio_catalogo_solo_si_editado
  check (precio_catalogo is null or precio_editado);

-- Un producto particular no lleva ninguna de las dos: no tiene catalogo
-- detras y su precio ya se tipea entero a mano.
alter table venta_items add constraint venta_items_ajuste_precio_solo_con_sku
  check ((recargo_frio = 0 and not precio_editado) or sku_id is not null);

-- Decision (c): una linea con promocion no se toca.
alter table venta_items add constraint venta_items_ajuste_precio_sin_promocion
  check ((recargo_frio = 0 and not precio_editado) or promocion_id is null);

-- Para la consulta "que precios se tocaron a mano", que es la razon de ser
-- de estas columnas.
create index venta_items_precio_tocado_idx on venta_items (venta_id)
  where recargo_frio > 0 or precio_editado;

-- =========================================================
-- confirmar_venta(): acepta recargo por frio y precio editado
-- =========================================================
-- Cuerpo igual al de 20261009090000_producto_particular.sql, con los dos
-- campos nuevos por linea y sus validaciones. Todo lo demas (stock,
-- envases, promociones, pagos, caja) queda exactamente igual.

create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_pagos jsonb,
  p_lineas jsonb,
  p_es_envio boolean default false,
  p_motomandado text default null,
  p_direccion_envio text default null
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

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El ticket no tiene productos';
  end if;

  if p_es_envio and (coalesce(trim(p_motomandado), '') = '' or coalesce(trim(p_direccion_envio), '') = '') then
    raise exception 'Un envio necesita motomandado y direccion';
  end if;

  v_cantidad_pagos := coalesce(jsonb_array_length(p_pagos), 0);
  if v_cantidad_pagos < 1 or v_cantidad_pagos > 3 then
    raise exception 'La venta tiene que tener entre 1 y 3 medios de pago';
  end if;

  for v_pago in select * from jsonb_to_recordset(p_pagos) as x(medio_pago text, monto numeric)
  loop
    if v_pago.medio_pago not in ('efectivo', 'debito', 'credito', 'transferencia', 'qr') then
      raise exception 'Medio de pago invalido: %', v_pago.medio_pago;
    end if;
    if v_pago.monto is null or v_pago.monto <= 0 then
      raise exception 'El monto de cada medio de pago tiene que ser mayor a cero';
    end if;
    v_suma_pagos := v_suma_pagos + v_pago.monto;
  end loop;

  v_es_efectivo_puro := v_cantidad_pagos = 1 and (p_pagos->0->>'medio_pago') = 'efectivo';
  v_medio_pago_venta := case when v_cantidad_pagos = 1 then p_pagos->0->>'medio_pago' else 'mixto' end;

  -- Una sola vez para toda la venta: el permiso no cambia entre lineas.
  v_puede_tocar_precios := ve_costos();

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  select id, estado into v_caja_id, v_caja_estado
  from cajas
  where sucursal_id = p_sucursal_id and fecha = current_date;

  if v_caja_id is null then
    raise exception 'Todavia no se abrio la caja de hoy en esta sucursal';
  end if;

  if v_caja_estado <> 'abierta' then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  insert into ventas (
    sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id,
    es_envio, motomandado, direccion_envio
  )
  values (
    p_sucursal_id, auth.uid(), v_medio_pago_venta, 0, 0, v_caja_id,
    p_es_envio, nullif(trim(p_motomandado), ''), nullif(trim(p_direccion_envio), '')
  )
  returning * into v_venta;

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

    -- ---------------------------------------------------------------
    -- Recargo por frio / precio editado a mano (usuario 2026-10-17)
    -- ---------------------------------------------------------------
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
      -- El precio editado REEMPLAZA al precio, no es un descuento: si
      -- llegaran distintos, la venta terminaria cobrandose a uno y
      -- figurando con descuento en el otro. Esto aplica solo al lapiz: un
      -- recargo por frio sobre un precio sin tocar se suma arriba del
      -- precio de lista y del de efectivo por igual, asi que esa linea
      -- puede seguir teniendo su descuento por efectivo como cualquier
      -- otra.
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

    -- ---------------------------------------------------------------
    -- Producto particular: no hay catalogo detras, asi que no hay stock
    -- que consultar ni movimiento que registrar. El precio que se tipeo
    -- es el precio final: sin promocion y sin descuento por efectivo.
    -- ---------------------------------------------------------------
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

commit;

-- =========================================================
-- Permisos
-- =========================================================
-- Nada que agregar: no hay tablas nuevas, solo columnas en una tabla
-- que escribe unicamente confirmar_venta() (SECURITY DEFINER), que por eso
-- no lleva grant de insert -- ver NOTAS DEL ENTORNO en CLAUDE.md.
