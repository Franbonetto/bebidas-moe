-- El flete de la entrada de mercaderia: lo que se paga aparte para que la
-- mercaderia llegue al local, repartido entre las lineas igual que los
-- impuestos del pie.
--
-- Pedido del usuario 2026-10-21. El flete viene de las dos formas segun el
-- proveedor: a veces es un renglon mas de la Factura A (y entonces ya esta
-- adentro del neto gravado, asi que el factor de impuestos ya lo reparte
-- solo) y a veces se paga aparte, al camion, sin figurar en el papel. Este
-- campo es para el segundo caso -- la pantalla lo aclara, porque cargar un
-- flete que ya esta en la factura lo contaria dos veces.
--
-- Nunca es obligatorio: null = esta entrada no tuvo flete aparte.
--
-- Decidido con el usuario:
--
--   * Entra al costo del producto, con el mismo criterio que los impuestos
--     (arquitectura.md 1.6, "Costo con impuestos"): es plata que salio del
--     bolsillo por esa mercaderia, asi que el costo tiene que tenerla
--     adentro o el margen queda optimista.
--
--         factor = (total pagado + flete) / total de las lineas
--
--   * Se reparte en proporcion a lo que pesa cada linea, no en partes
--     iguales ni por unidad: una linea que es el 40% de la compra se lleva
--     el 40% del flete.
--
--   * No es un dato fiscal. No toca neto ni IVA, no da credito fiscal y no
--     entra en /reportes/iva -- esa pantalla ya aclara que los fletes
--     quedan afuera del balance. Tampoco toca compras.total, que sigue
--     siendo la suma de las lineas.
--
--   * Se puede corregir despues (el flete que se pago pero nadie cargo),
--     por el mismo camino que la factura que llega tarde:
--     reclasificar_comprobante_compra(), con motivo obligatorio y una fila
--     en compras_reclasificacion_fiscal. Nunca con un UPDATE suelto.
--
-- Novedad respecto del pie: con remito tambien hay algo que repartir. Hasta
-- hoy, sin Factura A el factor era null y el costo quedaba pelado; una
-- entrada con remito y flete ahora corrige el costo igual.

begin;

-- =========================================================
-- La columna
-- =========================================================
-- Nullable a proposito: null = no hubo flete aparte (o vino adentro de la
-- factura). Vive en el encabezado y no en las lineas: es uno por entrega,
-- del viaje entero, no de cada producto.

alter table compras add column flete numeric(12, 2)
  check (flete is null or flete >= 0);

alter table compras_reclasificacion_fiscal add column flete_anterior numeric(12, 2);
alter table compras_reclasificacion_fiscal add column flete_nuevo numeric(12, 2);

-- =========================================================
-- validar_edicion_compra(): el flete tampoco se edita de prepo
-- =========================================================
-- El trigger bloquea por columna, asi que una columna nueva pasaria
-- derecho: con la politica compras_update, cualquiera que ve costos podria
-- cambiar el flete de una compra cerrada -- y con el, el costo de los
-- productos -- sin que quede quien ni por que. Se suma a la lista de lo que
-- solo cambia desde reclasificar_comprobante_compra().

create or replace function validar_edicion_compra()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'borrador' then
    if new.estado = 'cerrada' then
      raise exception 'Una compra en borrador no puede pasar directo a cerrada';
    end if;
    if new.estado = 'confirmada' and not exists (
      select 1 from compra_items where compra_id = old.id
    ) then
      raise exception 'No se puede confirmar una compra sin items';
    end if;
    return new;
  end if;

  if new.proveedor_id is distinct from old.proveedor_id
    or new.sucursal_destino_id is distinct from old.sucursal_destino_id
    or new.usuario_id is distinct from old.usuario_id
    or new.total is distinct from old.total
  then
    raise exception
      'La compra ya fue confirmada: los datos comerciales no se editan (las diferencias se resuelven en la recepcion)';
  end if;

  if (new.tipo_comprobante is distinct from old.tipo_comprobante
      or new.neto_gravado is distinct from old.neto_gravado
      or new.iva is distinct from old.iva
      or new.impuestos_internos is distinct from old.impuestos_internos
      or new.percepcion_iva is distinct from old.percepcion_iva
      or new.percepcion_iibb is distinct from old.percepcion_iibb
      or new.numero_factura is distinct from old.numero_factura
      or new.fecha_factura is distinct from old.fecha_factura
      or new.flete is distinct from old.flete)
    and coalesce(current_setting('bebidas_moe.comprobante_fiscal_en_curso', true), 'off') <> 'on'
  then
    raise exception
      'El comprobante y el flete de una compra confirmada se corrigen con reclasificar_comprobante_compra() (queda registrado quien y por que)';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'confirmada' and new.estado = 'cerrada' then
      if coalesce(current_setting('bebidas_moe.recepcion_en_curso', true), 'off') <> 'on' then
        raise exception
          'El cierre de la compra lo calcula el sistema al confirmar la ultima recepcion pendiente';
      end if;
    else
      raise exception 'Transicion de estado invalida para la compra: % -> %', old.estado, new.estado;
    end if;
  end if;

  return new;
end;
$$;

-- =========================================================
-- recalcular_costo_con_impuestos_compra(): el flete entra al factor
-- =========================================================
-- Unico cambio: lo pagado ahora incluye el flete, y una compra sin pie pero
-- con flete tambien tiene factor (antes era null y el costo quedaba pelado).
-- Sigue siendo idempotente.

create or replace function recalcular_costo_con_impuestos_compra(p_compra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factor numeric;
begin
  -- Sin lineas no hay nada que repartir. Sin pie y sin flete tampoco: el
  -- costo con impuestos vuelve a null y manda el costo unitario pelado.
  select case
           when coalesce(c.total, 0) <= 0 then null
           when c.neto_gravado is null or c.iva is null then
             case
               when coalesce(c.flete, 0) = 0 then null
               else (c.total + c.flete) / c.total
             end
           else (c.neto_gravado + coalesce(c.impuestos_internos, 0) + c.iva
                 + coalesce(c.percepcion_iva, 0) + coalesce(c.percepcion_iibb, 0)
                 + coalesce(c.flete, 0)) / c.total
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
-- cargar_compra_directa(): el flete se carga con la mercaderia
-- =========================================================
-- A diferencia del pie, el flete NO se fuerza a null segun el comprobante:
-- el flete que se paga aparte existe igual con remito.

drop function if exists cargar_compra_directa(uuid, text, date, jsonb, text, numeric, numeric, numeric, numeric, numeric);

create function cargar_compra_directa(
  p_proveedor_id uuid,
  p_numero_factura text,
  p_fecha_factura date,
  p_lineas jsonb, -- [{sku_id, cantidad, costo_unitario, fecha_vencimiento}, ...]
  p_tipo_comprobante text,
  p_neto_gravado numeric default null,
  p_iva numeric default null,
  p_impuestos_internos numeric default null,
  p_percepcion_iva numeric default null,
  p_percepcion_iibb numeric default null,
  p_flete numeric default null
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
  v_flete numeric(12, 2);
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

  if p_flete is not null and p_flete < 0 then
    raise exception 'El flete no puede ser un monto negativo';
  end if;

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

  -- El flete no es parte del comprobante: vale para los tres tipos. Cero es
  -- lo mismo que no haber tenido flete.
  v_flete := nullif(coalesce(p_flete, 0), 0);

  select id into v_sucursal_id from sucursales where es_central = true;
  if v_sucursal_id is null then
    raise exception 'No se encontro la sucursal central';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para recibir mercaderia en esta sucursal';
  end if;

  insert into compras (
    proveedor_id, sucursal_destino_id, numero_factura, fecha_factura, usuario_id,
    tipo_comprobante, neto_gravado, iva, impuestos_internos, percepcion_iva, percepcion_iibb,
    flete
  )
  values (
    p_proveedor_id, v_sucursal_id, nullif(trim(coalesce(p_numero_factura, '')), ''),
    p_fecha_factura, auth.uid(),
    p_tipo_comprobante, v_neto, v_iva, v_internos, v_perc_iva, v_perc_iibb,
    v_flete
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
  -- asi que los impuestos del pie y el flete se pueden repartir. Tiene que
  -- ir antes de confirmar_recepcion(), que es la que congela el costo en el
  -- lote.
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
-- reclasificar_comprobante_compra(): corregir tambien el flete
-- =========================================================
-- El caso real: la mercaderia entro, el flete se pago y nadie lo cargo. Sin
-- esto quedaba mal para siempre y el costo abajo del real. Va por el mismo
-- camino que la factura que llega tarde: motivo obligatorio, fila en el log
-- y recalculo del costo al final.

drop function if exists reclasificar_comprobante_compra(uuid, text, text, date, text, numeric, numeric, numeric, numeric, numeric);

create function reclasificar_comprobante_compra(
  p_compra_id uuid,
  p_tipo_comprobante text,
  p_numero_factura text,
  p_fecha_factura date,
  p_motivo text,
  p_neto_gravado numeric default null,
  p_iva numeric default null,
  p_impuestos_internos numeric default null,
  p_percepcion_iva numeric default null,
  p_percepcion_iibb numeric default null,
  p_flete numeric default null
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
  v_flete numeric(12, 2);
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

  if p_flete is not null and p_flete < 0 then
    raise exception 'El flete no puede ser un monto negativo';
  end if;

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

  v_flete := nullif(coalesce(p_flete, 0), 0);
  v_numero := nullif(trim(coalesce(p_numero_factura, '')), '');

  if v_compra.tipo_comprobante is not distinct from p_tipo_comprobante
    and v_compra.numero_factura is not distinct from v_numero
    and v_compra.fecha_factura is not distinct from p_fecha_factura
    and v_compra.neto_gravado is not distinct from v_neto
    and v_compra.iva is not distinct from v_iva
    and v_compra.impuestos_internos is not distinct from v_internos
    and v_compra.percepcion_iva is not distinct from v_perc_iva
    and v_compra.percepcion_iibb is not distinct from v_perc_iibb
    and v_compra.flete is not distinct from v_flete
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
      percepcion_iibb = v_perc_iibb,
      flete = v_flete
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
    flete_anterior, flete_nuevo,
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
    v_compra.flete, v_flete,
    trim(p_motivo), auth.uid()
  )
  returning id into v_reclasificacion_id;

  perform set_config('bebidas_moe.comprobante_fiscal_en_curso', 'off', true);

  -- La mercaderia entro con remito y la factura aparecio despues, o el
  -- flete se cargo recien ahora: hasta este momento no habia nada para
  -- repartir, asi que el costo de esos productos se calcula aca.
  perform recalcular_costo_con_impuestos_compra(p_compra_id);

  return v_reclasificacion_id;
end;
$$;

-- =========================================================
-- Permisos
-- =========================================================
-- No hay tablas nuevas: las columnas nuevas quedan cubiertas por los grants
-- de compras y compras_reclasificacion_fiscal. Las dos funciones recreadas
-- mantienen el execute de siempre (authenticated las llama como RPC) y
-- recalcular_costo_con_impuestos_compra() sigue sin execute publico: solo
-- la llaman estas dos, que corren SECURITY DEFINER.

revoke execute on function recalcular_costo_con_impuestos_compra(uuid) from public;

commit;
