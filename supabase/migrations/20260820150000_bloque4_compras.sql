-- Bloque 4: proveedores y compras (documento en dos pasos: compra + N
-- recepciones) + historial de costos.
-- Ver docs/arquitectura.md, secciones 1.6 (compras y proveedores) y 2.5
-- (modelo de datos).
--
-- Estado de la compra: 1.6 lo describe como "borrador -> confirmada", pero
-- el modelo de 2.5 agrega "cerrada". Se resuelve asi: 'cerrada' es
-- automatico, lo calcula confirmar_recepcion() cuando la ultima recepcion
-- pendiente termina de cubrir todo lo pedido en la compra. Nadie la cierra
-- a mano.
--
-- Una vez que la compra deja de ser 'borrador' sus datos comerciales
-- (proveedor, items, total) quedan fijos: confirmar es un compromiso con el
-- proveedor. Las diferencias de lo que efectivamente llega se resuelven en
-- la recepcion (recepcion_items.diferencia + motivo), nunca reeditando la
-- compra -- mismo espiritu que "los movimientos son inmutables, para
-- corregir se genera un movimiento nuevo" (CLAUDE.md regla 2).

-- =========================================================
-- Tablas
-- =========================================================

create table proveedores (
  id uuid primary key default gen_random_uuid(),
  razon_social text not null,
  nombre_comercial text,
  -- Nullable a proposito: puede cargarse un proveedor chico sin CUIT a mano
  -- y completarlo despues, mismo criterio que codigo_barras en skus.
  cuit text unique,
  contacto text,
  whatsapp text,
  email text,
  direccion text,
  -- Sin enum: arquitectura.md no define los valores posibles ("cuenta
  -- corriente", "contado", etc.) y CLAUDE.md prohibe inventar lista cerrada
  -- de algo que no esta documentado.
  condicion_pago text,
  plazo_dias integer check (plazo_dias is null or plazo_dias >= 0),
  observaciones text,
  activo boolean not null default true
);

create table proveedor_skus (
  -- Proveedor <-> producto especifico (arquitectura.md 1.6: "no solo
  -- marca/categoria"), habilita comparar proveedores por SKU y detectar
  -- productos sin proveedor activo.
  proveedor_id uuid not null references proveedores (id),
  sku_id uuid not null references skus (id),
  costo_referencia numeric(12, 2) check (costo_referencia is null or costo_referencia >= 0),
  activo boolean not null default true,
  primary key (proveedor_id, sku_id)
);

create index proveedor_skus_sku_id_idx on proveedor_skus (sku_id);

create table compras (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores (id),
  -- Solo la sucursal central compra a proveedores (arquitectura.md 1.1:
  -- "Laprida no compra a proveedores"). Se valida contra sucursales.es_central
  -- por trigger mas abajo, no hardcodeado, mismo criterio que el resto del
  -- sistema usa esa columna.
  sucursal_destino_id uuid not null references sucursales (id),
  numero_factura text,
  fecha_factura date,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'confirmada', 'cerrada')),
  usuario_id uuid not null references usuarios (id),
  -- Se mantiene via trigger a partir de la suma de compra_items.subtotal;
  -- nadie lo escribe a mano.
  total numeric(12, 2) not null default 0
);

create index compras_proveedor_id_idx on compras (proveedor_id);
create index compras_sucursal_destino_id_idx on compras (sucursal_destino_id);
create index compras_estado_idx on compras (estado);

create table compra_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references compras (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad integer not null check (cantidad > 0),
  costo_unitario numeric(12, 2) not null check (costo_unitario >= 0),
  subtotal numeric(12, 2) generated always as (cantidad * costo_unitario) stored,
  unique (compra_id, sku_id)
);

create index compra_items_compra_id_idx on compra_items (compra_id);
create index compra_items_sku_id_idx on compra_items (sku_id);

create table recepciones_compra (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references compras (id),
  fecha timestamptz not null default now(),
  usuario_id uuid not null references usuarios (id),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'recibida'))
);

create index recepciones_compra_compra_id_idx on recepciones_compra (compra_id);

create table recepcion_items (
  id uuid primary key default gen_random_uuid(),
  recepcion_id uuid not null references recepciones_compra (id) on delete cascade,
  compra_item_id uuid not null references compra_items (id),
  sku_id uuid not null references skus (id),
  cantidad_recibida integer not null check (cantidad_recibida >= 0),
  -- Firmada: positiva = llego mas de lo que quedaba pendiente en esa linea,
  -- negativa = faltante. La calcula confirmar_recepcion(), nunca se carga a
  -- mano (ver trigger mas abajo).
  diferencia integer,
  motivo_diferencia text,
  unique (recepcion_id, compra_item_id)
);

create index recepcion_items_recepcion_id_idx on recepcion_items (recepcion_id);
create index recepcion_items_compra_item_id_idx on recepcion_items (compra_item_id);
create index recepcion_items_sku_id_idx on recepcion_items (sku_id);

create table historial_costos (
  -- Una fila por lote recibido. Nunca se sobrescribe (arquitectura.md 2.5,
  -- CLAUDE.md regla 5) -- mismo trato que movimientos_stock: inmutable,
  -- solo la insertan confirmar_recepcion().
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references skus (id),
  proveedor_id uuid not null references proveedores (id),
  recepcion_id uuid not null references recepciones_compra (id),
  costo_unitario numeric(12, 2) not null check (costo_unitario >= 0),
  cantidad integer not null check (cantidad > 0),
  fecha timestamptz not null default now()
);

create index historial_costos_sku_id_idx on historial_costos (sku_id);
create index historial_costos_proveedor_id_idx on historial_costos (proveedor_id);
create index historial_costos_recepcion_id_idx on historial_costos (recepcion_id);

-- =========================================================
-- compras: sucursal_destino_id siempre central
-- =========================================================

create or replace function validar_sucursal_destino_central()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from sucursales where id = new.sucursal_destino_id and es_central = true
  ) then
    raise exception
      'Solo la sucursal central compra a proveedores (arquitectura.md 1.1)';
  end if;
  return new;
end;
$$;

create trigger compras_validar_sucursal_destino
  before insert or update on compras
  for each row
  execute function validar_sucursal_destino_central();

-- =========================================================
-- compras: maquina de estados y bloqueo de edicion post-borrador
-- =========================================================

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

  -- ya no es borrador: los datos comerciales quedan fijos, solo avanza el estado.
  if new.proveedor_id is distinct from old.proveedor_id
    or new.sucursal_destino_id is distinct from old.sucursal_destino_id
    or new.numero_factura is distinct from old.numero_factura
    or new.fecha_factura is distinct from old.fecha_factura
    or new.usuario_id is distinct from old.usuario_id
    or new.total is distinct from old.total
  then
    raise exception
      'La compra ya fue confirmada: los datos comerciales no se editan (las diferencias se resuelven en la recepcion)';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'confirmada' and new.estado = 'cerrada' then
      -- unica transicion permitida aca, y solo la dispara confirmar_recepcion().
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

create trigger compras_validar_edicion
  before update on compras
  for each row
  execute function validar_edicion_compra();

-- =========================================================
-- compra_items: editable solo mientras la compra es borrador
-- =========================================================

create or replace function validar_edicion_compra_items()
returns trigger
language plpgsql
as $$
declare
  v_estado text;
begin
  select estado into v_estado from compras where id = coalesce(new.compra_id, old.compra_id);

  if v_estado <> 'borrador' then
    raise exception 'Los items de una compra solo se editan mientras esta en borrador';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger compra_items_validar_edicion
  before insert or update or delete on compra_items
  for each row
  execute function validar_edicion_compra_items();

-- total de la compra: se mantiene solo, nadie lo escribe a mano.

create or replace function actualizar_total_compra()
returns trigger
language plpgsql
as $$
declare
  v_compra_id uuid;
begin
  v_compra_id := coalesce(new.compra_id, old.compra_id);

  update compras
  set total = coalesce((select sum(subtotal) from compra_items where compra_id = v_compra_id), 0)
  where id = v_compra_id;

  return coalesce(new, old);
end;
$$;

create trigger compra_items_actualizar_total
  after insert or update or delete on compra_items
  for each row
  execute function actualizar_total_compra();

-- =========================================================
-- recepciones_compra: solo se crean sobre una compra confirmada
-- =========================================================
-- Sin politica de update/delete para authenticated (mas abajo): la unica
-- transicion pendiente -> recibida la hace confirmar_recepcion(), que corre
-- SECURITY DEFINER y por eso no pasa por RLS -- mismo mecanismo que
-- registrar_movimiento() en el bloque 3.

create or replace function validar_creacion_recepcion()
returns trigger
language plpgsql
as $$
declare
  v_estado_compra text;
begin
  select estado into v_estado_compra from compras where id = new.compra_id;

  if v_estado_compra is distinct from 'confirmada' then
    raise exception 'Solo se pueden crear recepciones para compras confirmadas';
  end if;

  return new;
end;
$$;

create trigger recepciones_compra_validar_creacion
  before insert on recepciones_compra
  for each row
  execute function validar_creacion_recepcion();

-- =========================================================
-- recepcion_items: editable solo mientras la recepcion esta pendiente;
-- diferencia solo la escribe el sistema.
-- =========================================================

create or replace function validar_edicion_recepcion_items()
returns trigger
language plpgsql
as $$
declare
  v_estado_recepcion text;
  v_compra_id_recepcion uuid;
  v_compra_id_item uuid;
  v_sku_id_item uuid;
begin
  select r.estado, r.compra_id into v_estado_recepcion, v_compra_id_recepcion
  from recepciones_compra r
  where r.id = coalesce(new.recepcion_id, old.recepcion_id);

  if tg_op = 'DELETE' then
    if v_estado_recepcion <> 'pendiente' then
      raise exception 'No se puede borrar un item de una recepcion ya recibida';
    end if;
    return old;
  end if;

  if v_estado_recepcion <> 'pendiente' then
    raise exception 'Los items de una recepcion solo se editan mientras esta pendiente';
  end if;

  select compra_id, sku_id into v_compra_id_item, v_sku_id_item
  from compra_items where id = new.compra_item_id;

  if v_compra_id_item is distinct from v_compra_id_recepcion then
    raise exception 'El item de compra no pertenece a la misma compra que la recepcion';
  end if;

  if new.sku_id is distinct from v_sku_id_item then
    raise exception 'El sku del item de recepcion no coincide con el del item de compra';
  end if;

  if new.diferencia is distinct from (case when tg_op = 'UPDATE' then old.diferencia else null end) then
    if coalesce(current_setting('bebidas_moe.recepcion_en_curso', true), 'off') <> 'on' then
      raise exception 'La diferencia la calcula el sistema al confirmar la recepcion';
    end if;
  end if;

  return new;
end;
$$;

create trigger recepcion_items_validar_edicion
  before insert or update or delete on recepcion_items
  for each row
  execute function validar_edicion_recepcion_items();

-- =========================================================
-- historial_costos: inmutable, solo lo inserta confirmar_recepcion()
-- =========================================================

create or replace function bloquear_escritura_directa_historial_costos()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception
      'historial_costos es inmutable: una fila por lote recibido, nunca se sobrescribe';
  end if;

  if coalesce(current_setting('bebidas_moe.recepcion_en_curso', true), 'off') <> 'on' then
    raise exception 'historial_costos solo se inserta al confirmar una recepcion';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger historial_costos_bloquear_escritura_directa
  before insert or update or delete on historial_costos
  for each row
  execute function bloquear_escritura_directa_historial_costos();

-- =========================================================
-- confirmar_recepcion(): unico camino para que una recepcion mueva stock
-- =========================================================
-- Por cada linea: calcula la diferencia contra lo ya recibido en
-- recepciones previas de la misma compra (recepciones 'recibida'
-- anteriores -- las 'tandas'), exige motivo si hay diferencia, registra la
-- entrada de stock via registrar_movimiento(), guarda el lote en
-- historial_costos y actualiza skus.costo_actual. Al final marca la
-- recepcion 'recibida' y cierra la compra sola si ya no queda nada
-- pendiente en ninguna linea.

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
           ci.cantidad as cantidad_pedida, ci.costo_unitario
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

      insert into historial_costos (sku_id, proveedor_id, recepcion_id, costo_unitario, cantidad, fecha)
      values (v_item.sku_id, v_proveedor_id, p_recepcion_id, v_item.costo_unitario, v_item.cantidad_recibida, now());

      update skus set costo_actual = v_item.costo_unitario where id = v_item.sku_id;
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
-- RLS
-- =========================================================
-- Todo el bloque gateado por ve_costos() (dueño + encargado de Olavarria):
-- misma poblacion que las filas "Costos", "Proveedores" y "Compras a
-- proveedor" de la matriz de 1.11. El encargado de Laprida no compra a
-- proveedores y no ve costos, asi que no tiene ni lectura aca.

alter table proveedores enable row level security;
alter table proveedor_skus enable row level security;
alter table compras enable row level security;
alter table compra_items enable row level security;
alter table recepciones_compra enable row level security;
alter table recepcion_items enable row level security;
alter table historial_costos enable row level security;

create policy proveedores_select on proveedores for select using (ve_costos());
create policy proveedores_insert on proveedores for insert with check (ve_costos());
create policy proveedores_update on proveedores for update using (ve_costos()) with check (ve_costos());
create policy proveedores_delete on proveedores for delete using (ve_costos());

create policy proveedor_skus_select on proveedor_skus for select using (ve_costos());
create policy proveedor_skus_insert on proveedor_skus for insert with check (ve_costos());
create policy proveedor_skus_update on proveedor_skus for update using (ve_costos()) with check (ve_costos());
create policy proveedor_skus_delete on proveedor_skus for delete using (ve_costos());

create policy compras_select on compras for select using (ve_costos());

create policy compras_insert on compras for insert
  with check (ve_costos() and estado = 'borrador' and usuario_id = auth.uid());

create policy compras_update on compras for update
  using (ve_costos())
  with check (ve_costos());

create policy compras_delete on compras for delete
  using (ve_costos() and estado = 'borrador');

create policy compra_items_select on compra_items for select using (ve_costos());
create policy compra_items_insert on compra_items for insert with check (ve_costos());
create policy compra_items_update on compra_items for update using (ve_costos()) with check (ve_costos());
create policy compra_items_delete on compra_items for delete using (ve_costos());

create policy recepciones_compra_select on recepciones_compra for select using (ve_costos());

create policy recepciones_compra_insert on recepciones_compra for insert
  with check (ve_costos() and estado = 'pendiente' and usuario_id = auth.uid());

create policy recepciones_compra_delete on recepciones_compra for delete
  using (ve_costos() and estado = 'pendiente');

-- sin update policy: la transicion pendiente -> recibida es exclusiva de
-- confirmar_recepcion() (SECURITY DEFINER, bypassea RLS).

create policy recepcion_items_select on recepcion_items for select using (ve_costos());
create policy recepcion_items_insert on recepcion_items for insert with check (ve_costos());
create policy recepcion_items_update on recepcion_items for update using (ve_costos()) with check (ve_costos());
create policy recepcion_items_delete on recepcion_items for delete using (ve_costos());

create policy historial_costos_select on historial_costos for select using (ve_costos());

-- sin insert/update/delete policy: solo lo escribe confirmar_recepcion().

-- =========================================================
-- Permisos base (ver notas del entorno en CLAUDE.md)
-- =========================================================
-- select: todas las tablas nuevas, RLS decide que filas se ven.
-- insert/update/delete: solo las tablas que la app escribe en forma
-- directa (proveedores, la carga de una compra en borrador, sus items, y
-- el staging de una recepcion pendiente con sus items). RLS sigue
-- decidiendo cuando esa escritura es valida (estado, ve_costos(), etc.).
--
-- recepciones_compra NO recibe grant de update: no tiene politica de
-- update (ver arriba), la transicion pendiente -> recibida es exclusiva de
-- confirmar_recepcion(), que corre SECURITY DEFINER como dueño de la tabla
-- y no necesita este grant.
--
-- historial_costos NO recibe insert/update/delete: es inmutable y solo la
-- escribe confirmar_recepcion(), nunca la app directo.

grant select on all tables in schema public to authenticated;

grant insert, update, delete on proveedores to authenticated;
grant insert, update, delete on proveedor_skus to authenticated;
grant insert, update, delete on compras to authenticated;
grant insert, update, delete on compra_items to authenticated;
grant insert, delete on recepciones_compra to authenticated;
grant insert, update, delete on recepcion_items to authenticated;
