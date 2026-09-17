-- Bloque: habilitar facturación ARCA para más de una sucursal.
-- Ver docs/bloque_arca_facturacion.md (sección 2 actualizada) y
-- 20260906090000_arca_facturacion.sql, que dejó explícitamente "solo
-- Olavarría factura por ahora" hasta tener el punto de venta real de
-- Laprida. El dueño tiene la clave fiscal del cliente y va a habilitar
-- (o confirmar que ya está habilitado) el punto de venta de Laprida en
-- ARCA por fuera del sistema -- esta migración deja el modelo listo para
-- cuando eso pase, sin inventar ni cargar ningún número.
--
-- Cambios:
--   1. guardar_comprobante_fiscal(): el candado "solo sucursal central"
--      se reemplaza por "la sucursal tiene un punto de venta ARCA activo
--      configurado" (ya no depende de es_central). Se agrega una
--      validación nueva: el punto_venta_id recibido tiene que pertenecer
--      a la sucursal de la venta -- antes no se chequeaba porque solo
--      podía existir un punto de venta relevante (el de Olavarría); ahora
--      que puede haber más de uno, hay que evitar que un bug de la app
--      facture una venta de Laprida contra el punto de venta de
--      Olavarría (o viceversa).
--   2. El permiso para invocar guardar_comprobante_fiscal() pasa de
--      ve_costos() (dueño + encargado Olavarría, CLAUDE.md) a
--      opera_sucursal(v_sucursal_id) (dueño, o encargado de ESA
--      sucursal). ve_costos() era un proxy de "es Olavarría", no una
--      decisión real de que facturar sea un dato de costos -- ahora que
--      cualquier sucursal puede facturar la suya, el permiso correcto es
--      por sucursal, igual que pedidos/transferencias.
--   3. RLS de puntos_venta (select) y comprobantes_fiscales/
--      comprobantes_fiscales_items (select) se abren a
--      "ve_costos() OR opera_sucursal(<sucursal de la fila>)" -- el
--      encargado de Laprida necesita poder leer el punto de venta y los
--      comprobantes de SU sucursal para facturar, sin que eso le abra
--      costos de proveedores (que siguen bloqueados en otras tablas).
--      Insert/update/delete de puntos_venta no se tocan acá: ya son
--      ve_costos() desde 20260911090000_puntos_venta_ve_costos.sql (dueño
--      + encargado Olavarría) -- Laprida sigue sin poder cargar su propio
--      número de punto de venta, eso lo sigue haciendo el dueño o la
--      encargada de Olavarría desde /vender/facturar/configuracion.
--   4. arca_leer_ta()/arca_guardar_ta() (cache del Token+Sign de WSAA,
--      compartido entre TODAS las sucursales porque usan el mismo CUIT y
--      certificado -- confirmado con el usuario) pasan de ve_costos() a
--      usuario_activo(): el token en sí no es un dato de costos ni de una
--      sucursal en particular, es infraestructura técnica compartida. El
--      permiso real de "quién puede facturar qué venta" se sigue
--      validando en guardar_comprobante_fiscal() vía opera_sucursal().

-- =========================================================
-- 1 + 2: guardar_comprobante_fiscal()
-- =========================================================

create or replace function guardar_comprobante_fiscal(
  p_venta_id uuid,
  p_tipo_cbte text,
  p_punto_venta_id uuid,
  p_condicion_iva_receptor_id uuid,
  p_cuit_receptor text,
  p_razon_social_receptor text,
  p_importe_total numeric,
  p_importe_neto numeric,
  p_importe_iva numeric,
  p_estado text,
  p_numero_comprobante integer default null,
  p_cae text default null,
  p_vencimiento_cae date default null,
  p_motivo_rechazo text default null,
  p_qr_data text default null,
  p_items jsonb default null
)
returns comprobantes_fiscales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_estado_previo text;
  v_comprobante comprobantes_fiscales;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id into v_sucursal_id from ventas where id = p_venta_id;
  if v_sucursal_id is null then
    raise exception 'La venta no existe';
  end if;

  -- Permiso por sucursal (antes era ve_costos(), que en la práctica solo
  -- dejaba pasar a Olavarría -- ver punto 2 del comentario de arriba).
  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para facturar ventas de esta sucursal';
  end if;

  -- Cualquier sucursal con un punto de venta ARCA activo puede facturar
  -- (antes: solo la sucursal central, hardcodeado contra es_central).
  if not exists (select 1 from puntos_venta where sucursal_id = v_sucursal_id and activo = true) then
    raise exception 'Esta sucursal no tiene un punto de venta ARCA configurado';
  end if;

  -- El punto de venta recibido tiene que ser de la MISMA sucursal que la
  -- venta -- antes no hacia falta este chequeo porque solo existia un
  -- punto de venta posible.
  if not exists (
    select 1 from puntos_venta where id = p_punto_venta_id and sucursal_id = v_sucursal_id
  ) then
    raise exception 'El punto de venta no corresponde a la sucursal de esta venta';
  end if;

  if p_tipo_cbte not in ('A', 'B') then
    raise exception 'Tipo de comprobante invalido: %', p_tipo_cbte;
  end if;

  if p_estado not in ('pendiente', 'autorizado', 'rechazado', 'error') then
    raise exception 'Estado invalido: %', p_estado;
  end if;

  if p_tipo_cbte = 'A' and (p_cuit_receptor is null or p_razon_social_receptor is null) then
    raise exception 'Factura A necesita CUIT y razon social del receptor';
  end if;

  select estado into v_estado_previo from comprobantes_fiscales where venta_id = p_venta_id;
  if v_estado_previo = 'autorizado' then
    raise exception 'Esta venta ya tiene un comprobante fiscal autorizado, no se puede volver a facturar';
  end if;

  perform set_config('bebidas_moe.comprobante_en_curso', 'on', true);

  insert into comprobantes_fiscales (
    venta_id, tipo_cbte, punto_venta_id, numero_comprobante, cae, vencimiento_cae,
    condicion_iva_receptor_id, cuit_receptor, razon_social_receptor,
    importe_total, importe_neto, importe_iva, estado, motivo_rechazo, qr_data, creado_por
  ) values (
    p_venta_id, p_tipo_cbte, p_punto_venta_id, p_numero_comprobante, p_cae, p_vencimiento_cae,
    p_condicion_iva_receptor_id, p_cuit_receptor, p_razon_social_receptor,
    p_importe_total, p_importe_neto, p_importe_iva, p_estado, p_motivo_rechazo, p_qr_data, auth.uid()
  )
  on conflict (venta_id) do update set
    tipo_cbte = excluded.tipo_cbte,
    punto_venta_id = excluded.punto_venta_id,
    numero_comprobante = excluded.numero_comprobante,
    cae = excluded.cae,
    vencimiento_cae = excluded.vencimiento_cae,
    condicion_iva_receptor_id = excluded.condicion_iva_receptor_id,
    cuit_receptor = excluded.cuit_receptor,
    razon_social_receptor = excluded.razon_social_receptor,
    importe_total = excluded.importe_total,
    importe_neto = excluded.importe_neto,
    importe_iva = excluded.importe_iva,
    estado = excluded.estado,
    motivo_rechazo = excluded.motivo_rechazo,
    qr_data = excluded.qr_data
    -- creado_por/creado_en NO se tocan en un reintento: marcan cuando se
    -- creó el registro por primera vez, no el último intento.
  returning * into v_comprobante;

  delete from comprobantes_fiscales_items where comprobante_id = v_comprobante.id;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    insert into comprobantes_fiscales_items (comprobante_id, venta_item_id, descripcion, cantidad, precio_unitario, subtotal)
    select v_comprobante.id, x.venta_item_id, x.descripcion, x.cantidad, x.precio_unitario, x.subtotal
    from jsonb_to_recordset(p_items) as x(
      venta_item_id uuid, descripcion text, cantidad integer, precio_unitario numeric, subtotal numeric
    );
  end if;

  perform set_config('bebidas_moe.comprobante_en_curso', 'off', true);

  return v_comprobante;
end;
$$;

-- =========================================================
-- 3: RLS de lectura, ahora por sucursal en vez de solo ve_costos()
-- =========================================================

alter policy puntos_venta_select on puntos_venta
  using (ve_costos() or opera_sucursal(sucursal_id));

alter policy comprobantes_fiscales_select on comprobantes_fiscales
  using (
    ve_costos()
    or exists (
      select 1 from ventas v
      where v.id = comprobantes_fiscales.venta_id
        and opera_sucursal(v.sucursal_id)
    )
  );

alter policy comprobantes_fiscales_items_select on comprobantes_fiscales_items
  using (
    ve_costos()
    or exists (
      select 1 from comprobantes_fiscales c
      join ventas v on v.id = c.venta_id
      where c.id = comprobantes_fiscales_items.comprobante_id
        and opera_sucursal(v.sucursal_id)
    )
  );

-- =========================================================
-- 4: arca_leer_ta() / arca_guardar_ta() -- token compartido, no atado a
-- una sucursal ni a un dato de costos.
-- =========================================================

create or replace function arca_leer_ta(p_servicio text)
returns table (token text, sign text, expira_en timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  return query
  select t.token, t.sign, t.expira_en
  from arca_ta_cache t
  where t.servicio = p_servicio;
end;
$$;

create or replace function arca_guardar_ta(p_servicio text, p_token text, p_sign text, p_expira_en timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if p_token is null or p_sign is null or p_expira_en is null then
    raise exception 'Token, sign y expiracion son obligatorios';
  end if;

  insert into arca_ta_cache (servicio, token, sign, expira_en)
  values (p_servicio, p_token, p_sign, p_expira_en)
  on conflict (servicio) do update set
    token = excluded.token,
    sign = excluded.sign,
    expira_en = excluded.expira_en;
end;
$$;
