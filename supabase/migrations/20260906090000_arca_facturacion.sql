-- Bloque: integración ARCA (ex AFIP) — facturación fiscal desde el POS.
-- Ver docs/bloque_arca_facturacion.md y docs/arquitectura.md 1.8 (sección
-- "Decisiones cerradas para el bloque de facturación ARCA").
--
-- Esta migración SOLO trae tablas + RLS + las funciones de PERSISTENCIA
-- (guardan un resultado ya obtenido). No incluye nada que llame a ARCA:
-- eso vive en Node (lib/arca/wsaa.ts, lib/arca/wsfe.ts), porque Postgres
-- no puede hacer llamadas SOAP por su cuenta. La función
-- guardar_comprobante_fiscal() es el punto donde el server action entrega
-- el resultado (CAE o rechazo) para que quede grabado de forma atómica y
-- trazable, igual que el resto del sistema.
--
-- Decisiones de implementacion documentadas acá (no de negocio, esas ya
-- estan en arquitectura.md):
--
--   1. condicion_iva / puntos_venta son catalogo/configuracion: se
--      escriben directo via RLS (mismo patron que marcas/categorias),
--      sin funcion SECURITY DEFINER de por medio -- no hay riesgo de
--      inconsistencia de stock/caja en catalogo, y condicion_iva no se
--      hardcodea (se sincroniza aparte, boton manual, con
--      FEParamGetCondicionIvaReceptor).
--   2. puntos_venta es config fiscal (quien puede facturar y con que
--      numero) -- se trata como "politica", igual que recargos_sucursal:
--      solo el dueño la edita (es_dueno()). Lectura ve_costos(), porque
--      el encargado de Olavarria necesita verla para poder facturar.
--   3. arca_ta_cache es una tabla puramente tecnica (Token+Sign de WSAA,
--      12hs). RLS habilitada SIN ninguna politica ni grant para
--      authenticated -- solo la tocan arca_leer_ta()/arca_guardar_ta()
--      (SECURITY DEFINER). No lleva trigger de bloqueo: al no tener
--      grants ni politicas, ya es inaccesible por cualquier otro camino
--      (mismo criterio que stock_sucursal/movimientos_stock en
--      CLAUDE.md: "solo una funcion SECURITY DEFINER la escribe, no
--      lleva grant").
--   4. comprobantes_fiscales/comprobantes_fiscales_items SI llevan el
--      trigger de bloqueo de escritura directa (como ventas/cajas): son
--      documentos fiscales reales, ameritan la misma ceremonia de
--      trazabilidad aunque tampoco tengan grants.
--   5. "Una venta = maximo un comprobante valido" (unique en venta_id) se
--      resuelve con upsert: reintentar una venta rechazada/en error
--      ACTUALIZA la misma fila (no crea una segunda). No se permite
--      volver a facturar una venta que ya tiene un comprobante
--      'autorizado' -- eso si es inmutable.
--   6. Factura A exige cuit_receptor + razon_social_receptor (check
--      constraint) -- arquitectura.md 1.8, gap del CRM inexistente.
--   7. Solo Olavarria factura por ahora: se valida en la funcion contra
--      sucursales.es_central, no hardcodeando un id de sucursal.

-- =========================================================
-- condicion_iva: catalogo, sincronizado desde ARCA, nunca hardcodeado
-- =========================================================

create table condicion_iva (
  id uuid primary key default gen_random_uuid(),
  codigo_arca integer not null unique,
  nombre text not null,
  actualizado_en timestamptz not null default now()
);

alter table condicion_iva enable row level security;

create policy condicion_iva_select on condicion_iva for select using (usuario_activo());
create policy condicion_iva_insert on condicion_iva for insert with check (ve_costos());
create policy condicion_iva_update on condicion_iva for update using (ve_costos()) with check (ve_costos());
create policy condicion_iva_delete on condicion_iva for delete using (ve_costos());

grant insert, update, delete on condicion_iva to authenticated;

-- =========================================================
-- puntos_venta: config fiscal, uno solo por ahora (Olavarría)
-- =========================================================

create table puntos_venta (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales (id),
  numero_arca integer not null,
  activo boolean not null default true,
  unique (sucursal_id, numero_arca)
);

create index puntos_venta_sucursal_id_idx on puntos_venta (sucursal_id);

alter table puntos_venta enable row level security;

create policy puntos_venta_select on puntos_venta for select using (ve_costos());
create policy puntos_venta_insert on puntos_venta for insert with check (es_dueno());
create policy puntos_venta_update on puntos_venta for update using (es_dueno()) with check (es_dueno());
create policy puntos_venta_delete on puntos_venta for delete using (es_dueno());

grant insert, update, delete on puntos_venta to authenticated;

-- =========================================================
-- arca_ta_cache: Token+Sign de WSAA (12hs). Tabla puramente tecnica.
-- Sin politicas de insert/update/delete NI de select para authenticated
-- -- inaccesible salvo por las dos funciones de abajo.
-- =========================================================

create table arca_ta_cache (
  servicio text primary key,
  token text not null,
  sign text not null,
  expira_en timestamptz not null
);

alter table arca_ta_cache enable row level security;

-- =========================================================
-- comprobantes_fiscales / comprobantes_fiscales_items
-- =========================================================

create table comprobantes_fiscales (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null unique references ventas (id),
  tipo_cbte text not null check (tipo_cbte in ('A', 'B')),
  punto_venta_id uuid not null references puntos_venta (id),
  numero_comprobante integer,
  cae text,
  vencimiento_cae date,
  condicion_iva_receptor_id uuid not null references condicion_iva (id),
  -- Factura A exige receptor identificado (arquitectura.md 1.8, gap del
  -- CRM inexistente); Factura B usa Consumidor Final por default.
  cuit_receptor text,
  razon_social_receptor text,
  check (tipo_cbte <> 'A' or (cuit_receptor is not null and razon_social_receptor is not null)),
  importe_total numeric(12, 2) not null check (importe_total >= 0),
  importe_neto numeric(12, 2) not null check (importe_neto >= 0),
  importe_iva numeric(12, 2) not null check (importe_iva >= 0),
  estado text not null check (estado in ('pendiente', 'autorizado', 'rechazado', 'error')),
  -- Un comprobante autorizado tiene que tener CAE real; uno rechazado o
  -- en error tiene que explicar por que (nunca "fallo en silencio").
  check (estado <> 'autorizado' or (cae is not null and vencimiento_cae is not null and numero_comprobante is not null)),
  check (estado not in ('rechazado', 'error') or motivo_rechazo is not null),
  motivo_rechazo text,
  qr_data text,
  creado_por uuid not null references usuarios (id),
  creado_en timestamptz not null default now()
);

create index comprobantes_fiscales_punto_venta_id_idx on comprobantes_fiscales (punto_venta_id);

create table comprobantes_fiscales_items (
  id uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references comprobantes_fiscales (id) on delete cascade,
  venta_item_id uuid not null references venta_items (id),
  descripcion text not null,
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),
  subtotal numeric(12, 2) not null check (subtotal >= 0)
);

create index comprobantes_fiscales_items_comprobante_id_idx on comprobantes_fiscales_items (comprobante_id);

-- Bloqueo de escritura directa (mismo mecanismo que ventas/cajas, bloque 6):
-- documentos fiscales reales, misma ceremonia de trazabilidad.

create or replace function bloquear_escritura_directa_comprobantes()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.comprobante_en_curso', true), 'off') <> 'on' then
    raise exception '% solo se modifica a traves de guardar_comprobante_fiscal()', tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger comprobantes_fiscales_bloquear_escritura_directa
  before insert or update or delete on comprobantes_fiscales
  for each row
  execute function bloquear_escritura_directa_comprobantes();

create trigger comprobantes_fiscales_items_bloquear_escritura_directa
  before insert or update or delete on comprobantes_fiscales_items
  for each row
  execute function bloquear_escritura_directa_comprobantes();

alter table comprobantes_fiscales enable row level security;
alter table comprobantes_fiscales_items enable row level security;

create policy comprobantes_fiscales_select on comprobantes_fiscales for select using (ve_costos());
create policy comprobantes_fiscales_items_select on comprobantes_fiscales_items for select using (ve_costos());

-- arca_ta_cache queda afuera a propósito (ver decisión 3 arriba): ni
-- siquiera el grant de select, es inaccesible salvo por las funciones.
grant select on condicion_iva, puntos_venta, comprobantes_fiscales, comprobantes_fiscales_items to authenticated;

-- =========================================================
-- arca_leer_ta() / arca_guardar_ta(): cache del Token+Sign de WSAA.
-- Las llama lib/arca/wsaa.ts antes/despues de hacer el loginCms real
-- contra ARCA (eso es una llamada de red, no puede pasar por SQL).
-- =========================================================

create or replace function arca_leer_ta(p_servicio text)
returns table (token text, sign text, expira_en timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ve_costos() then
    raise exception 'No tenes permiso para operar la facturacion fiscal';
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
  if not ve_costos() then
    raise exception 'No tenes permiso para operar la facturacion fiscal';
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

-- =========================================================
-- guardar_comprobante_fiscal(): persiste el resultado que ya trajo el
-- server action desde ARCA (autorizado, rechazado o error). No llama a
-- ARCA. Upsert por venta_id: un reintento actualiza la misma fila, salvo
-- que ya este 'autorizado' (eso es definitivo).
--
-- p_items es un jsonb array: [{venta_item_id, descripcion, cantidad,
-- precio_unitario, subtotal}]
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

  if not ve_costos() then
    raise exception 'No tenes permiso para facturar';
  end if;

  select sucursal_id into v_sucursal_id from ventas where id = p_venta_id;
  if v_sucursal_id is null then
    raise exception 'La venta no existe';
  end if;

  -- Solo Olavarria factura por ahora (arquitectura.md 1.8) -- se valida
  -- contra es_central, no contra un id de sucursal hardcodeado.
  if not exists (select 1 from sucursales where id = v_sucursal_id and es_central = true) then
    raise exception 'Por ahora solo se puede facturar ventas de la sucursal central';
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
