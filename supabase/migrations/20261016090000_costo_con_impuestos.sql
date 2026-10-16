-- El costo del producto pasa a ser lo que se pago de verdad por el, con los
-- impuestos de la factura adentro.
--
-- Pedido del usuario 2026-10-16, con la factura de Aitor Ider Balbo en la
-- mano. El problema: la Factura A lista el detalle SIN IVA (el papel dice
-- "FERUS MALBEC 6X750 ... 109.710,75" y recien abajo suma IVA, percepcion
-- de IVA y percepcion de IIBB), asi que el costo que se carga desde el
-- papel no es lo que salio la botella. Con ese costo, el margen que ve el
-- dueno y la advertencia de "precio bajo costo" quedaban ~28% optimistas.
--
-- Decidido con el usuario: la encargada sigue cargando el costo tal cual lo
-- dice el papel (no se le pide que haga cuentas) y el sistema reparte los
-- impuestos del pie entre las lineas, segun cuanto pesa cada una:
--
--     factor = total pagado / total de las lineas
--     costo con impuestos = costo unitario x factor
--
-- En la factura de Aitor Ider Balbo: 747.583,50 / 584.049,60 = 1,28. El
-- Ferus, cargado a 6.095,04, costo 7.801,65 de verdad.
--
-- El factor sale bien carguen las lineas en neto (da 1,28: IVA mas las dos
-- percepciones) o con el IVA ya adentro (da 1,06: solo las percepciones,
-- porque el IVA ya esta en el costo). Nunca duplica.
--
-- Con remito o Factura B no hay pie: no hay impuestos que repartir y el
-- costo del producto sigue siendo el costo unitario pelado.
--
-- Lo que NO cambia: costo_unitario sigue siendo lo que dice el papel (es el
-- dato trazable contra la factura) y el stock y los movimientos no se tocan.
-- La columna nueva es un dato mas del lote, igual que fecha_vencimiento.
--
-- Las compras ya cargadas quedan como estan: se corrigen solas a medida que
-- entra mercaderia nueva, porque costo_actual es el costo del ultimo lote
-- recibido (arquitectura.md 2.5).

begin;

-- =========================================================
-- Las columnas nuevas
-- =========================================================
-- Nullable a proposito: null = esta compra no tenia pie que repartir
-- (remito, Factura B, o una compra anterior a esta migracion). Donde se
-- lee, coalesce(costo_con_impuestos, costo_unitario).

alter table compra_items add column costo_con_impuestos numeric(12, 2)
  check (costo_con_impuestos is null or costo_con_impuestos >= 0);

alter table historial_costos add column costo_con_impuestos numeric(12, 2)
  check (costo_con_impuestos is null or costo_con_impuestos >= 0);

-- =========================================================
-- compra_items: una excepcion acotada al bloqueo de edicion
-- =========================================================
-- Los items de una compra confirmada no se editan, y eso no cambia. Lo
-- unico que se permite es que recalcular_costo_con_impuestos_compra()
-- escriba costo_con_impuestos: hace falta para el caso de la mercaderia que
-- entro con remito y la factura llego tres dias despues. Cualquier otra
-- diferencia en la fila sigue siendo un error.

create or replace function validar_edicion_compra_items()
returns trigger
language plpgsql
as $$
declare
  v_estado text;
begin
  select estado into v_estado from compras where id = coalesce(new.compra_id, old.compra_id);

  if v_estado <> 'borrador' then
    -- tg_op se chequea aparte: en un DELETE no existe new y plpgsql no
    -- garantiza que no evalue igual el resto de la condicion.
    if tg_op = 'UPDATE' then
      if coalesce(current_setting('bebidas_moe.costo_con_impuestos_en_curso', true), 'off') = 'on'
        and new.id = old.id
        and new.compra_id = old.compra_id
        and new.sku_id = old.sku_id
        and new.cantidad = old.cantidad
        and new.costo_unitario = old.costo_unitario
        and new.fecha_vencimiento is not distinct from old.fecha_vencimiento
      then
        return new;
      end if;
    end if;

    raise exception 'Los items de una compra solo se editan mientras esta en borrador';
  end if;

  return coalesce(new, old);
end;
$$;

-- =========================================================
-- historial_costos: completar un dato no es reescribir el lote
-- =========================================================
-- El lote sigue siendo inmutable. La unica excepcion es llenar
-- costo_con_impuestos cuando estaba vacio, que es el caso del remito al que
-- despues le llega la factura: hasta ese momento no habia respuesta posible.
-- Solo esa columna, solo de null a un valor, solo desde
-- recalcular_costo_con_impuestos_compra(), y queda el log de la
-- reclasificacion diciendo quien cargo la factura y por que.

create or replace function bloquear_escritura_directa_historial_costos()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('bebidas_moe.costo_con_impuestos_en_curso', true), 'off') = 'on'
      and old.costo_con_impuestos is null
      and new.id = old.id
      and new.sku_id = old.sku_id
      and new.proveedor_id = old.proveedor_id
      and new.recepcion_id = old.recepcion_id
      and new.costo_unitario = old.costo_unitario
      and new.cantidad = old.cantidad
      and new.fecha = old.fecha
      and new.fecha_vencimiento is not distinct from old.fecha_vencimiento
    then
      return new;
    end if;

    raise exception
      'historial_costos es inmutable: una fila por lote recibido, nunca se sobrescribe';
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'historial_costos es inmutable: una fila por lote recibido, nunca se sobrescribe';
  end if;

  if coalesce(current_setting('bebidas_moe.recepcion_en_curso', true), 'off') <> 'on' then
    raise exception 'historial_costos solo se inserta al confirmar una recepcion';
  end if;

  return coalesce(new, old);
end;
$$;

-- =========================================================
-- recalcular_costo_con_impuestos_compra()
-- =========================================================
-- Reparte los impuestos del pie entre las lineas de una compra. Se llama
-- dos veces en la vida de una compra, como mucho:
--
--   1. al cargarla (cargar_compra_directa), antes de que la recepcion
--      congele el costo en el lote;
--   2. si despues se carga o se corrige la factura
--      (reclasificar_comprobante_compra), donde ademas completa los lotes
--      ya recibidos y refresca el costo del producto.
--
-- Es idempotente: correrla dos veces con el mismo pie no cambia nada.

create or replace function recalcular_costo_con_impuestos_compra(p_compra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factor numeric;
begin
  -- Sin pie (remito, Factura B) o sin lineas, no hay nada que repartir y el
  -- costo con impuestos vuelve a null: manda el costo unitario pelado.
  select case
           when c.neto_gravado is null or c.iva is null or coalesce(c.total, 0) <= 0 then null
           else (c.neto_gravado + coalesce(c.impuestos_internos, 0) + c.iva
                 + coalesce(c.percepcion_iva, 0) + coalesce(c.percepcion_iibb, 0)) / c.total
         end
  into v_factor
  from compras c
  where c.id = p_compra_id;

  if not found then
    raise exception 'La compra no existe';
  end if;

  perform set_config('bebidas_moe.costo_con_impuestos_en_curso', 'on', true);

  update compra_items ci
  set costo_con_impuestos =
        case when v_factor is null then null else round(ci.costo_unitario * v_factor, 2) end
  where ci.compra_id = p_compra_id
    and ci.costo_con_impuestos is distinct from
        (case when v_factor is null then null else round(ci.costo_unitario * v_factor, 2) end);

  -- Los lotes ya recibidos de esta compra (si los hay): se completa el dato
  -- que faltaba. El costo del papel no se toca.
  update historial_costos hc
  set costo_con_impuestos = ci.costo_con_impuestos
  from recepciones_compra r
  join recepcion_items ri on ri.recepcion_id = r.id
  join compra_items ci on ci.id = ri.compra_item_id
  where r.compra_id = p_compra_id
    and hc.recepcion_id = r.id
    and hc.sku_id = ri.sku_id
    and hc.costo_con_impuestos is null
    and ci.costo_con_impuestos is not null;

  perform set_config('bebidas_moe.costo_con_impuestos_en_curso', 'off', true);

  -- Y el costo del producto, que es el del ultimo lote recibido: se toca
  -- solo si ese ultimo lote es justamente uno de esta compra. Si despues de
  -- esta compra entro mercaderia nueva, manda la nueva.
  update skus s
  set costo_actual = ultimo.costo
  from (
    select distinct on (hc.sku_id)
      hc.sku_id,
      coalesce(hc.costo_con_impuestos, hc.costo_unitario) as costo,
      r.compra_id
    from historial_costos hc
    join recepciones_compra r on r.id = hc.recepcion_id
    where hc.sku_id in (
      select ri.sku_id
      from recepcion_items ri
      join recepciones_compra r2 on r2.id = ri.recepcion_id
      where r2.compra_id = p_compra_id
    )
    order by hc.sku_id, hc.fecha desc, hc.id desc
  ) ultimo
  where s.id = ultimo.sku_id
    and ultimo.compra_id = p_compra_id
    and s.costo_actual is distinct from ultimo.costo;
end;
$$;

-- =========================================================
-- confirmar_recepcion(): el lote guarda las dos cosas
-- =========================================================
-- costo_unitario es lo que decia el papel y costo_con_impuestos lo que
-- salio de verdad. El costo del producto sale del segundo cuando existe.

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
           ci.cantidad as cantidad_pedida, ci.costo_unitario, ci.costo_con_impuestos,
           ci.fecha_vencimiento
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

      insert into historial_costos (
        sku_id, proveedor_id, recepcion_id, costo_unitario, costo_con_impuestos,
        cantidad, fecha, fecha_vencimiento
      )
      values (
        v_item.sku_id, v_proveedor_id, p_recepcion_id, v_item.costo_unitario,
        v_item.costo_con_impuestos,
        v_item.cantidad_recibida, now(), v_item.fecha_vencimiento
      );

      -- El costo del producto es lo que salio de verdad esa unidad: con los
      -- impuestos del pie repartidos si hubo Factura A, y el costo pelado
      -- del papel si vino con remito o Factura B (no hay pie que repartir).
      update skus
      set costo_actual = coalesce(v_item.costo_con_impuestos, v_item.costo_unitario)
      where id = v_item.sku_id;
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
-- cargar_compra_directa(): repartir el pie antes de recibir
-- =========================================================

create or replace function cargar_compra_directa(
  p_proveedor_id uuid,
  p_numero_factura text,
  p_fecha_factura date,
  p_lineas jsonb, -- [{sku_id, cantidad, costo_unitario, fecha_vencimiento}, ...]
  p_tipo_comprobante text,
  p_neto_gravado numeric default null,
  p_iva numeric default null,
  p_impuestos_internos numeric default null,
  p_percepcion_iva numeric default null,
  p_percepcion_iibb numeric default null
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
  v_neto numeric(12, 2);
  v_iva numeric(12, 2);
  v_internos numeric(12, 2);
  v_perc_iva numeric(12, 2);
  v_perc_iibb numeric(12, 2);
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

  perform validar_comprobante_fiscal_compra(
    p_tipo_comprobante, p_numero_factura, p_fecha_factura, p_neto_gravado, p_iva
  );

  -- Normalización: solo la Factura A discrimina. En la B y en el remito no
  -- hay pie que copiar, así que se fuerza todo a null en vez de confiar en
  -- lo que mande la app.
  if p_tipo_comprobante = 'factura_a' then
    v_neto := p_neto_gravado;
    v_iva := p_iva;
    v_internos := nullif(coalesce(p_impuestos_internos, 0), 0);
    v_perc_iva := nullif(coalesce(p_percepcion_iva, 0), 0);
    v_perc_iibb := nullif(coalesce(p_percepcion_iibb, 0), 0);
  else
    v_neto := null;
    v_iva := null;
    v_internos := null;
    v_perc_iva := null;
    v_perc_iibb := null;
  end if;

  select id into v_sucursal_id from sucursales where es_central = true;
  if v_sucursal_id is null then
    raise exception 'No se encontro la sucursal central';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para recibir mercaderia en esta sucursal';
  end if;

  insert into compras (
    proveedor_id, sucursal_destino_id, numero_factura, fecha_factura, usuario_id,
    tipo_comprobante, neto_gravado, iva, impuestos_internos, percepcion_iva, percepcion_iibb
  )
  values (
    p_proveedor_id, v_sucursal_id, nullif(trim(coalesce(p_numero_factura, '')), ''),
    p_fecha_factura, auth.uid(),
    p_tipo_comprobante, v_neto, v_iva, v_internos, v_perc_iva, v_perc_iibb
  )
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

  -- Con las lineas cargadas ya se sabe cuanto pesa cada una sobre el total,
  -- asi que los impuestos del pie se pueden repartir. Tiene que ir antes de
  -- confirmar_recepcion(), que es la que congela el costo en el lote.
  perform recalcular_costo_con_impuestos_compra(v_compra_id);

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
-- reclasificar_comprobante_compra(): la factura que llega despues
-- =========================================================

create or replace function reclasificar_comprobante_compra(
  p_compra_id uuid,
  p_tipo_comprobante text,
  p_numero_factura text,
  p_fecha_factura date,
  p_motivo text,
  p_neto_gravado numeric default null,
  p_iva numeric default null,
  p_impuestos_internos numeric default null,
  p_percepcion_iva numeric default null,
  p_percepcion_iibb numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_compra compras;
  v_neto numeric(12, 2);
  v_iva numeric(12, 2);
  v_internos numeric(12, 2);
  v_perc_iva numeric(12, 2);
  v_perc_iibb numeric(12, 2);
  v_numero text;
  v_reclasificacion_id uuid;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() or es_dueno() then
    raise exception 'No tenes permiso para corregir el comprobante de una compra';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Hay que escribir por qué se cambia el comprobante de esta compra';
  end if;

  select * into v_compra from compras where id = p_compra_id for update;
  if not found then
    raise exception 'La compra no existe';
  end if;

  if v_compra.estado = 'borrador' then
    raise exception
      'La compra todavía está en borrador: el comprobante se edita directo, sin reclasificar';
  end if;

  if not opera_sucursal(v_compra.sucursal_destino_id) then
    raise exception 'No tenes permiso para operar compras de esta sucursal';
  end if;

  perform validar_comprobante_fiscal_compra(
    p_tipo_comprobante, p_numero_factura, p_fecha_factura, p_neto_gravado, p_iva
  );

  if p_tipo_comprobante = 'factura_a' then
    v_neto := p_neto_gravado;
    v_iva := p_iva;
    v_internos := nullif(coalesce(p_impuestos_internos, 0), 0);
    v_perc_iva := nullif(coalesce(p_percepcion_iva, 0), 0);
    v_perc_iibb := nullif(coalesce(p_percepcion_iibb, 0), 0);
  else
    v_neto := null;
    v_iva := null;
    v_internos := null;
    v_perc_iva := null;
    v_perc_iibb := null;
  end if;

  v_numero := nullif(trim(coalesce(p_numero_factura, '')), '');

  if v_compra.tipo_comprobante is not distinct from p_tipo_comprobante
    and v_compra.numero_factura is not distinct from v_numero
    and v_compra.fecha_factura is not distinct from p_fecha_factura
    and v_compra.neto_gravado is not distinct from v_neto
    and v_compra.iva is not distinct from v_iva
    and v_compra.impuestos_internos is not distinct from v_internos
    and v_compra.percepcion_iva is not distinct from v_perc_iva
    and v_compra.percepcion_iibb is not distinct from v_perc_iibb
  then
    raise exception 'El comprobante ya está cargado igual: no hay nada que corregir';
  end if;

  perform set_config('bebidas_moe.comprobante_fiscal_en_curso', 'on', true);

  update compras
  set tipo_comprobante = p_tipo_comprobante,
      numero_factura = v_numero,
      fecha_factura = p_fecha_factura,
      neto_gravado = v_neto,
      iva = v_iva,
      impuestos_internos = v_internos,
      percepcion_iva = v_perc_iva,
      percepcion_iibb = v_perc_iibb
  where id = p_compra_id;

  insert into compras_reclasificacion_fiscal (
    compra_id,
    tipo_anterior, tipo_nuevo,
    numero_anterior, numero_nuevo,
    fecha_anterior, fecha_nueva,
    neto_anterior, neto_nuevo,
    iva_anterior, iva_nuevo,
    internos_anterior, internos_nuevo,
    percepcion_iva_anterior, percepcion_iva_nueva,
    percepcion_iibb_anterior, percepcion_iibb_nueva,
    motivo, usuario_id
  )
  values (
    p_compra_id,
    v_compra.tipo_comprobante, p_tipo_comprobante,
    v_compra.numero_factura, v_numero,
    v_compra.fecha_factura, p_fecha_factura,
    v_compra.neto_gravado, v_neto,
    v_compra.iva, v_iva,
    v_compra.impuestos_internos, v_internos,
    v_compra.percepcion_iva, v_perc_iva,
    v_compra.percepcion_iibb, v_perc_iibb,
    trim(p_motivo), auth.uid()
  )
  returning id into v_reclasificacion_id;

  perform set_config('bebidas_moe.comprobante_fiscal_en_curso', 'off', true);

  -- La mercaderia entro con remito y la factura aparecio despues: hasta
  -- recien no habia impuestos para repartir, asi que el costo de esos
  -- productos se calcula ahora (decision del usuario 2026-10-16).
  perform recalcular_costo_con_impuestos_compra(p_compra_id);

  return v_reclasificacion_id;
end;
$$;

-- =========================================================
-- Permisos
-- =========================================================
-- No hay tablas nuevas: compra_items e historial_costos ya tienen sus
-- grants y las columnas nuevas quedan cubiertas por el grant de la tabla.
-- recalcular_costo_con_impuestos_compra() no se llama desde la app: la
-- llaman las otras dos funciones, que ya controlan permisos. Se le saca el
-- execute publico para que no quede expuesta como RPC -- las dos que la
-- usan corren SECURITY DEFINER, o sea como duenas, y la siguen pudiendo
-- llamar.

revoke execute on function recalcular_costo_con_impuestos_compra(uuid) from public;

commit;
