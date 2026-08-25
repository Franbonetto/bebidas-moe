-- Bloque 8: inventarios fisicos (general, por categoria, puntual).
-- Ver docs/arquitectura.md, secciones 1.9 (inventarios fisicos) y 2.9
-- (modelo de datos).
--
-- Decision de implementacion (no de negocio, confirmada en conversacion):
-- el bloque 6 (POS/ventas) todavia no existe, asi que no hay ningun lugar
-- que "marque" hoy un SKU por venderse con stock en cero. En vez de sumar
-- un flag mutable que el POS tendria que acordarse de prender/apagar, la
-- lista sugerida de conteo puntual (sugerir_conteo_puntual()) se DERIVA de
-- movimientos_stock (bloque 3, ya existe): un SKU entra si tiene un
-- movimiento tipo='venta' con stock_anterior <= 0 que todavia no fue
-- cubierto por un inventario cerrado posterior. El dia que exista el POS,
-- alcanza con que registre la venta normal via registrar_movimiento() --
-- cero trabajo adicional ahi, y es mas trazable que un flag aparte.
--
-- Segunda decision de implementacion: iniciar_inventario() rechaza abrir un
-- inventario si ya hay uno abierto en la misma sucursal (sin importar la
-- modalidad). No es una regla de negocio de arquitectura.md, es una guarda
-- tecnica: si dos inventarios abiertos llegaran a cubrir el mismo SKU, cada
-- uno generaria su propio ajuste desde su propia foto de stock_sistema al
-- confirmar, duplicando (o pisando) el mismo ajuste fisico. Uno a la vez
-- por sucursal lo evita sin tener que razonar sobre solapamiento de SKU.
--
-- Mismo criterio de "quien escribe cada tabla" que pedidos/transferencias
-- (bloque 7): inventarios/inventario_items se escriben EXCLUSIVAMENTE via
-- las funciones SECURITY DEFINER de abajo (iniciar_inventario(),
-- guardar_conteo(), confirmar_inventario()) -- no hay fase de "borrador"
-- editable libremente por la app como en pedidos, asi que no hace falta
-- una politica de escritura RLS: alcanza con no dar ningun grant de
-- insert/update/delete, mismo patron que transferencias/transferencia_items.
-- Eso tambien resuelve gratis el "inventario cerrado queda inmutable"
-- (CLAUDE.md, docs 1.9): las funciones ya chequean estado = 'abierto'.

-- =========================================================
-- Tablas
-- =========================================================

create table inventarios (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales (id),
  tipo text not null check (tipo in ('general', 'categoria', 'puntual')),
  -- Solo aplica (y es obligatoria) para tipo = 'categoria'.
  categoria_id uuid references categorias (id),
  check ((tipo = 'categoria') = (categoria_id is not null)),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  fecha_inicio timestamptz not null default now(),
  fecha_fin timestamptz,
  usuario_id uuid not null references usuarios (id)
);

create index inventarios_sucursal_id_idx on inventarios (sucursal_id);
create index inventarios_estado_idx on inventarios (estado);

create table inventario_items (
  id uuid primary key default gen_random_uuid(),
  inventario_id uuid not null references inventarios (id) on delete cascade,
  sku_id uuid not null references skus (id),
  -- Foto del stock al iniciar (arquitectura.md 1.9). No se vuelve a tocar.
  stock_sistema integer not null,
  -- NULL mientras el encargado todavia no paso por este SKU.
  stock_contado integer check (stock_contado is null or stock_contado >= 0),
  -- Columna generada (no una que la app pueda pisar): asi el gate de
  -- confirmar_inventario() y la sugerencia de motivo en guardar_conteo()
  -- siempre leen el mismo numero que ve el encargado en pantalla.
  diferencia integer generated always as (stock_contado - stock_sistema) stored,
  -- Vocabulario cerrado de arquitectura.md 1.9. NULL mientras no hace
  -- falta (sin diferencia) o todavia no se cargo.
  motivo text check (
    motivo is null
    or motivo in ('rotura', 'robo', 'error_carga', 'error_conteo_previo', 'vencimiento', 'desconocido')
  ),
  -- Lo completa confirmar_inventario() con el ajuste que genero esta fila.
  movimiento_ajuste_id uuid references movimientos_stock (id),
  unique (inventario_id, sku_id)
);

create index inventario_items_inventario_id_idx on inventario_items (inventario_id);
create index inventario_items_sku_id_idx on inventario_items (sku_id);

-- =========================================================
-- iniciar_inventario(): crea la cabecera y saca la foto del stock actual
-- para los SKU que correspondan segun la modalidad (arquitectura.md 1.9).
-- =========================================================

create or replace function iniciar_inventario(
  p_sucursal_id uuid,
  p_tipo text,
  p_categoria_id uuid default null,
  p_sku_ids uuid[] default null
)
returns inventarios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventario inventarios;
  v_filas integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para inventariar esta sucursal';
  end if;

  if p_tipo not in ('general', 'categoria', 'puntual') then
    raise exception 'Tipo de inventario invalido: %', p_tipo;
  end if;

  if p_tipo = 'categoria' and p_categoria_id is null then
    raise exception 'El inventario por categoria necesita una categoria';
  end if;

  if p_tipo <> 'categoria' and p_categoria_id is not null then
    raise exception 'categoria_id solo aplica al inventario por categoria';
  end if;

  if p_tipo = 'puntual' and (p_sku_ids is null or array_length(p_sku_ids, 1) is null) then
    raise exception 'El inventario puntual necesita al menos un producto elegido';
  end if;

  if exists (
    select 1 from inventarios
    where sucursal_id = p_sucursal_id and estado = 'abierto'
  ) then
    raise exception 'Ya hay un inventario abierto para esta sucursal, hay que cerrarlo antes de iniciar otro';
  end if;

  insert into inventarios (sucursal_id, tipo, categoria_id, usuario_id)
  values (p_sucursal_id, p_tipo, p_categoria_id, auth.uid())
  returning * into v_inventario;

  if p_tipo = 'general' then
    insert into inventario_items (inventario_id, sku_id, stock_sistema)
    select v_inventario.id, s.id, coalesce(ss.cantidad, 0)
    from skus s
    left join stock_sucursal ss on ss.sku_id = s.id and ss.sucursal_id = p_sucursal_id
    where s.activo = true;
  elsif p_tipo = 'categoria' then
    insert into inventario_items (inventario_id, sku_id, stock_sistema)
    select v_inventario.id, s.id, coalesce(ss.cantidad, 0)
    from skus s
    join productos pr on pr.id = s.producto_id
    left join stock_sucursal ss on ss.sku_id = s.id and ss.sucursal_id = p_sucursal_id
    where s.activo = true and pr.categoria_id = p_categoria_id;
  else
    insert into inventario_items (inventario_id, sku_id, stock_sistema)
    select v_inventario.id, s.id, coalesce(ss.cantidad, 0)
    from (select distinct unnest(p_sku_ids) as sku_id) x
    join skus s on s.id = x.sku_id
    left join stock_sucursal ss on ss.sku_id = s.id and ss.sucursal_id = p_sucursal_id;
  end if;

  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'No hay productos para inventariar con esos criterios';
  end if;

  return v_inventario;
end;
$$;

-- =========================================================
-- guardar_conteo(): carga/actualiza el stock contado, se puede llamar
-- muchas veces mientras el inventario sigue abierto (autosave a medida
-- que el encargado camina el deposito). El motivo recien se exige al
-- confirmar (confirmar_inventario()), no aca.
-- =========================================================

create or replace function guardar_conteo(p_inventario_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_sucursal_id uuid;
  v_item record;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select estado, sucursal_id into v_estado, v_sucursal_id
  from inventarios where id = p_inventario_id
  for update;

  if not found then
    raise exception 'El inventario no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para cargar el conteo de esta sucursal';
  end if;

  if v_estado <> 'abierto' then
    raise exception 'Este inventario ya esta cerrado, no se puede modificar';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(sku_id uuid, stock_contado integer, motivo text)
  loop
    if v_item.stock_contado is null or v_item.stock_contado < 0 then
      raise exception 'El stock contado no puede ser negativo';
    end if;

    if v_item.motivo is not null and v_item.motivo not in (
      'rotura', 'robo', 'error_carga', 'error_conteo_previo', 'vencimiento', 'desconocido'
    ) then
      raise exception 'Motivo invalido: %', v_item.motivo;
    end if;

    update inventario_items
    set stock_contado = v_item.stock_contado,
        -- Si el nuevo conteo ya no difiere del sistema, se descarta
        -- cualquier motivo que hubiera quedado de una carga anterior.
        motivo = case when v_item.stock_contado <> stock_sistema then v_item.motivo else null end
    where inventario_id = p_inventario_id and sku_id = v_item.sku_id;

    if not found then
      raise exception 'El sku % no pertenece a este inventario', v_item.sku_id;
    end if;
  end loop;
end;
$$;

-- =========================================================
-- confirmar_inventario(): exige conteo y motivo completos, genera un
-- ajuste por cada diferencia via registrar_movimiento() y cierra el
-- inventario (queda inmutable -- arquitectura.md 1.9).
-- =========================================================

create or replace function confirmar_inventario(p_inventario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_sucursal_id uuid;
  v_sin_contar integer;
  v_sin_motivo integer;
  v_item record;
  v_movimiento movimientos_stock;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select estado, sucursal_id into v_estado, v_sucursal_id
  from inventarios where id = p_inventario_id
  for update;

  if not found then
    raise exception 'El inventario no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para confirmar el inventario de esta sucursal';
  end if;

  if v_estado <> 'abierto' then
    raise exception 'Este inventario ya esta cerrado';
  end if;

  select count(*) into v_sin_contar
  from inventario_items where inventario_id = p_inventario_id and stock_contado is null;

  if v_sin_contar > 0 then
    raise exception 'Falta cargar el conteo de % producto(s)', v_sin_contar;
  end if;

  select count(*) into v_sin_motivo
  from inventario_items
  where inventario_id = p_inventario_id and diferencia <> 0 and motivo is null;

  if v_sin_motivo > 0 then
    raise exception 'Falta el motivo de % producto(s) con diferencia', v_sin_motivo;
  end if;

  for v_item in
    select * from inventario_items where inventario_id = p_inventario_id and diferencia <> 0
  loop
    v_movimiento := registrar_movimiento(
      p_sku_id => v_item.sku_id,
      p_sucursal_id => v_sucursal_id,
      p_tipo => 'ajuste',
      p_cantidad => v_item.diferencia,
      p_motivo => v_item.motivo,
      p_documento_tipo => 'inventario',
      p_documento_id => p_inventario_id
    );

    update inventario_items
    set movimiento_ajuste_id = v_movimiento.id
    where id = v_item.id;
  end loop;

  update inventarios
  set estado = 'cerrado', fecha_fin = now()
  where id = p_inventario_id;
end;
$$;

-- =========================================================
-- sugerir_conteo_puntual(): SKU que se vendieron con stock en cero (o
-- negativo) y todavia no fueron recontados por un inventario cerrado
-- posterior (arquitectura.md 1.9, "alimentan la lista de conteo puntual
-- sugerido"). Ver nota de diseño al principio del archivo: se deriva de
-- movimientos_stock en vez de un flag aparte.
-- =========================================================

create or replace function sugerir_conteo_puntual(p_sucursal_id uuid)
returns table (
  sku_id uuid,
  fecha_venta timestamptz,
  stock_actual integer
)
language plpgsql
stable
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para ver la sugerencia de conteo de esta sucursal';
  end if;

  return query
  select distinct on (m.sku_id)
    m.sku_id,
    m.fecha,
    coalesce(ss.cantidad, 0)
  from movimientos_stock m
  left join stock_sucursal ss on ss.sku_id = m.sku_id and ss.sucursal_id = p_sucursal_id
  where m.sucursal_id = p_sucursal_id
    and m.tipo = 'venta'
    and m.stock_anterior <= 0
    and not exists (
      select 1
      from inventario_items ii
      join inventarios inv on inv.id = ii.inventario_id
      where inv.sucursal_id = p_sucursal_id
        and inv.estado = 'cerrado'
        and ii.sku_id = m.sku_id
        and inv.fecha_fin >= m.fecha
    )
  order by m.sku_id, m.fecha desc;
end;
$$;

-- =========================================================
-- RLS y permisos (ver notas del entorno en CLAUDE.md)
-- =========================================================
-- inventarios/inventario_items: sin politicas de insert/update/delete y sin
-- esos grants -- escritura exclusiva de iniciar_inventario()/
-- guardar_conteo()/confirmar_inventario() (SECURITY DEFINER, dueños de las
-- tablas). Mismo criterio que transferencias/transferencia_items en el
-- bloque 7: no hay fase de "borrador" que la app edite directo, asi que no
-- hace falta politica de escritura -- eso ademas es lo que deja el
-- inventario cerrado inmutable sin necesidad de un trigger aparte.

alter table inventarios enable row level security;
alter table inventario_items enable row level security;

create policy inventarios_select on inventarios for select using (usuario_activo());
create policy inventario_items_select on inventario_items for select using (usuario_activo());

grant select on all tables in schema public to authenticated;
