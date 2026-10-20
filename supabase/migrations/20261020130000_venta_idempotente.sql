-- Un cobro, una venta: clave de idempotencia en confirmar_venta().
--
-- Pedido del usuario 2026-10-20: "esta sucediendo que registra una misma
-- venta 2 veces y ademas una tira error. no puede cobrarse una misma venta
-- en el mismo momento exacto".
--
-- Lo que pasaba. La venta se grababa dos veces por dos caminos que se
-- suman, y los dos terminaban en la caja contando el doble:
--
--   1. El POS no tenia candado en los atajos de teclado. El boton "Cobrar"
--      si (disabled mientras guarda), pero el Enter del modal de pago y el
--      F12 llamaban a confirmar() sin mirar si ya habia una venta en
--      vuelo. El modal de "Como paga?" recien se cierra cuando TERMINA
--      todo, asi que durante toda la espera un segundo Enter -- el de la
--      pistola lectora, el dedo apoyado, los nervios del mostrador --
--      disparaba otra venta identica.
--
--   2. Cobrando con debito/credito/transferencia/QR, confirmarVenta()
--      espera el CAE antes de contestarle al POS (facturacion automatica,
--      2026-10-19): WSAA 15s + WSFEv1 15s de tope. Si la plataforma corta
--      la request antes, la venta YA ESTA GRABADA (confirmar_venta()
--      commitea antes de hablar con ARCA, y eso esta bien) pero el
--      navegador muestra un error. La cajera cobra de nuevo y queda la
--      segunda venta. Ese es el "una tira error" del pedido.
--
-- Por que la solucion va en la base y no solo en el POS. El candado del
-- navegador no cubre el caso 2: si la respuesta se pierde en el camino, el
-- reintento es una request nueva y legitima, y desde el servidor no habia
-- forma de distinguirla de una segunda venta de verdad. La unica forma de
-- que "el mismo cobro" sea reconocible es que el cobro traiga su propia
-- identidad: el POS genera una clave por cobro (una sola, aunque reintente)
-- y la base garantiza que una clave no puede tener dos ventas.
--
-- Efecto: un reintento del mismo cobro devuelve la venta que ya existe,
-- con su id y su total, sin grabar nada nuevo -- ni venta, ni items, ni
-- movimientos de stock, ni pagos. El POS imprime el mismo ticket y la caja
-- cuenta una sola vez. Dos ventas iguales a proposito (dos clientes que
-- compran lo mismo) siguen siendo dos ventas: cada cobro tiene su clave.
--
-- La columna es nullable y el parametro tiene default null a proposito: las
-- ventas ya cargadas no tienen clave, y el unique index es parcial para que
-- todas esas convivan. De aca en mas el POS siempre la manda.
--
-- Nada que correr despues: no hay tabla nueva, asi que no hacen falta
-- grants (CLAUDE.md, notas del entorno).

begin;

-- Nullable: las ventas anteriores a hoy no tienen clave y no se inventa una.
alter table ventas add column if not exists idempotency_key uuid;

-- Parcial: un unique normal dejaria entrar una sola fila con null, y todas
-- las ventas viejas tienen null. Asi el unique aplica solo a las ventas que
-- SI traen clave, que son las que hay que cuidar.
create unique index if not exists ventas_idempotency_key_idx
  on ventas (idempotency_key)
  where idempotency_key is not null;

comment on column ventas.idempotency_key is
  'Clave del cobro que genero esta venta, una por intento de cobro en el POS. Un reintento con la misma clave devuelve esta venta en vez de grabar otra. Null en las ventas anteriores al 2026-10-20.';

-- La firma cambia (un parametro mas), asi que la version anterior se
-- dropea: con las dos vivas, PostgREST no puede resolver a cual llamar
-- (mismo problema que registrar_merma en 20261002090000_empleados_merma.sql).
drop function if exists confirmar_venta(uuid, jsonb, jsonb, boolean, text, text, boolean);

-- confirmar_venta(): mismo cuerpo que 20261019100000_fecha_operativa.sql, con
-- la clave de idempotencia. Lo demas no se toca.

create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_pagos jsonb,
  p_lineas jsonb,
  p_es_envio boolean default false,
  p_motomandado text default null,
  p_direccion_envio text default null,
  p_envio_pagado boolean default null,
  -- La clave del cobro. La genera el POS, una por cobro, y la repite si
  -- tiene que reintentar.
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

  -- ---------------------------------------------------------------
  -- Un cobro, una venta (2026-10-20)
  -- ---------------------------------------------------------------
  -- Si esta clave ya tiene venta, se devuelve ESA y no se graba nada:
  -- ni venta, ni items, ni movimientos de stock, ni pagos. Es el mismo
  -- cobro reintentado, no una venta nueva.
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

  -- Si ya esta pago o no es un dato obligatorio del envio, igual que el
  -- motomandado y la direccion: el que reparte tiene que saber si va a
  -- cobrar o no. Se valida aca tambien y no solo en el POS -- si alguna
  -- vez llega un request armado a mano sin el dato, es mejor que la venta
  -- se rechace que registrar un envio como pago sin que nadie lo dijera.
  if p_es_envio and p_envio_pagado is null then
    raise exception 'Un envio necesita saber si el pedido ya esta pago';
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
  where sucursal_id = p_sucursal_id and fecha = fecha_operativa();

  if v_caja_id is null then
    raise exception 'Todavia no se abrio la caja de hoy en esta sucursal';
  end if;

  if v_caja_estado <> 'abierta' then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  -- El unique index de idempotency_key es el que de verdad frena el
  -- duplicado: dos cobros simultaneos con la misma clave (el segundo
  -- Enter del mostrador) pasan los dos por el select de arriba sin
  -- encontrar nada, pero insertar solo puede uno. El que pierde no graba
  -- nada y devuelve la venta del que gano.
  begin
    insert into ventas (
      sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id,
      es_envio, motomandado, direccion_envio, envio_pagado, idempotency_key
    )
    values (
      p_sucursal_id, auth.uid(), v_medio_pago_venta, 0, 0, v_caja_id,
      p_es_envio, nullif(trim(p_motomandado), ''), nullif(trim(p_direccion_envio), ''),
      -- En una venta de mostrador la columna queda en null: la pregunta no
      -- existe fuera de los envios.
      case when p_es_envio then p_envio_pagado else null end,
      p_idempotency_key
    )
    returning * into v_venta;
  exception when unique_violation then
    select * into v_venta from ventas where idempotency_key = p_idempotency_key;
    -- Si el choque no fue por la clave es otra cosa, y tiene que verse.
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
