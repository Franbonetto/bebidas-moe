-- Bloque 7: circuito Laprida -> Olavarria (pedidos + transferencias) +
-- sugerencia automatica del pedido semanal.
-- Ver docs/arquitectura.md, secciones 1.5 (circuito pedido -> transferencia)
-- y 2.6 (modelo de datos). Completa tambien stock_transito, que el bloque 3
-- dejo pendiente por la FK a transferencias que recien existe aca.
--
-- Decisiones de negocio confirmadas en conversacion (no estaban en
-- arquitectura.md, asi que no se improvisaron):
--
--   1. Arrastre (1.5, "sugerencia automatica"): se suma solo el pendiente
--      del ULTIMO pedido cerrado por SKU, no el acumulado historico. La
--      sugerencia ya compara contra stock_objetivo, que ya refleja el stock
--      bajo de hoy -- sumar el pendiente de pedidos mas viejos duplicaria el
--      mismo faltante.
--   2. enviado -> en_preparacion es automatico: se dispara solo la primera
--      vez que Olavarria guarda un avance de cantidad_preparada sobre un
--      pedido 'enviado' (guardar_avance_preparacion()).
--   3. Ademas del cierre automatico (ver confirmar_recepcion_transferencia),
--      existe un cierre manual (cerrar_pedido_manual()) para el caso borde
--      de mercaderia preparada que nunca termina de despacharse. Exige
--      motivo obligatorio, mismo criterio que una diferencia de recepcion o
--      un ajuste de inventario.
--
-- Separacion de las dos diferencias que pide 1.5:
--   - "diferencia de preparacion" (Olavarria no tenia stock, se sabe antes
--     de despachar): pedido_items.cantidad_pendiente, la calcula
--     confirmar_preparacion() como cantidad_solicitada - cantidad_preparada.
--   - "diferencia de recepcion" (llego menos de lo despachado, rotura):
--     transferencia_items.diferencia, la calcula
--     confirmar_recepcion_transferencia() como cantidad_recibida -
--     cantidad_despachada.
-- Son conceptos independientes que pueden coexistir en el mismo pedido.

-- =========================================================
-- Tablas
-- =========================================================

create sequence pedidos_numero_seq;

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  -- Formato LP-XXXX (arquitectura.md 2.6), autogenerado por trigger mas
  -- abajo a partir de la secuencia. No lo carga la app.
  numero text not null unique,
  -- Con solo dos sucursales el flujo es siempre Olavarria -> Laprida, pero
  -- se modela igual que compras.sucursal_destino_id: como dato validado por
  -- trigger, no hardcodeado, por si el dia de mañana hay otra sucursal
  -- satelite (arquitectura.md 1.1).
  sucursal_origen_id uuid not null references sucursales (id),
  sucursal_destino_id uuid not null references sucursales (id),
  estado text not null default 'borrador'
    check (estado in (
      'borrador', 'enviado', 'en_preparacion', 'preparado', 'despachado', 'cerrado'
    )),
  fecha_creacion timestamptz not null default now(),
  fecha_envio timestamptz,
  fecha_cierre timestamptz,
  usuario_creador_id uuid not null references usuarios (id),
  usuario_preparador_id uuid references usuarios (id),
  -- Solo se completa via cerrar_pedido_manual() (decision 3 de arriba).
  motivo_cierre_manual text
);

create index pedidos_sucursal_destino_id_idx on pedidos (sucursal_destino_id);
create index pedidos_estado_idx on pedidos (estado);

create table pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad_solicitada integer not null check (cantidad_solicitada > 0),
  -- Lo que sugirio el sistema al momento de armar el pedido, para medir
  -- cuanto lo corrigio el encargado (arquitectura.md 2.6).
  cantidad_sugerida_sistema integer,
  -- Las tres columnas de abajo las escribe unicamente el sistema (ver
  -- validar_edicion_pedido_items() mas abajo) una vez que el pedido dejo de
  -- ser borrador -- nunca la app directo.
  cantidad_preparada integer check (cantidad_preparada is null or cantidad_preparada >= 0),
  -- cantidad_solicitada - cantidad_preparada. Puede quedar negativa si
  -- Olavarria preparo de mas (no esta prohibido); no lleva CHECK >= 0 a
  -- proposito.
  cantidad_pendiente integer,
  -- "fin de semana largo", "promocion": nota de Laprida sobre por que pidio
  -- distinto de lo sugerido (arquitectura.md 2.6). Libre mientras es borrador.
  observacion_encargado text,
  unique (pedido_id, sku_id)
);

create index pedido_items_pedido_id_idx on pedido_items (pedido_id);
create index pedido_items_sku_id_idx on pedido_items (sku_id);

create table transferencias (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos (id),
  sucursal_origen_id uuid not null references sucursales (id),
  sucursal_destino_id uuid not null references sucursales (id),
  estado text not null default 'en_transito'
    check (estado in ('en_transito', 'recibida')),
  fecha_despacho timestamptz not null default now(),
  fecha_recepcion timestamptz,
  usuario_despacho_id uuid not null references usuarios (id),
  usuario_recepcion_id uuid references usuarios (id),
  observaciones text
);

create index transferencias_pedido_id_idx on transferencias (pedido_id);
create index transferencias_sucursal_destino_id_idx on transferencias (sucursal_destino_id);
create index transferencias_estado_idx on transferencias (estado);

create table transferencia_items (
  id uuid primary key default gen_random_uuid(),
  transferencia_id uuid not null references transferencias (id) on delete cascade,
  -- Igual que recepcion_items.compra_item_id en el bloque 4: permite sumar
  -- cuanto de una linea del pedido ya se despacho a traves de varias
  -- transferencias parciales (arquitectura.md 1.5: "un pedido puede generar
  -- N transferencias").
  pedido_item_id uuid not null references pedido_items (id),
  sku_id uuid not null references skus (id),
  cantidad_despachada integer not null check (cantidad_despachada > 0),
  -- NULL mientras la transferencia esta en_transito; la completa
  -- confirmar_recepcion_transferencia().
  cantidad_recibida integer check (cantidad_recibida is null or cantidad_recibida >= 0),
  -- cantidad_recibida - cantidad_despachada. La calcula el sistema.
  diferencia integer,
  motivo_diferencia text,
  unique (transferencia_id, pedido_item_id)
);

create index transferencia_items_transferencia_id_idx on transferencia_items (transferencia_id);
create index transferencia_items_pedido_item_id_idx on transferencia_items (pedido_item_id);
create index transferencia_items_sku_id_idx on transferencia_items (sku_id);

-- Mercaderia despachada de Olavarria y aun no recibida en Laprida
-- (arquitectura.md 2.3). Pendiente desde el bloque 3 por esta FK.

create table stock_transito (
  sku_id uuid not null references skus (id),
  transferencia_id uuid not null references transferencias (id),
  cantidad integer not null check (cantidad > 0),
  primary key (sku_id, transferencia_id)
);

create index stock_transito_transferencia_id_idx on stock_transito (transferencia_id);

-- =========================================================
-- pedidos: sucursal_origen_id siempre central, destino siempre no central
-- =========================================================

create or replace function validar_sucursales_pedido()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from sucursales where id = new.sucursal_origen_id and es_central = true
  ) then
    raise exception
      'El origen de un pedido tiene que ser la sucursal central (arquitectura.md 1.1)';
  end if;

  if exists (
    select 1 from sucursales where id = new.sucursal_destino_id and es_central = true
  ) then
    raise exception
      'El destino de un pedido no puede ser la sucursal central: Laprida es quien pide (arquitectura.md 1.1)';
  end if;

  return new;
end;
$$;

create trigger pedidos_validar_sucursales
  before insert or update on pedidos
  for each row
  execute function validar_sucursales_pedido();

-- =========================================================
-- pedidos: numeracion automatica LP-XXXX
-- =========================================================

create or replace function generar_numero_pedido()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    new.numero := 'LP-' || lpad(nextval('pedidos_numero_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger pedidos_generar_numero
  before insert on pedidos
  for each row
  execute function generar_numero_pedido();

-- =========================================================
-- pedidos: maquina de estados
-- =========================================================
-- borrador -> enviado: transicion directa (UPDATE de la app), como
-- compras.borrador -> confirmada en el bloque 4: no mueve nada, solo
-- compromete el pedido. Todo lo que sigue queda exclusivamente en manos de
-- las funciones SECURITY DEFINER de mas abajo (marca de sesion
-- bebidas_moe.pedido_en_curso), porque desde 'preparado' en adelante hay
-- movimientos de stock de por medio.

create or replace function validar_edicion_pedido()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'borrador' then
    if new.estado = 'enviado' then
      if not opera_sucursal(old.sucursal_destino_id) then
        raise exception 'Solo quien pide (Laprida) puede enviar el pedido';
      end if;
      if not exists (select 1 from pedido_items where pedido_id = old.id) then
        raise exception 'No se puede enviar un pedido sin items';
      end if;
      if new.fecha_envio is null then
        new.fecha_envio := now();
      end if;
      return new;
    end if;

    if new.estado <> 'borrador' then
      raise exception 'Un pedido en borrador solo puede pasar a enviado';
    end if;

    return new;
  end if;

  -- ya no es borrador: los datos de cabecera quedan fijos, salvo lo que
  -- muevan las funciones del sistema (mismo espiritu que compras: "los
  -- datos comerciales no se editan", CLAUDE.md regla 2).
  if new.sucursal_origen_id is distinct from old.sucursal_origen_id
    or new.sucursal_destino_id is distinct from old.sucursal_destino_id
    or new.usuario_creador_id is distinct from old.usuario_creador_id
    or new.numero is distinct from old.numero
    or new.fecha_creacion is distinct from old.fecha_creacion
    or new.fecha_envio is distinct from old.fecha_envio
  then
    raise exception 'Los datos de un pedido ya enviado no se editan';
  end if;

  if new.estado is distinct from old.estado then
    if coalesce(current_setting('bebidas_moe.pedido_en_curso', true), 'off') <> 'on' then
      raise exception
        'Ese cambio de estado del pedido lo hace el sistema (preparacion/despacho/cierre), no una edicion directa';
    end if;

    if not (
      (old.estado = 'enviado' and new.estado = 'en_preparacion') or
      (old.estado = 'en_preparacion' and new.estado = 'preparado') or
      (old.estado = 'preparado' and new.estado = 'despachado') or
      (old.estado = 'despachado' and new.estado = 'cerrado')
    ) then
      raise exception 'Transicion de estado invalida para el pedido: % -> %', old.estado, new.estado;
    end if;
  end if;

  return new;
end;
$$;

create trigger pedidos_validar_edicion
  before update on pedidos
  for each row
  execute function validar_edicion_pedido();

-- =========================================================
-- pedido_items: editable por Laprida solo mientras el pedido es borrador;
-- cantidad_preparada/cantidad_pendiente solo las escribe el sistema.
-- =========================================================

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

create trigger pedido_items_validar_edicion
  before insert or update or delete on pedido_items
  for each row
  execute function validar_edicion_pedido_items();

-- =========================================================
-- transferencias / transferencia_items / stock_transito: bloqueo de
-- escritura directa (mismo mecanismo que stock_sucursal/movimientos_stock
-- en el bloque 3 -- RLS sin políticas de escritura ya alcanza contra
-- anon/authenticated, pero no contra service_role ni un superusuario, asi
-- que el bloqueo real es este trigger).
-- =========================================================

create or replace function bloquear_escritura_directa_transferencias()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.transferencia_en_curso', true), 'off') <> 'on' then
    raise exception
      '% solo se modifica a traves de despachar_pedido() / confirmar_recepcion_transferencia()',
      tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger transferencias_bloquear_escritura_directa
  before insert or update or delete on transferencias
  for each row
  execute function bloquear_escritura_directa_transferencias();

create trigger transferencia_items_bloquear_escritura_directa
  before insert or update or delete on transferencia_items
  for each row
  execute function bloquear_escritura_directa_transferencias();

create trigger stock_transito_bloquear_escritura_directa
  before insert or update or delete on stock_transito
  for each row
  execute function bloquear_escritura_directa_transferencias();

-- =========================================================
-- sugerir_pedido(): sugerencia automatica del pedido semanal (arquitectura.md 1.5)
-- =========================================================
-- sugerido = stock_objetivo - (stock_actual + en_transito + pedidos
-- abiertos) + arrastre. No es SECURITY DEFINER: solo lee tablas a las que
-- quien llama ya tiene SELECT via RLS (usuario_activo()); el unico chequeo
-- de permiso propio es que opere la sucursal que esta pidiendo.

create or replace function sugerir_pedido(p_sucursal_destino_id uuid)
returns table (
  sku_id uuid,
  stock_actual integer,
  en_transito integer,
  pendiente_pedidos_abiertos integer,
  stock_objetivo integer,
  arrastre integer,
  sugerido integer
)
language plpgsql
stable
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_destino_id) then
    raise exception 'No tenes permiso para ver la sugerencia de esta sucursal';
  end if;

  return query
  with transito as (
    select st.sku_id, sum(st.cantidad)::integer as cantidad
    from stock_transito st
    join transferencias t on t.id = st.transferencia_id
    where t.sucursal_destino_id = p_sucursal_destino_id
    group by st.sku_id
  ),
  abiertos as (
    -- Pedidos ya en curso que todavia no se reflejan en stock_transito:
    -- mientras estan enviado/en_preparacion cuenta lo solicitado (es lo
    -- maximo que le puede llegar a pedir a Olavarria); una vez preparado
    -- cuenta lo preparado que todavia no se despacho (lo ya despachado
    -- entra por "transito"). Los cerrados no suman aca -- su faltante
    -- entra por "arrastre".
    select pi.sku_id, sum(
      case
        when p.estado in ('enviado', 'en_preparacion') then pi.cantidad_solicitada
        when p.estado in ('preparado', 'despachado') then
          greatest(
            coalesce(pi.cantidad_preparada, 0) - coalesce((
              select sum(ti.cantidad_despachada)
              from transferencia_items ti
              where ti.pedido_item_id = pi.id
            ), 0),
            0
          )
        else 0
      end
    )::integer as cantidad
    from pedido_items pi
    join pedidos p on p.id = pi.pedido_id
    where p.sucursal_destino_id = p_sucursal_destino_id
      and p.estado not in ('borrador', 'cerrado')
    group by pi.sku_id
  ),
  ultimo_pendiente as (
    -- Solo el pendiente del ULTIMO pedido cerrado por sku (decision de
    -- negocio confirmada arriba): la sugerencia ya compara contra
    -- stock_objetivo, que ya refleja el stock bajo de hoy.
    select distinct on (pi.sku_id)
      pi.sku_id, pi.cantidad_pendiente
    from pedido_items pi
    join pedidos p on p.id = pi.pedido_id
    where p.sucursal_destino_id = p_sucursal_destino_id
      and p.estado = 'cerrado'
      and pi.cantidad_pendiente > 0
    order by pi.sku_id, p.fecha_cierre desc
  )
  select
    s.id,
    coalesce(ss.cantidad, 0),
    coalesce(tr.cantidad, 0),
    coalesce(ab.cantidad, 0),
    s.stock_objetivo,
    coalesce(up.cantidad_pendiente, 0),
    greatest(
      s.stock_objetivo
        - (coalesce(ss.cantidad, 0) + coalesce(tr.cantidad, 0) + coalesce(ab.cantidad, 0))
        + coalesce(up.cantidad_pendiente, 0),
      0
    )
  from skus s
  left join stock_sucursal ss on ss.sku_id = s.id and ss.sucursal_id = p_sucursal_destino_id
  left join transito tr on tr.sku_id = s.id
  left join abiertos ab on ab.sku_id = s.id
  left join ultimo_pendiente up on up.sku_id = s.id
  where s.activo = true;
end;
$$;

-- =========================================================
-- guardar_avance_preparacion(): Olavarria carga cantidad_preparada
-- =========================================================
-- Decision de negocio confirmada: enviado -> en_preparacion es automatico,
-- se dispara solo con el primer guardado. Se puede llamar varias veces
-- mientras el pedido sigue en_preparacion (borrador de trabajo, como
-- "Guardar borrador" en el mockup de Olavarria).

create or replace function guardar_avance_preparacion(p_pedido_id uuid, p_lineas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_origen_id uuid;
  v_linea record;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select estado, sucursal_origen_id into v_estado, v_origen_id
  from pedidos where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido no existe';
  end if;

  if not opera_sucursal(v_origen_id) then
    raise exception 'No tenes permiso para preparar pedidos de esta sucursal';
  end if;

  if v_estado not in ('enviado', 'en_preparacion') then
    raise exception
      'Solo se puede cargar avance de preparacion mientras el pedido esta enviado o en preparacion';
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'on', true);

  for v_linea in
    select * from jsonb_to_recordset(p_lineas) as x(pedido_item_id uuid, cantidad integer)
  loop
    if v_linea.cantidad is null or v_linea.cantidad < 0 then
      raise exception 'La cantidad preparada no puede ser negativa';
    end if;

    update pedido_items
    set cantidad_preparada = v_linea.cantidad
    where id = v_linea.pedido_item_id and pedido_id = p_pedido_id;

    if not found then
      raise exception 'El item % no pertenece a este pedido', v_linea.pedido_item_id;
    end if;
  end loop;

  if v_estado = 'enviado' then
    update pedidos set estado = 'en_preparacion' where id = p_pedido_id;
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'off', true);
end;
$$;

-- =========================================================
-- confirmar_preparacion(): fija cantidad_preparada y calcula la
-- diferencia de preparacion (arquitectura.md 1.5)
-- =========================================================

create or replace function confirmar_preparacion(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_origen_id uuid;
  v_sin_preparar integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select estado, sucursal_origen_id into v_estado, v_origen_id
  from pedidos where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido no existe';
  end if;

  if not opera_sucursal(v_origen_id) then
    raise exception 'No tenes permiso para confirmar la preparacion de este pedido';
  end if;

  if v_estado <> 'en_preparacion' then
    raise exception 'Solo se puede confirmar la preparacion de un pedido en preparacion';
  end if;

  select count(*) into v_sin_preparar
  from pedido_items where pedido_id = p_pedido_id and cantidad_preparada is null;

  if v_sin_preparar > 0 then
    raise exception 'Falta cargar la cantidad preparada de % producto(s)', v_sin_preparar;
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'on', true);

  update pedido_items
  set cantidad_pendiente = cantidad_solicitada - cantidad_preparada
  where pedido_id = p_pedido_id;

  update pedidos
  set estado = 'preparado', usuario_preparador_id = auth.uid()
  where id = p_pedido_id;

  perform set_config('bebidas_moe.pedido_en_curso', 'off', true);
end;
$$;

-- =========================================================
-- despachar_pedido(): crea una transferencia (1 pedido : N transferencias),
-- descuenta Olavarria y carga stock_transito -- "al despachar" de 1.5.
-- =========================================================

create or replace function despachar_pedido(
  p_pedido_id uuid,
  p_lineas jsonb,
  p_observaciones text default null
)
returns transferencias
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_origen_id uuid;
  v_destino_id uuid;
  v_transferencia transferencias;
  v_linea record;
  v_pedido_item record;
  v_ya_despachado integer;
  v_disponible integer;
  v_stock_origen integer;
  v_alguna_linea boolean := false;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select estado, sucursal_origen_id, sucursal_destino_id
  into v_estado, v_origen_id, v_destino_id
  from pedidos where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido no existe';
  end if;

  if not opera_sucursal(v_origen_id) then
    raise exception 'No tenes permiso para despachar pedidos de esta sucursal';
  end if;

  if v_estado not in ('preparado', 'despachado') then
    raise exception 'Solo se puede despachar un pedido preparado (o con despachos parciales en curso)';
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'on', true);
  perform set_config('bebidas_moe.transferencia_en_curso', 'on', true);

  insert into transferencias (
    pedido_id, sucursal_origen_id, sucursal_destino_id, usuario_despacho_id, observaciones
  ) values (
    p_pedido_id, v_origen_id, v_destino_id, auth.uid(), p_observaciones
  )
  returning * into v_transferencia;

  for v_linea in
    select * from jsonb_to_recordset(p_lineas) as x(pedido_item_id uuid, cantidad integer)
  loop
    if v_linea.cantidad is null or v_linea.cantidad <= 0 then
      raise exception 'La cantidad a despachar tiene que ser mayor a cero';
    end if;

    select id, sku_id, cantidad_preparada into v_pedido_item
    from pedido_items
    where id = v_linea.pedido_item_id and pedido_id = p_pedido_id;

    if not found then
      raise exception 'El item % no pertenece a este pedido', v_linea.pedido_item_id;
    end if;

    select coalesce(sum(ti.cantidad_despachada), 0) into v_ya_despachado
    from transferencia_items ti
    where ti.pedido_item_id = v_pedido_item.id;

    v_disponible := coalesce(v_pedido_item.cantidad_preparada, 0) - v_ya_despachado;

    if v_linea.cantidad > v_disponible then
      raise exception
        'No se puede despachar % del sku %: solo quedan % unidades preparadas sin despachar',
        v_linea.cantidad, v_pedido_item.sku_id, v_disponible;
    end if;

    -- No se puede despachar mas mercaderia de la que hay fisicamente en
    -- origen: distinto del POS, donde vender sin stock se permite a
    -- proposito. Una transferencia interna no tiene razon de mandar algo
    -- que no existe. Lockea la fila para que dos lineas del mismo sku (o
    -- despachos concurrentes) no lean el mismo stock viejo.
    select ss.cantidad into v_stock_origen
    from stock_sucursal ss
    where ss.sku_id = v_pedido_item.sku_id and ss.sucursal_id = v_origen_id
    for update;

    v_stock_origen := coalesce(v_stock_origen, 0);

    if v_linea.cantidad > v_stock_origen then
      raise exception
        'No se puede despachar % del sku %: el stock disponible en origen es % unidades',
        v_linea.cantidad, v_pedido_item.sku_id, v_stock_origen;
    end if;

    insert into transferencia_items (transferencia_id, pedido_item_id, sku_id, cantidad_despachada)
    values (v_transferencia.id, v_pedido_item.id, v_pedido_item.sku_id, v_linea.cantidad);

    perform registrar_movimiento(
      p_sku_id => v_pedido_item.sku_id,
      p_sucursal_id => v_origen_id,
      p_tipo => 'transferencia_salida',
      p_cantidad => v_linea.cantidad,
      p_documento_tipo => 'transferencia',
      p_documento_id => v_transferencia.id
    );

    insert into stock_transito (sku_id, transferencia_id, cantidad)
    values (v_pedido_item.sku_id, v_transferencia.id, v_linea.cantidad);

    v_alguna_linea := true;
  end loop;

  if not v_alguna_linea then
    raise exception 'No hay lineas para despachar';
  end if;

  if v_estado = 'preparado' then
    update pedidos set estado = 'despachado' where id = p_pedido_id;
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'off', true);
  perform set_config('bebidas_moe.transferencia_en_curso', 'off', true);

  return v_transferencia;
end;
$$;

-- =========================================================
-- confirmar_recepcion_transferencia(): "al recibir" de 1.5 -- descarga
-- stock_transito y acredita Laprida por lo que realmente llego, exige
-- motivo si hubo rotura, y cierra el pedido solo cuando corresponde.
-- =========================================================

create or replace function confirmar_recepcion_transferencia(
  p_transferencia_id uuid,
  p_lineas jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_pedido_id uuid;
  v_destino_id uuid;
  v_linea record;
  v_item record;
  v_diferencia integer;
  v_alguna_linea boolean := false;
  v_falta_despachar integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select t.estado, t.pedido_id, t.sucursal_destino_id
  into v_estado, v_pedido_id, v_destino_id
  from transferencias t
  where t.id = p_transferencia_id
  for update;

  if not found then
    raise exception 'La transferencia no existe';
  end if;

  if not opera_sucursal(v_destino_id) then
    raise exception 'No tenes permiso para recibir mercaderia en esta sucursal';
  end if;

  if v_estado <> 'en_transito' then
    raise exception 'Esta transferencia ya fue recibida';
  end if;

  perform set_config('bebidas_moe.transferencia_en_curso', 'on', true);
  perform set_config('bebidas_moe.pedido_en_curso', 'on', true);

  for v_linea in
    select * from jsonb_to_recordset(p_lineas)
    as x(transferencia_item_id uuid, cantidad_recibida integer, motivo_diferencia text)
  loop
    if v_linea.cantidad_recibida is null or v_linea.cantidad_recibida < 0 then
      raise exception 'La cantidad recibida no puede ser negativa';
    end if;

    select ti.id, ti.sku_id, ti.cantidad_despachada into v_item
    from transferencia_items ti
    where ti.id = v_linea.transferencia_item_id and ti.transferencia_id = p_transferencia_id;

    if not found then
      raise exception 'El item % no pertenece a esta transferencia', v_linea.transferencia_item_id;
    end if;

    v_diferencia := v_linea.cantidad_recibida - v_item.cantidad_despachada;

    if v_diferencia <> 0 and coalesce(trim(v_linea.motivo_diferencia), '') = '' then
      raise exception
        'Falta motivo_diferencia en el sku % (se despacharon %, llegaron %)',
        v_item.sku_id, v_item.cantidad_despachada, v_linea.cantidad_recibida;
    end if;

    update transferencia_items
    set cantidad_recibida = v_linea.cantidad_recibida,
        diferencia = v_diferencia,
        motivo_diferencia = case when v_diferencia <> 0 then v_linea.motivo_diferencia else null end
    where id = v_item.id;

    -- Solo entra a Laprida lo que realmente llego (arquitectura.md 1.5:
    -- "Laprida +N, o menos si hay diferencia"), nunca lo despachado.
    if v_linea.cantidad_recibida > 0 then
      perform registrar_movimiento(
        p_sku_id => v_item.sku_id,
        p_sucursal_id => v_destino_id,
        p_tipo => 'transferencia_entrada',
        p_cantidad => v_linea.cantidad_recibida,
        p_motivo => v_linea.motivo_diferencia,
        p_documento_tipo => 'transferencia',
        p_documento_id => p_transferencia_id
      );
    end if;

    -- Deja de estar en transito independientemente de si llego entero: lo
    -- que se rompio no esta "todavia viajando", esta perdido.
    delete from stock_transito
    where sku_id = v_item.sku_id and transferencia_id = p_transferencia_id;

    v_alguna_linea := true;
  end loop;

  if not v_alguna_linea then
    raise exception 'No hay lineas para recibir';
  end if;

  if exists (
    select 1 from transferencia_items
    where transferencia_id = p_transferencia_id and cantidad_recibida is null
  ) then
    raise exception 'Faltan lineas por recibir en esta transferencia';
  end if;

  update transferencias
  set estado = 'recibida', fecha_recepcion = now(), usuario_recepcion_id = auth.uid()
  where id = p_transferencia_id;

  -- Cierre automatico: ninguna transferencia en transito para el pedido, y
  -- no quedo remanente preparado sin despachar.
  if not exists (
    select 1 from transferencias where pedido_id = v_pedido_id and estado = 'en_transito'
  ) then
    select coalesce(sum(
      greatest(
        coalesce(pi.cantidad_preparada, 0) - coalesce((
          select sum(ti.cantidad_despachada)
          from transferencia_items ti
          where ti.pedido_item_id = pi.id
        ), 0),
        0
      )
    ), 0)
    into v_falta_despachar
    from pedido_items pi
    where pi.pedido_id = v_pedido_id;

    if v_falta_despachar = 0 then
      update pedidos set estado = 'cerrado', fecha_cierre = now()
      where id = v_pedido_id and estado = 'despachado';
    end if;
  end if;

  perform set_config('bebidas_moe.transferencia_en_curso', 'off', true);
  perform set_config('bebidas_moe.pedido_en_curso', 'off', true);
end;
$$;

-- =========================================================
-- cerrar_pedido_manual(): decision de negocio confirmada -- para el caso
-- borde de mercaderia preparada que nunca termina de despacharse. Exige
-- motivo obligatorio y suma lo no despachado a cantidad_pendiente.
-- =========================================================

create or replace function cerrar_pedido_manual(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_origen_id uuid;
  v_en_transito integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'El cierre manual de un pedido necesita motivo';
  end if;

  select estado, sucursal_origen_id into v_estado, v_origen_id
  from pedidos where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido no existe';
  end if;

  if not opera_sucursal(v_origen_id) then
    raise exception 'No tenes permiso para cerrar pedidos de esta sucursal';
  end if;

  if v_estado <> 'despachado' then
    raise exception 'Solo se puede cerrar manualmente un pedido despachado';
  end if;

  select count(*) into v_en_transito
  from transferencias where pedido_id = p_pedido_id and estado = 'en_transito';

  if v_en_transito > 0 then
    raise exception 'No se puede cerrar el pedido con transferencias todavia en transito';
  end if;

  perform set_config('bebidas_moe.pedido_en_curso', 'on', true);

  update pedido_items pi
  set cantidad_pendiente = coalesce(pi.cantidad_pendiente, 0) + greatest(
    coalesce(pi.cantidad_preparada, 0) - coalesce((
      select sum(ti.cantidad_despachada) from transferencia_items ti where ti.pedido_item_id = pi.id
    ), 0),
    0
  )
  where pi.pedido_id = p_pedido_id;

  update pedidos
  set estado = 'cerrado', fecha_cierre = now(), motivo_cierre_manual = p_motivo
  where id = p_pedido_id;

  perform set_config('bebidas_moe.pedido_en_curso', 'off', true);
end;
$$;

-- =========================================================
-- RLS
-- =========================================================
-- Lectura: cualquier usuario activo (dueño + los dos encargados interactuan
-- con pedidos/transferencias, arquitectura.md 1.11 -- no es informacion de
-- costos). Escritura de pedidos/pedido_items: solo mientras borrador, RLS
-- directo (mismo criterio que compras/compra_items en el bloque 4).
-- transferencias/transferencia_items/stock_transito: sin politicas de
-- escritura, exclusivas de las funciones SECURITY DEFINER de arriba.

alter table pedidos enable row level security;
alter table pedido_items enable row level security;
alter table transferencias enable row level security;
alter table transferencia_items enable row level security;
alter table stock_transito enable row level security;

create policy pedidos_select on pedidos for select using (usuario_activo());

create policy pedidos_insert on pedidos for insert
  with check (
    opera_sucursal(sucursal_destino_id)
    and estado = 'borrador'
    and usuario_creador_id = auth.uid()
  );

create policy pedidos_update on pedidos for update
  using (opera_sucursal(sucursal_origen_id) or opera_sucursal(sucursal_destino_id))
  with check (opera_sucursal(sucursal_origen_id) or opera_sucursal(sucursal_destino_id));

create policy pedidos_delete on pedidos for delete
  using (opera_sucursal(sucursal_destino_id) and estado = 'borrador');

create policy pedido_items_select on pedido_items for select using (usuario_activo());

create policy pedido_items_insert on pedido_items for insert
  with check (
    exists (
      select 1 from pedidos p
      where p.id = pedido_id and opera_sucursal(p.sucursal_destino_id)
    )
  );

create policy pedido_items_update on pedido_items for update
  using (
    exists (
      select 1 from pedidos p
      where p.id = pedido_id and opera_sucursal(p.sucursal_destino_id)
    )
  )
  with check (
    exists (
      select 1 from pedidos p
      where p.id = pedido_id and opera_sucursal(p.sucursal_destino_id)
    )
  );

create policy pedido_items_delete on pedido_items for delete
  using (
    exists (
      select 1 from pedidos p
      where p.id = pedido_id and opera_sucursal(p.sucursal_destino_id)
    )
  );

create policy transferencias_select on transferencias for select using (usuario_activo());
create policy transferencia_items_select on transferencia_items for select using (usuario_activo());
create policy stock_transito_select on stock_transito for select using (usuario_activo());

-- =========================================================
-- Permisos base (ver notas del entorno en CLAUDE.md)
-- =========================================================
-- select: todas las tablas nuevas, RLS decide que filas se ven. Se repite
-- el blanket aca (ya corrido en bloques anteriores) para que esta migracion
-- sea autocontenida.
--
-- pedidos/pedido_items: tienen politica de insert/update/delete para
-- authenticated (staging del borrador) -> llevan esos grants.
--
-- transferencias/transferencia_items/stock_transito: sin politicas de
-- escritura, solo las escriben despachar_pedido()/
-- confirmar_recepcion_transferencia() (SECURITY DEFINER, dueños de las
-- tablas) -> NO llevan grants de insert/update/delete.

grant select on all tables in schema public to authenticated;

grant insert, update, delete on pedidos to authenticated;
grant insert, update, delete on pedido_items to authenticated;

-- generar_numero_pedido() no es SECURITY DEFINER (no necesita saltarse RLS,
-- solo pide el siguiente numero), asi que corre como el rol que hace el
-- INSERT. nextval() exige USAGE sobre la secuencia, que a diferencia de las
-- tablas no queda cubierta por ningun grant "on all tables".

grant usage on sequence pedidos_numero_seq to authenticated;
