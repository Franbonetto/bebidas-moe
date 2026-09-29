-- El pie de la factura, completo: impuestos internos y las percepciones
-- separadas.
--
-- Pedido del usuario 2026-09-29, con dos facturas reales de proveedor en la
-- mano (Dellepiane y Coca-Cola Andina). El modelo anterior (neto + IVA +
-- percepciones) no cerraba con ninguna de las dos:
--
--   Dellepiane   48.384,00 + 12.096,00 + 10.160,64 +     0,00 + 1.935,36 = 72.576,00
--   Coca-Cola   118.167,34 +  9.419,12 + 24.815,14 + 3.545,02 + 5.103,46 = 161.050,08
--                neto        imp.interno     IVA      perc.IVA  perc.IIBB     total
--
-- Los dos agregados y por qué importan:
--
--   1. IMPUESTOS INTERNOS. En bebidas con alcohol son plata seria: en la
--      factura de Dellepiane, $12.096 sobre $72.576 (el 17% del
--      comprobante). El IVA se calcula sobre el neto gravado, NO sobre el
--      neto + interno (48.384 x 21% = 10.160,64). Sin esta columna el
--      cuadre da mal en toda factura de bebida alcohólica y la advertencia
--      del formulario se vuelve ruido permanente.
--
--   2. LAS PERCEPCIONES SON DOS COSAS DISTINTAS. La percepción de IVA
--      (RG 2408) es pago a cuenta del propio IVA: se descuenta de lo que
--      hay que depositar ese mes. La de Ingresos Brutos va a otro impuesto
--      y no toca el balance de IVA. Sumadas en un solo campo, el saldo del
--      reporte queda mal siempre.
--
-- Ninguno de los dos se computa como crédito fiscal técnico: el crédito
-- sigue siendo solo el IVA. Los internos son costo, la percepción de IVA es
-- un pago a cuenta que se resta después del saldo técnico, y la de IIBB es
-- informativa.

begin;

-- =========================================================
-- compras: las columnas nuevas
-- =========================================================

alter table compras add column impuestos_internos numeric(12, 2)
  check (impuestos_internos is null or impuestos_internos >= 0);

alter table compras add column percepcion_iva numeric(12, 2)
  check (percepcion_iva is null or percepcion_iva >= 0);

alter table compras add column percepcion_iibb numeric(12, 2)
  check (percepcion_iibb is null or percepcion_iibb >= 0);

-- Lo que había cargado como "percepciones" a secas pasa a IIBB, que es la
-- que aparece en casi todas las facturas de bebidas.
update compras set percepcion_iibb = percepciones where percepciones is not null;

-- El check viejo miraba `percepciones`; hay que sacarlo antes de borrar la
-- columna, y se rehace abajo con las nuevas.
alter table compras drop constraint compras_comprobante_fiscal_coherente;
alter table compras drop column percepciones;

alter table compras add constraint compras_comprobante_fiscal_coherente check (
  case tipo_comprobante
    when 'factura_a' then
      neto_gravado is not null and iva is not null
      and numero_factura is not null and fecha_factura is not null
    when 'factura_b' then
      -- La B no discrimina IVA: no hay neto gravado ni crédito que computar.
      -- Los internos y las percepciones tampoco se pueden separar de un
      -- comprobante que no los detalla.
      neto_gravado is null and iva is null
      and impuestos_internos is null and percepcion_iva is null and percepcion_iibb is null
      and numero_factura is not null and fecha_factura is not null
    when 'remito' then
      neto_gravado is null and iva is null
      and impuestos_internos is null and percepcion_iva is null and percepcion_iibb is null
    else
      neto_gravado is null and iva is null
      and impuestos_internos is null and percepcion_iva is null and percepcion_iibb is null
  end
);

-- =========================================================
-- Trazabilidad y bloqueo de edición: mirar también las nuevas
-- =========================================================
-- Las dos funciones comparaban columna por columna. Una columna nueva que no
-- esté en la lista, simplemente pasa sin control.

create or replace function registrar_autor_comprobante_compra()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo_comprobante is not null then
      new.comprobante_cargado_por := auth.uid();
      new.comprobante_cargado_en := now();
    end if;
    return new;
  end if;

  if new.tipo_comprobante is distinct from old.tipo_comprobante
    or new.neto_gravado is distinct from old.neto_gravado
    or new.iva is distinct from old.iva
    or new.impuestos_internos is distinct from old.impuestos_internos
    or new.percepcion_iva is distinct from old.percepcion_iva
    or new.percepcion_iibb is distinct from old.percepcion_iibb
    or new.numero_factura is distinct from old.numero_factura
    or new.fecha_factura is distinct from old.fecha_factura
  then
    new.comprobante_cargado_por := auth.uid();
    new.comprobante_cargado_en := now();
  end if;

  return new;
end;
$$;

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
      or new.fecha_factura is distinct from old.fecha_factura)
    and coalesce(current_setting('bebidas_moe.comprobante_fiscal_en_curso', true), 'off') <> 'on'
  then
    raise exception
      'El comprobante fiscal de una compra confirmada se corrige con reclasificar_comprobante_compra() (queda registrado quien y por que)';
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
-- Log de reclasificación: guardar el pie completo
-- =========================================================

alter table compras_reclasificacion_fiscal
  rename column percepciones_anterior to percepcion_iibb_anterior;
alter table compras_reclasificacion_fiscal
  rename column percepciones_nuevas to percepcion_iibb_nueva;

alter table compras_reclasificacion_fiscal add column internos_anterior numeric(12, 2);
alter table compras_reclasificacion_fiscal add column internos_nuevo numeric(12, 2);
alter table compras_reclasificacion_fiscal add column percepcion_iva_anterior numeric(12, 2);
alter table compras_reclasificacion_fiscal add column percepcion_iva_nueva numeric(12, 2);

-- =========================================================
-- cargar_compra_directa() y reclasificar_comprobante_compra()
-- =========================================================
-- Un solo tipo compuesto para el pie, así las dos funciones toman lo mismo y
-- no hay que repetir seis parámetros en cada una.

drop function if exists cargar_compra_directa(uuid, text, date, jsonb, text, numeric, numeric, numeric);
drop function if exists reclasificar_comprobante_compra(uuid, text, text, date, text, numeric, numeric, numeric);

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

  return v_reclasificacion_id;
end;
$$;

-- =========================================================
-- reporte_iva_mensual(): el saldo, ahora con las percepciones de IVA
-- =========================================================
-- Dos números distintos, y la pantalla los muestra separados porque
-- significan cosas distintas:
--
--   saldo_tecnico = IVA de ventas - IVA de compras. Es la posición del mes.
--   a_pagar       = saldo_tecnico - percepciones de IVA sufridas. Las
--                   percepciones ya se pagaron al proveedor: son pago a
--                   cuenta y se descuentan de lo que hay que depositar.
--
-- Los impuestos internos y la percepción de IIBB se devuelven como
-- información (son plata que salió), pero no entran en ninguno de los dos:
-- los internos son costo y la percepción de IIBB va a otro impuesto.

-- Cambian las columnas que devuelve, y eso Postgres no lo deja reemplazar en
-- el lugar ("cannot change return type of existing function"): hay que
-- dropearla primero, igual que con las funciones que cambian de firma.
drop function if exists reporte_iva_mensual(date, date);

create function reporte_iva_mensual(p_desde date, p_hasta date)
returns table (
  mes date,
  iva_ventas numeric,
  neto_ventas numeric,
  total_facturado numeric,
  comprobantes_a integer,
  comprobantes_b integer,
  total_vendido numeric,
  iva_compras numeric,
  neto_compras numeric,
  total_compras_con_credito numeric,
  total_compras_sin_credito numeric,
  total_compras_sin_comprobante numeric,
  total_compras_sin_clasificar numeric,
  impuestos_internos numeric,
  percepcion_iva numeric,
  percepcion_iibb numeric,
  saldo numeric,
  a_pagar numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_rentabilidad_global() then
    raise exception 'El balance de IVA lo ve solamente el dueño';
  end if;

  if p_desde is null or p_hasta is null then
    raise exception 'Hay que indicar el rango de meses';
  end if;

  if p_hasta < p_desde then
    raise exception 'El rango de fechas está invertido';
  end if;

  return query
  with meses as (
    select date_trunc('month', d)::date as mes
    from generate_series(
      date_trunc('month', p_desde::timestamp),
      date_trunc('month', p_hasta::timestamp),
      interval '1 month'
    ) d
  ),
  ventas_facturadas as (
    select date_trunc('month', cf.creado_en at time zone 'America/Argentina/Buenos_Aires')::date as mes,
           sum(cf.importe_iva) as iva,
           sum(cf.importe_neto) as neto,
           sum(cf.importe_total) as total,
           count(*) filter (where cf.tipo_cbte = 'A') as cant_a,
           count(*) filter (where cf.tipo_cbte = 'B') as cant_b
    from comprobantes_fiscales cf
    where cf.estado = 'autorizado'
    group by 1
  ),
  ventas_todas as (
    select date_trunc('month', v.fecha at time zone 'America/Argentina/Buenos_Aires')::date as mes,
           sum(v.subtotal - v.descuentos) as total
    from ventas v
    where v.estado = 'confirmada'
    group by 1
  ),
  compras_mes as (
    select date_trunc('month', coalesce(c.fecha_factura, r.primera_recepcion))::date as mes,
           sum(coalesce(c.iva, 0)) filter (where c.tipo_comprobante = 'factura_a') as iva,
           sum(coalesce(c.neto_gravado, 0)) filter (where c.tipo_comprobante = 'factura_a') as neto,
           sum(c.total) filter (where c.tipo_comprobante = 'factura_a') as total_a,
           sum(c.total) filter (where c.tipo_comprobante = 'factura_b') as total_b,
           sum(c.total) filter (where c.tipo_comprobante = 'remito') as total_remito,
           sum(c.total) filter (where c.tipo_comprobante is null) as total_sin_clasificar,
           sum(coalesce(c.impuestos_internos, 0)) as internos,
           sum(coalesce(c.percepcion_iva, 0)) as perc_iva,
           sum(coalesce(c.percepcion_iibb, 0)) as perc_iibb
    from compras c
    left join lateral (
      select min(rc.fecha at time zone 'America/Argentina/Buenos_Aires')::date as primera_recepcion
      from recepciones_compra rc
      where rc.compra_id = c.id and rc.estado = 'recibida'
    ) r on true
    where c.estado <> 'borrador'
    group by 1
  )
  select
    m.mes,
    coalesce(vf.iva, 0)::numeric,
    coalesce(vf.neto, 0)::numeric,
    coalesce(vf.total, 0)::numeric,
    coalesce(vf.cant_a, 0)::integer,
    coalesce(vf.cant_b, 0)::integer,
    coalesce(vt.total, 0)::numeric,
    coalesce(cm.iva, 0)::numeric,
    coalesce(cm.neto, 0)::numeric,
    coalesce(cm.total_a, 0)::numeric,
    coalesce(cm.total_b, 0)::numeric,
    coalesce(cm.total_remito, 0)::numeric,
    coalesce(cm.total_sin_clasificar, 0)::numeric,
    coalesce(cm.internos, 0)::numeric,
    coalesce(cm.perc_iva, 0)::numeric,
    coalesce(cm.perc_iibb, 0)::numeric,
    (coalesce(vf.iva, 0) - coalesce(cm.iva, 0))::numeric,
    (coalesce(vf.iva, 0) - coalesce(cm.iva, 0) - coalesce(cm.perc_iva, 0))::numeric
  from meses m
  left join ventas_facturadas vf on vf.mes = m.mes
  left join ventas_todas vt on vt.mes = m.mes
  left join compras_mes cm on cm.mes = m.mes
  order by m.mes desc;
end;
$$;

-- =========================================================
-- reporte_iva_compras_mes(): el detalle, con el pie completo
-- =========================================================

drop function if exists reporte_iva_compras_mes(date);

create function reporte_iva_compras_mes(p_mes date)
returns table (
  compra_id uuid,
  fecha_fiscal date,
  proveedor text,
  tipo_comprobante text,
  numero_factura text,
  neto_gravado numeric,
  iva numeric,
  impuestos_internos numeric,
  percepcion_iva numeric,
  percepcion_iibb numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_rentabilidad_global() then
    raise exception 'El balance de IVA lo ve solamente el dueño';
  end if;

  if p_mes is null then
    raise exception 'Hay que indicar el mes';
  end if;

  return query
  select
    c.id,
    coalesce(c.fecha_factura, r.primera_recepcion),
    coalesce(p.nombre_comercial, p.razon_social),
    c.tipo_comprobante,
    c.numero_factura,
    c.neto_gravado,
    c.iva,
    c.impuestos_internos,
    c.percepcion_iva,
    c.percepcion_iibb,
    c.total
  from compras c
  join proveedores p on p.id = c.proveedor_id
  left join lateral (
    select min(rc.fecha at time zone 'America/Argentina/Buenos_Aires')::date as primera_recepcion
    from recepciones_compra rc
    where rc.compra_id = c.id and rc.estado = 'recibida'
  ) r on true
  where c.estado <> 'borrador'
    and date_trunc('month', coalesce(c.fecha_factura, r.primera_recepcion))
        = date_trunc('month', p_mes)
  order by coalesce(c.fecha_factura, r.primera_recepcion) desc, c.id;
end;
$$;

commit;
