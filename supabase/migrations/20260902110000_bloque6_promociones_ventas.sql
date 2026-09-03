-- Bloque 6: motor de promociones (combo + cantidad) + POS (ventas, caja diaria).
-- Ver docs/arquitectura.md, secciones 1.7 (precios y promociones -- ya
-- corregida: medio de pago AL FINAL), 1.8 (ventas y POS), 2.7 (precios y
-- promociones), 2.8 (ventas) y 3.4 (casos complejos postergados).
--
-- Decisiones de implementacion (no de negocio -- documentadas, no
-- improvisadas, mismo criterio que los bloques anteriores):
--
--   1. promociones.tipo queda en {combo, cantidad} unicamente. El boceto
--      original de 2.7 tenia tambien 'promocional' y 'efectivo': el
--      descuento por efectivo ya tiene tabla propia desde el bloque 5
--      (descuentos_efectivo) y 'promocional' generico no es uno de los dos
--      casos reales que el cliente pidio (arquitectura.md 3.4).
--
--   2. promocion_items.precio_promocional es el precio del GRUPO de
--      cantidad_requerida unidades de ese SKU, no el precio unitario.
--      Sirve igual para combo ("Branca dentro del combo: $17.900" con
--      cantidad_requerida=1) y para cantidad ("Heraclito 2x$20.000" con
--      cantidad_requerida=2), sin necesitar dos columnas distintas.
--
--   3. La resolucion de que gana en un ticket (combo > cantidad > efectivo
--      > base) vive en la app (lib/promociones.ts), no en SQL -- mismo
--      criterio que el bloque 5 con calcularPrecioVenta(): el precio se
--      resuelve al vuelo, nunca se recalcula en la base. confirmar_venta()
--      NO re-deriva la cascada de precios: confia en el precio que manda
--      la app, igual que compra_items.costo_unitario no se re-valida
--      contra proveedor_skus.costo_referencia (bloque 4). El control es
--      detectivo (caja: diferencia sistema/efectivo real, + auditoria),
--      no preventivo -- mismo espiritu que precios y ajustes de inventario
--      (arquitectura.md 1.11). Si mas adelante hace falta blindar esto,
--      portar todo lib/precios.ts + el motor de promociones a plpgsql es
--      una decision consciente a tomar aparte, no algo que se dejo pasar
--      por descuido. Lo unico que SI se valida acá es la regla inviolable
--      "las promociones son solo en efectivo" (mas abajo).
--
--   4. p_lineas de confirmar_venta() viene a nivel de TRAMO, no de SKU: un
--      mismo SKU puede llegar partido en mas de un renglon si el motor de
--      promociones le aplico distinto precio a distintas unidades (ej. 3
--      Heraclito -> 2 unidades a precio 2x + 1 a precio base). Cada tramo
--      genera su propio registrar_movimiento(); llamarla mas de una vez
--      para el mismo SKU en la misma transaccion es seguro (encadena
--      stock_anterior/stock_posterior correctamente).
--
--   5. ventas/venta_items/cajas son de escritura exclusiva por funcion
--      (confirmar_venta() / cerrar_caja()): sin grant de insert/update/
--      delete a authenticated, y trigger que rechaza cualquier escritura
--      fuera de esas funciones -- mismo mecanismo que stock_sucursal
--      (bloque 3) y transferencias (bloque 7), para que ni service_role ni
--      un superusuario puedan saltearse el registro de movimientos.
--
--   6. La caja se abre sola con la primera venta del dia por sucursal (on
--      conflict do nothing, mismo patron que stock_sucursal) -- no hay
--      boton de "abrir caja", igual que no hay aprobacion previa para
--      precios ni ajustes de inventario (arquitectura.md 1.11).
--
--   7. Los combos NO tienen stock propio (arquitectura.md 1.3): no existe
--      SKU para el combo. confirmar_venta() solo llama a
--      registrar_movimiento() por los SKU reales (los componentes).
--
--   8. venta_items.con_envase dispara registrar_movimiento_envase()
--      ('ingreso_cliente', bloque 9), que ya estaba lista para esto,
--      incluido el parametro p_venta_id que quedaba pendiente.
--
--   9. vendido_sin_stock lo calcula el servidor (compara contra
--      stock_sucursal.cantidad en el momento de la venta), no lo manda la
--      app: es la unica forma de que la cola de revision de inventario sea
--      confiable.
--
--  10. No se seedea ninguna promocion real: los SKU de los ejemplos del
--      cliente (Coca-Cola 2,25 L, Heraclito) todavia no estan en el
--      catalogo. Se cargan desde la pantalla una vez que el bloque este
--      arriba.
--
--  11. anular_venta()/devoluciones quedan fuera de este bloque (1.10 es un
--      circuito propio, no pedido en este bloque). El estado 'anulada' de
--      ventas queda en el modelo para no romper 2.8, pero no hay funcion
--      que lo dispare todavia.

-- =========================================================
-- promociones / promocion_items
-- =========================================================

create table promociones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('combo', 'cantidad')),
  -- Desempate cuando dos promos del mismo tipo compiten por el mismo SKU
  -- (ej. dos combos que incluyen la misma botella): gana la de prioridad
  -- mas baja. Caso raro con solo 2 tipos, pero el campo ya estaba en 2.7.
  prioridad integer not null default 100,
  -- NULL = aplica en ambas sucursales.
  sucursal_id uuid references sucursales (id),
  vigente_desde date,
  vigente_hasta date,
  check (vigente_desde is null or vigente_hasta is null or vigente_desde <= vigente_hasta),
  activo boolean not null default true,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid not null references usuarios (id)
);

create index promociones_sucursal_id_idx on promociones (sucursal_id);

create table promocion_items (
  id uuid primary key default gen_random_uuid(),
  promocion_id uuid not null references promociones (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad_requerida integer not null check (cantidad_requerida > 0),
  -- Precio del GRUPO de cantidad_requerida unidades (ver decision 2).
  precio_promocional numeric(12, 2) not null check (precio_promocional >= 0),
  unique (promocion_id, sku_id)
);

create index promocion_items_promocion_id_idx on promocion_items (promocion_id);
create index promocion_items_sku_id_idx on promocion_items (sku_id);

-- Trazabilidad: reusa el trigger de precios (bloque 5) -- misma idea, quien
-- cargo/edito la promo y cuando, fijado por auth.uid(), no por la app.

create trigger promociones_registrar_autor
  before insert or update on promociones
  for each row
  execute function registrar_autor_precio();

-- Forma valida por tipo: un combo necesita >= 2 SKU distintos, una
-- promocion de cantidad necesita exactamente 1 SKU con cantidad_requerida
-- >= 2. Se valida en un trigger DEFERRED sobre promocion_items (no sobre
-- promociones) porque la promo se arma en dos pasos -- se inserta la fila
-- de promociones y despues sus items -- y recien al final de la
-- transaccion tiene sentido pedir la forma completa.

create or replace function validar_forma_promocion()
returns trigger
language plpgsql
as $$
declare
  v_promocion_id uuid;
  v_tipo text;
  v_cantidad_items integer;
  v_skus_distintos integer;
  v_min_cantidad_requerida integer;
begin
  v_promocion_id := coalesce(new.promocion_id, old.promocion_id);

  select tipo into v_tipo from promociones where id = v_promocion_id;
  if not found then
    -- La promocion se borro (cascade se lleva los items con ella).
    return coalesce(new, old);
  end if;

  select count(*), count(distinct sku_id) into v_cantidad_items, v_skus_distintos
  from promocion_items where promocion_id = v_promocion_id;

  if v_tipo = 'combo' and (v_cantidad_items < 2 or v_skus_distintos < 2) then
    raise exception 'Un combo necesita al menos 2 SKU distintos';
  end if;

  if v_tipo = 'cantidad' then
    if v_cantidad_items <> 1 then
      raise exception 'Una promocion de cantidad tiene un solo SKU';
    end if;

    select min(cantidad_requerida) into v_min_cantidad_requerida
    from promocion_items where promocion_id = v_promocion_id;

    if v_min_cantidad_requerida < 2 then
      raise exception 'Una promocion de cantidad necesita cantidad_requerida >= 2 (2x, 3x...)';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create constraint trigger promocion_items_validar_forma
  after insert or update or delete on promocion_items
  deferrable initially deferred
  for each row
  execute function validar_forma_promocion();

-- =========================================================
-- cajas / ventas / venta_items
-- =========================================================

create table cajas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales (id),
  fecha date not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  -- Snapshot al cerrar, inmutable desde ese momento. El desglose por medio
  -- de pago no necesita columna propia: se calcula desde ventas (caja_id)
  -- igual que el stock total es una suma calculada (CLAUDE.md, regla 3).
  efectivo_sistema numeric(12, 2),
  efectivo_declarado numeric(12, 2),
  diferencia numeric(12, 2),
  cantidad_tickets integer,
  usuario_apertura_id uuid not null references usuarios (id),
  usuario_cierre_id uuid references usuarios (id),
  abierta_en timestamptz not null default now(),
  cerrada_en timestamptz,
  unique (sucursal_id, fecha)
);

create index cajas_sucursal_id_idx on cajas (sucursal_id);

create table ventas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales (id),
  usuario_id uuid not null references usuarios (id),
  fecha timestamptz not null default now(),
  medio_pago text not null check (medio_pago in ('efectivo', 'debito', 'credito', 'transferencia')),
  -- subtotal: precio de LISTA (sin ningun descuento) x cantidad, sumado en
  -- todas las lineas -- es el mismo numero sea cual sea el medio de pago,
  -- por eso el ticket puede mostrar el "total en otro medio" sin depender
  -- de que ya se haya elegido el medio. descuentos: lo que se le resto por
  -- combo/cantidad/descuento efectivo (siempre >= 0, solo si medio_pago =
  -- efectivo). total = subtotal - descuentos + deposito_envases.
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  descuentos numeric(12, 2) not null default 0 check (descuentos >= 0),
  deposito_envases numeric(12, 2) not null default 0 check (deposito_envases >= 0),
  total numeric(12, 2) not null check (total >= 0),
  check (total = subtotal - descuentos + deposito_envases),
  caja_id uuid not null references cajas (id),
  -- 'anulada' queda en el modelo (arquitectura.md 2.8) pero esta funcion no
  -- la usa todavia -- ver decision 11.
  estado text not null default 'confirmada' check (estado in ('confirmada', 'anulada')),
  creado_en timestamptz not null default now()
);

create index ventas_sucursal_id_idx on ventas (sucursal_id);
create index ventas_caja_id_idx on ventas (caja_id);
create index ventas_fecha_idx on ventas (fecha);

create table venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),
  -- Precio de lista (sin promo ni descuento efectivo) de ESTA unidad, para
  -- poder reconstruir despues "cuanto hubiera sido en otro medio" y el
  -- margen sin tener que re-derivar la cascada de precios contra el
  -- costo_actual de ese momento (que puede haber cambiado desde entonces).
  precio_lista_unitario numeric(12, 2) not null check (precio_lista_unitario >= 0),
  promocion_id uuid references promociones (id),
  con_envase boolean not null default false,
  vendido_sin_stock boolean not null default false
);

create index venta_items_venta_id_idx on venta_items (venta_id);
create index venta_items_sku_id_idx on venta_items (sku_id);

-- FK real que el bloque 9 dejo pendiente a proposito (la tabla ventas
-- todavia no existia).

alter table movimientos_envases
  add constraint movimientos_envases_venta_id_fkey
  foreign key (venta_id) references ventas (id);

-- =========================================================
-- Bloqueo de escritura directa (mismo mecanismo que stock_sucursal en el
-- bloque 3 y transferencias en el bloque 7).
-- =========================================================

create or replace function bloquear_escritura_directa_ventas()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.venta_en_curso', true), 'off') <> 'on' then
    raise exception
      '% solo se modifica a traves de confirmar_venta() / cerrar_caja()',
      tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger cajas_bloquear_escritura_directa
  before insert or update or delete on cajas
  for each row
  execute function bloquear_escritura_directa_ventas();

create trigger ventas_bloquear_escritura_directa
  before insert or update or delete on ventas
  for each row
  execute function bloquear_escritura_directa_ventas();

create trigger venta_items_bloquear_escritura_directa
  before insert or update or delete on venta_items
  for each row
  execute function bloquear_escritura_directa_ventas();

-- =========================================================
-- confirmar_venta(): registra el ticket completo en una sola transaccion.
-- p_lineas es un jsonb array, un elemento por TRAMO (ver decision 4):
--   { sku_id, cantidad, precio_unitario, precio_lista_unitario,
--     promocion_id (nullable), con_envase }
-- =========================================================

create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_medio_pago text,
  p_lineas jsonb
)
returns ventas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja_id uuid;
  v_venta ventas;
  v_item record;
  v_subtotal numeric(12, 2) := 0;
  v_descuentos numeric(12, 2) := 0;
  v_deposito numeric(12, 2) := 0;
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

  if p_medio_pago not in ('efectivo', 'debito', 'credito', 'transferencia') then
    raise exception 'Medio de pago invalido: %', p_medio_pago;
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El ticket no tiene productos';
  end if;

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  -- La caja se abre sola con la primera venta del dia (decision 6).
  insert into cajas (sucursal_id, fecha, usuario_apertura_id)
  values (p_sucursal_id, current_date, auth.uid())
  on conflict (sucursal_id, fecha) do nothing;

  select id into v_caja_id
  from cajas
  where sucursal_id = p_sucursal_id and fecha = current_date and estado = 'abierta';

  if v_caja_id is null then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  insert into ventas (sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id)
  values (p_sucursal_id, auth.uid(), p_medio_pago, 0, 0, v_caja_id)
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

    -- Regla inviolable: las promociones (combo/cantidad) son solo en
    -- efectivo (arquitectura.md 1.7). No se re-deriva el resto de la
    -- cascada de precios (decision 3), pero esta regla especifica si se
    -- valida acá porque es la unica verdaderamente inviolable del bloque.
    if p_medio_pago <> 'efectivo'
       and (v_item.promocion_id is not null or v_item.precio_unitario <> v_item.precio_lista_unitario) then
      raise exception 'Las promociones y el descuento por efectivo solo aplican pagando en efectivo';
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

  update ventas set
    subtotal = v_subtotal,
    descuentos = v_descuentos,
    deposito_envases = v_deposito,
    total = v_subtotal - v_descuentos + v_deposito
  where id = v_venta.id
  returning * into v_venta;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_venta;
end;
$$;

-- =========================================================
-- cerrar_caja(): snapshot inmutable de la caja del dia.
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
  v_efectivo_sistema numeric(12, 2);
  v_cantidad_tickets integer;
  v_caja cajas;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id, estado into v_sucursal_id, v_estado
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

  select coalesce(sum(total), 0) into v_efectivo_sistema
  from ventas
  where caja_id = p_caja_id and estado = 'confirmada' and medio_pago = 'efectivo';

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

-- =========================================================
-- RLS
-- =========================================================
-- promociones/promocion_items: lee cualquier usuario activo (hace falta
-- para vender en cualquier sucursal), escribe ve_costos() -- mismo
-- criterio que precios (bloque 5): dueño + encargado Olavarria cargan,
-- Laprida solo lee.
--
-- cajas/ventas/venta_items: lectura usuario_activo(), mismo criterio que
-- pedidos/transferencias (bloque 7) -- visibilidad operativa amplia entre
-- sucursales (el dashboard del dueño necesita consolidar). Sin politicas
-- de escritura: solo confirmar_venta()/cerrar_caja() escriben (decision 5).

alter table promociones enable row level security;
alter table promocion_items enable row level security;
alter table cajas enable row level security;
alter table ventas enable row level security;
alter table venta_items enable row level security;

create policy promociones_select on promociones for select using (usuario_activo());
create policy promociones_insert on promociones for insert with check (ve_costos());
create policy promociones_update on promociones for update using (ve_costos()) with check (ve_costos());
create policy promociones_delete on promociones for delete using (ve_costos());

create policy promocion_items_select on promocion_items for select using (usuario_activo());
create policy promocion_items_insert on promocion_items for insert with check (ve_costos());
create policy promocion_items_update on promocion_items for update using (ve_costos()) with check (ve_costos());
create policy promocion_items_delete on promocion_items for delete using (ve_costos());

create policy cajas_select on cajas for select using (usuario_activo());
create policy ventas_select on ventas for select using (usuario_activo());
create policy venta_items_select on venta_items for select using (usuario_activo());

-- =========================================================
-- Permisos base (ver notas del entorno en CLAUDE.md)
-- =========================================================
-- cajas/ventas/venta_items: SOLO select. La app nunca las escribe directo,
-- solo llama a confirmar_venta()/cerrar_caja() (security definer, dueños
-- de las tablas) -- dar insert/update/delete acá abriria la puerta a
-- registrar una venta sin pasar por registrar_movimiento().

grant select on all tables in schema public to authenticated;

grant insert, update, delete on promociones to authenticated;
grant insert, update, delete on promocion_items to authenticated;
