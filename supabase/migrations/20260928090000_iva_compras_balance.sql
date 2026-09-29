-- Balance de IVA para el panel del dueño: IVA débito (lo que cobró en las
-- ventas facturadas) contra IVA crédito (lo que pagó en las compras con
-- Factura A), y el saldo entre los dos.
--
-- Pedido del usuario 2026-09-28: "ver discriminado el IVA, el balance entre
-- las compras en blanco y en negro que efectúa con lo que vende... la
-- encargada cuando llegan los pedidos debe cargar si la compra es factura A,
-- B o remito".
--
-- El lado de las VENTAS ya estaba resuelto: comprobantes_fiscales guarda
-- importe_neto/importe_iva desglosado por alícuota de categoría
-- (20260906090000_arca_facturacion.sql + app/(app)/vender/facturar/actions.ts).
-- Esta migración construye el lado de las COMPRAS, que hoy no sabe si un
-- total vino con factura o con remito.
--
-- Decisiones de negocio confirmadas por el usuario 2026-09-28 (no volver a
-- preguntarlas):
--
--   1. CRÉDITO FISCAL: solo la Factura A. Moe es Responsable Inscripto
--      (emite A y B), así que como receptor solo la A trae IVA discriminado
--      y computable. Una Factura B recibida es gasto sin crédito; un remito
--      no existe fiscalmente. El reporte muestra los tres grupos separados
--      para que se vea el tamaño del blanco y del negro, pero solo la A
--      entra en el saldo.
--   2. EL COSTO POR LÍNEA NO CAMBIA DE SIGNIFICADO: sigue siendo el precio
--      final pagado, IVA incluido -- es lo que usan el margen y la cascada
--      de precios. El dato fiscal (neto gravado + IVA) vive en el
--      ENCABEZADO de la compra, tal como figura al pie del comprobante. La
--      app precalcula esos dos números con categorias.alicuota_iva y la
--      encargada los corrige contra el papel si no coinciden.
--   3. DÉBITO FISCAL: solo los comprobantes 'autorizado'. Lo que se vendió
--      sin facturar se informa aparte, nunca mezclado con el saldo.
--   4. REMITO -> FACTURA: la mercadería llega con remito y la factura llega
--      días después. Se puede reclasificar, de forma trazable, con
--      reclasificar_comprobante_compra() -- sin tocar stock, costos ni el
--      total de la compra, y dejando una fila inmutable en
--      compras_reclasificacion_fiscal.
--
-- Fuera de alcance de este bloque (declarado en la pantalla para que nadie
-- confunda esto con una DDJJ):
--   - Gastos que no son mercadería (luz, alquiler, fletes, servicios): no
--     existen en el sistema, así que el crédito fiscal real es mayor que el
--     que muestra este balance. Se retoma como bloque aparte.
--   - Notas de crédito ARCA: no están implementadas todavía, así que una
--     devolución de una venta facturada no baja el IVA débito.
--   - Percepciones (IIBB / IVA percepción): se guardan como dato del
--     comprobante para que el pie de la factura cuadre, pero NO entran en
--     el saldo técnico (son pago a cuenta, se computan en otro renglón de
--     la DDJJ).

begin;

-- =========================================================
-- compras: el dato fiscal del comprobante, en el encabezado
-- =========================================================
-- tipo_comprobante es NULLABLE a propósito: las compras ya cargadas antes
-- de esta migración no tienen forma de saber con qué vinieron, y no se
-- inventa que fueron remito. Quedan como "sin clasificar" y el reporte las
-- muestra como tal, con su monto, para que el dueño sepa exactamente
-- cuánto del histórico no está clasificado. La app SÍ exige el tipo al
-- cargar mercadería nueva.

alter table compras add column tipo_comprobante text
  check (tipo_comprobante in ('factura_a', 'factura_b', 'remito'));

alter table compras add column neto_gravado numeric(12, 2)
  check (neto_gravado is null or neto_gravado >= 0);

alter table compras add column iva numeric(12, 2)
  check (iva is null or iva >= 0);

alter table compras add column percepciones numeric(12, 2)
  check (percepciones is null or percepciones >= 0);

-- Trazabilidad del dato fiscal (mismo criterio que precios.actualizado_por
-- en 20260902090000: control detectivo, el autor lo pone un trigger con
-- auth.uid(), nunca la app -- si el dato es autoreportado no sirve para
-- controlar nada).
alter table compras add column comprobante_cargado_por uuid references usuarios (id);
alter table compras add column comprobante_cargado_en timestamptz;

-- Coherencia del comprobante. Una Factura A sin neto/IVA discriminado no
-- es defendible como crédito fiscal, y un remito con IVA es una
-- contradicción: se bloquea en la base, no solo en el formulario.
--
-- CASE sobre un tipo_comprobante null cae en el ELSE (ningún WHEN matchea
-- null): una compra sin clasificar no puede tener datos fiscales sueltos.
alter table compras add constraint compras_comprobante_fiscal_coherente check (
  case tipo_comprobante
    when 'factura_a' then
      neto_gravado is not null and iva is not null
      and numero_factura is not null and fecha_factura is not null
    when 'factura_b' then
      -- La B no discrimina IVA: no hay neto gravado ni crédito que computar.
      neto_gravado is null and iva is null
      and numero_factura is not null and fecha_factura is not null
    when 'remito' then
      neto_gravado is null and iva is null and coalesce(percepciones, 0) = 0
    else
      neto_gravado is null and iva is null and percepciones is null
  end
);

-- =========================================================
-- Autor del dato fiscal: lo pone el sistema, no el cliente
-- =========================================================
-- Cubre los dos caminos de escritura: la carga directa (la compra nace
-- confirmada dentro de cargar_compra_directa()) y el flujo en dos pasos,
-- donde la compra pasa por 'borrador' y ahí la app SÍ puede hacer UPDATE
-- vía RLS. En los dos casos el autor sale de auth.uid().

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
    or new.percepciones is distinct from old.percepciones
    or new.numero_factura is distinct from old.numero_factura
    or new.fecha_factura is distinct from old.fecha_factura
  then
    new.comprobante_cargado_por := auth.uid();
    new.comprobante_cargado_en := now();
  end if;

  return new;
end;
$$;

-- El nombre importa: los triggers BEFORE corren en orden alfabético, y
-- este tiene que correr ANTES de compras_validar_edicion (r < v) para que
-- la validación vea el registro ya completo.
create trigger compras_registrar_autor_comprobante
  before insert or update on compras
  for each row
  execute function registrar_autor_comprobante_compra();

-- =========================================================
-- compras_reclasificacion_fiscal: log inmutable
-- =========================================================
-- Una fila por cada vez que se toca el comprobante fiscal de una compra ya
-- confirmada (típicamente remito -> Factura A cuando llega el papel).
-- Inmutable y sin grants de escritura: la escribe solo
-- reclasificar_comprobante_compra(), mismo trato que historial_costos.

create table compras_reclasificacion_fiscal (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references compras (id),
  tipo_anterior text check (tipo_anterior is null or tipo_anterior in ('factura_a', 'factura_b', 'remito')),
  tipo_nuevo text not null check (tipo_nuevo in ('factura_a', 'factura_b', 'remito')),
  numero_anterior text,
  numero_nuevo text,
  fecha_anterior date,
  fecha_nueva date,
  neto_anterior numeric(12, 2),
  neto_nuevo numeric(12, 2),
  iva_anterior numeric(12, 2),
  iva_nuevo numeric(12, 2),
  percepciones_anterior numeric(12, 2),
  percepciones_nuevas numeric(12, 2),
  -- Obligatorio: si alguien cambia la condición fiscal de una compra, tiene
  -- que quedar escrito por qué (mismo criterio que el motivo obligatorio de
  -- las diferencias de inventario).
  motivo text not null check (length(trim(motivo)) > 0),
  usuario_id uuid not null references usuarios (id),
  fecha timestamptz not null default now()
);

create index compras_reclasificacion_fiscal_compra_id_idx
  on compras_reclasificacion_fiscal (compra_id);

create or replace function bloquear_escritura_directa_reclasificacion()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception
      'compras_reclasificacion_fiscal es inmutable: una fila por reclasificacion, nunca se edita ni se borra';
  end if;

  if coalesce(current_setting('bebidas_moe.comprobante_fiscal_en_curso', true), 'off') <> 'on' then
    raise exception
      'compras_reclasificacion_fiscal solo la escribe reclasificar_comprobante_compra()';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger compras_reclasificacion_fiscal_bloquear_escritura_directa
  before insert or update or delete on compras_reclasificacion_fiscal
  for each row
  execute function bloquear_escritura_directa_reclasificacion();

alter table compras_reclasificacion_fiscal enable row level security;

create policy compras_reclasificacion_fiscal_select on compras_reclasificacion_fiscal
  for select using (ve_costos());

-- Sin políticas ni grants de insert/update/delete: solo la escribe la
-- función SECURITY DEFINER (CLAUDE.md, notas del entorno).

-- =========================================================
-- validar_edicion_compra(): los campos fiscales solo por la función
-- =========================================================
-- Reemplaza la versión de 20260820150000_bloque4_compras.sql. Dos cambios:
--
--   a) numero_factura / fecha_factura dejan de ser inmutables después de
--      confirmar -- pero solo se pueden tocar con el flag de
--      reclasificar_comprobante_compra() prendido. Antes la única forma de
--      agregar la factura de un remito era no poder.
--   b) las columnas fiscales nuevas entran a la lista vigilada. Si no las
--      agregaba acá, pasaban sin control: el trigger compara columna por
--      columna y una columna nueva simplemente no era mirada.
--
-- Lo que sigue intocable después de confirmar: proveedor, sucursal,
-- usuario y total. La reclasificación es fiscal, nunca comercial.

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

  -- ya no es borrador: los datos comerciales quedan fijos.
  if new.proveedor_id is distinct from old.proveedor_id
    or new.sucursal_destino_id is distinct from old.sucursal_destino_id
    or new.usuario_id is distinct from old.usuario_id
    or new.total is distinct from old.total
  then
    raise exception
      'La compra ya fue confirmada: los datos comerciales no se editan (las diferencias se resuelven en la recepcion)';
  end if;

  -- el comprobante fiscal sí se puede corregir, pero solo por el camino
  -- que deja registro de quién y por qué.
  if (new.tipo_comprobante is distinct from old.tipo_comprobante
      or new.neto_gravado is distinct from old.neto_gravado
      or new.iva is distinct from old.iva
      or new.percepciones is distinct from old.percepciones
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
-- validar_comprobante_fiscal_compra(): validación compartida
-- =========================================================
-- La usan cargar_compra_directa() y reclasificar_comprobante_compra() para
-- no duplicar el criterio. Devuelve nada; explota con un mensaje en
-- castellano si el comprobante no cierra.
--
-- Lo que NO valida: que neto + IVA + percepciones coincida con el total de
-- la compra. Eso se ADVIERTE en el formulario, no se bloquea (mismo
-- criterio que el precio bajo costo: avisar, no frenar la operación) --
-- una factura real puede traer bonificaciones, redondeos o conceptos que no
-- están en las líneas cargadas.

create or replace function validar_comprobante_fiscal_compra(
  p_tipo_comprobante text,
  p_numero_factura text,
  p_fecha_factura date,
  p_neto_gravado numeric,
  p_iva numeric
)
returns void
language plpgsql
as $$
begin
  if p_tipo_comprobante is null then
    raise exception 'Hay que indicar con qué vino la mercadería: Factura A, Factura B o remito';
  end if;

  if p_tipo_comprobante not in ('factura_a', 'factura_b', 'remito') then
    raise exception 'Tipo de comprobante invalido: %', p_tipo_comprobante;
  end if;

  if p_tipo_comprobante in ('factura_a', 'factura_b') then
    if p_numero_factura is null or length(trim(p_numero_factura)) = 0 then
      raise exception 'Una factura necesita su número de comprobante';
    end if;
    if p_fecha_factura is null then
      raise exception 'Una factura necesita su fecha de emisión';
    end if;
  end if;

  if p_tipo_comprobante = 'factura_a' then
    if p_neto_gravado is null or p_iva is null then
      raise exception
        'La Factura A tiene el IVA discriminado: hay que cargar el neto gravado y el IVA que figuran en el comprobante';
    end if;
    if p_neto_gravado <= 0 then
      raise exception 'El neto gravado de la Factura A tiene que ser mayor a cero';
    end if;
  end if;
end;
$$;

-- =========================================================
-- cargar_compra_directa(): ahora también carga el comprobante
-- =========================================================
-- Se DROPEA la versión de 4 argumentos en vez de agregar parámetros con
-- default: si quedaran las dos, PostgREST no podría resolver a cuál llamar
-- con los 4 args de siempre ("function is not unique"). Y el tipo de
-- comprobante es obligatorio a propósito -- prefiero que una llamada vieja
-- falle fuerte antes que grabar mercadería como "sin clasificar" en
-- silencio.

drop function if exists cargar_compra_directa(uuid, text, date, jsonb);

create function cargar_compra_directa(
  p_proveedor_id uuid,
  p_numero_factura text,
  p_fecha_factura date,
  p_lineas jsonb, -- [{sku_id, cantidad, costo_unitario, fecha_vencimiento}, ...]
  p_tipo_comprobante text,
  p_neto_gravado numeric default null,
  p_iva numeric default null,
  p_percepciones numeric default null
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
  v_percepciones numeric(12, 2);
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

  -- Normalización: la B no discrimina IVA y el remito no tiene nada fiscal.
  -- Se fuerza acá en vez de confiar en lo que mande la app.
  if p_tipo_comprobante = 'factura_a' then
    v_neto := p_neto_gravado;
    v_iva := p_iva;
    v_percepciones := nullif(coalesce(p_percepciones, 0), 0);
  elsif p_tipo_comprobante = 'factura_b' then
    v_neto := null;
    v_iva := null;
    v_percepciones := nullif(coalesce(p_percepciones, 0), 0);
  else
    v_neto := null;
    v_iva := null;
    v_percepciones := null;
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
    tipo_comprobante, neto_gravado, iva, percepciones
  )
  values (
    p_proveedor_id, v_sucursal_id, nullif(trim(coalesce(p_numero_factura, '')), ''),
    p_fecha_factura, auth.uid(),
    p_tipo_comprobante, v_neto, v_iva, v_percepciones
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

-- =========================================================
-- reclasificar_comprobante_compra(): la factura que llega después
-- =========================================================
-- Único camino para cambiar el comprobante fiscal de una compra ya
-- confirmada. No toca stock, ni costos, ni el total: solo el encabezado
-- fiscal, y deja la fila en el log inmutable.
--
-- Quién: la encargada de Olavarría (ve_costos() y no el dueño), igual que
-- todo el módulo de compras -- el dueño solo visualiza lo que ella carga
-- (20260922140000_compras_solo_lectura_dueno.sql).

create or replace function reclasificar_comprobante_compra(
  p_compra_id uuid,
  p_tipo_comprobante text,
  p_numero_factura text,
  p_fecha_factura date,
  p_motivo text,
  p_neto_gravado numeric default null,
  p_iva numeric default null,
  p_percepciones numeric default null
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
  v_percepciones numeric(12, 2);
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
    v_percepciones := nullif(coalesce(p_percepciones, 0), 0);
  elsif p_tipo_comprobante = 'factura_b' then
    v_neto := null;
    v_iva := null;
    v_percepciones := nullif(coalesce(p_percepciones, 0), 0);
  else
    v_neto := null;
    v_iva := null;
    v_percepciones := null;
  end if;

  v_numero := nullif(trim(coalesce(p_numero_factura, '')), '');

  if v_compra.tipo_comprobante is not distinct from p_tipo_comprobante
    and v_compra.numero_factura is not distinct from v_numero
    and v_compra.fecha_factura is not distinct from p_fecha_factura
    and v_compra.neto_gravado is not distinct from v_neto
    and v_compra.iva is not distinct from v_iva
    and v_compra.percepciones is not distinct from v_percepciones
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
      percepciones = v_percepciones
  where id = p_compra_id;

  insert into compras_reclasificacion_fiscal (
    compra_id,
    tipo_anterior, tipo_nuevo,
    numero_anterior, numero_nuevo,
    fecha_anterior, fecha_nueva,
    neto_anterior, neto_nuevo,
    iva_anterior, iva_nuevo,
    percepciones_anterior, percepciones_nuevas,
    motivo, usuario_id
  )
  values (
    p_compra_id,
    v_compra.tipo_comprobante, p_tipo_comprobante,
    v_compra.numero_factura, v_numero,
    v_compra.fecha_factura, p_fecha_factura,
    v_compra.neto_gravado, v_neto,
    v_compra.iva, v_iva,
    v_compra.percepciones, v_percepciones,
    trim(p_motivo), auth.uid()
  )
  returning id into v_reclasificacion_id;

  perform set_config('bebidas_moe.comprobante_fiscal_en_curso', 'off', true);

  return v_reclasificacion_id;
end;
$$;

-- =========================================================
-- reporte_iva_mensual(): el balance, mes por mes
-- =========================================================
-- Solo el dueño (ve_rentabilidad_global(), la función que el bloque 1 dejó
-- definida justamente para esto -- CLAUDE.md: "Rentabilidad global: sí /
-- no / no"). El chequeo vive DENTRO de la función porque es SECURITY
-- DEFINER: restringir solo la pantalla no alcanza, el encargado podría
-- llamar al RPC directo.
--
-- Una sola función en vez de seis queries desde el cliente: el saldo es un
-- número que tiene que dar siempre igual, no algo que cada pantalla
-- recalcule a su manera.
--
-- ZONA HORARIA: el mes se corta en hora argentina, no en UTC. Una venta de
-- las 22:00 del 31 cae en el mes siguiente si se agrupa en UTC, y el IVA
-- se liquida por mes calendario -- ahí el error no es cosmético.

create or replace function reporte_iva_mensual(p_desde date, p_hasta date)
returns table (
  mes date,
  -- Ventas (débito fiscal)
  iva_ventas numeric,
  neto_ventas numeric,
  total_facturado numeric,
  comprobantes_a integer,
  comprobantes_b integer,
  -- Base gravable de TODAS las ventas confirmadas (facturadas o no), sin
  -- el depósito de envases: sirve para mostrar qué porcentaje se factura.
  total_vendido numeric,
  -- Compras
  iva_compras numeric,
  neto_compras numeric,
  total_compras_con_credito numeric,
  total_compras_sin_credito numeric,
  total_compras_sin_comprobante numeric,
  total_compras_sin_clasificar numeric,
  percepciones numeric,
  -- Saldo técnico del mes: débito - crédito. Positivo = a pagar,
  -- negativo = a favor.
  saldo numeric
)
language plpgsql
security definer
set search_path = public
as $$
-- Los nombres de las columnas de salida (mes, iva_ventas, ...) son también
-- variables plpgsql: sin esto, cualquier referencia sin calificar sería
-- ambigua.
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
    -- El período fiscal lo define la fecha de emisión del comprobante
    -- (CbteFch, que lib/arca/wsfe.ts manda como "hoy"), no la fecha de la
    -- venta: una venta de fin de mes facturada al mes siguiente se declara
    -- en el mes en que se emitió.
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
    -- Base facturable de la venta: subtotal - descuentos. El depósito de
    -- envases queda afuera (CLAUDE.md: "no es facturación ni margen"),
    -- igual que en app/(app)/vender/facturar/actions.ts.
    select date_trunc('month', v.fecha at time zone 'America/Argentina/Buenos_Aires')::date as mes,
           sum(v.subtotal - v.descuentos) as total
    from ventas v
    where v.estado = 'confirmada'
    group by 1
  ),
  compras_mes as (
    -- Fecha del comprobante cuando existe; si no (remito sin fecha), la
    -- fecha en que entró la mercadería. Una compra confirmada sin recepción
    -- y sin fecha de factura no tiene fecha fiscal todavía y queda afuera
    -- del reporte hasta que la tenga.
    select date_trunc('month', coalesce(c.fecha_factura, r.primera_recepcion))::date as mes,
           sum(coalesce(c.iva, 0)) filter (where c.tipo_comprobante = 'factura_a') as iva,
           sum(coalesce(c.neto_gravado, 0)) filter (where c.tipo_comprobante = 'factura_a') as neto,
           sum(c.total) filter (where c.tipo_comprobante = 'factura_a') as total_a,
           sum(c.total) filter (where c.tipo_comprobante = 'factura_b') as total_b,
           sum(c.total) filter (where c.tipo_comprobante = 'remito') as total_remito,
           sum(c.total) filter (where c.tipo_comprobante is null) as total_sin_clasificar,
           sum(coalesce(c.percepciones, 0)) as percepciones
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
    coalesce(cm.percepciones, 0)::numeric,
    (coalesce(vf.iva, 0) - coalesce(cm.iva, 0))::numeric
  from meses m
  left join ventas_facturadas vf on vf.mes = m.mes
  left join ventas_todas vt on vt.mes = m.mes
  left join compras_mes cm on cm.mes = m.mes
  order by m.mes desc;
end;
$$;

-- =========================================================
-- reporte_iva_compras_mes(): el detalle de un mes
-- =========================================================
-- Las compras del mes con su comprobante, para la tabla que acompaña al
-- balance. Va en una función y no en un select desde la app por una razón
-- concreta: el mes de una compra se define por la fecha del comprobante y,
-- si no la tiene (remito), por la fecha en que entró la mercadería. Ese
-- criterio tiene que ser EL MISMO que usa reporte_iva_mensual(), o la tabla
-- no suma lo que dicen los totales de arriba.

create or replace function reporte_iva_compras_mes(p_mes date)
returns table (
  compra_id uuid,
  fecha_fiscal date,
  proveedor text,
  tipo_comprobante text,
  numero_factura text,
  neto_gravado numeric,
  iva numeric,
  percepciones numeric,
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
    c.percepciones,
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

-- =========================================================
-- Permisos base (CLAUDE.md, notas del entorno)
-- =========================================================
-- compras_reclasificacion_fiscal es nueva: necesita el select explícito
-- (el proyecto tiene "expose new tables" desactivado). No lleva
-- insert/update/delete: solo la escribe reclasificar_comprobante_compra(),
-- que corre SECURITY DEFINER como dueña de la tabla.
--
-- compras no necesita grants nuevos: las columnas nuevas viven en una
-- tabla que ya los tiene.

grant select on all tables in schema public to authenticated;

commit;
