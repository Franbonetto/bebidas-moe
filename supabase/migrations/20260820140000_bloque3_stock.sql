-- Bloque 3: nucleo de stock (stock_sucursal, movimientos_stock) + funciones
-- de base de datos + bloqueo de escritura directa.
-- Ver docs/arquitectura.md, secciones 1.2 (regla fundamental de stock),
-- 1.3 (desarme de packs) y 2.3 (stock y movimientos).
--
-- stock_transito queda para el bloque 7: necesita FK a transferencias, que
-- todavia no existe. Crearla ahora sin esa FK dejaria una tabla a medias
-- que hay que arreglar despues.

-- =========================================================
-- Tablas
-- =========================================================

create table stock_sucursal (
  sku_id uuid not null references skus (id),
  sucursal_id uuid not null references sucursales (id),
  -- Sin cantidad >= 0 a proposito: el POS permite vender sin stock
  -- (arquitectura.md 1.8, "sin stock: permite vender, advierte, marca para
  -- revision"), asi que la cantidad puede quedar negativa hasta que se
  -- ajuste con un conteo. No es un error de datos, es el flujo real.
  cantidad integer not null default 0,
  primary key (sku_id, sucursal_id)
);

create index stock_sucursal_sucursal_id_idx on stock_sucursal (sucursal_id);

create table movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references skus (id),
  sucursal_id uuid not null references sucursales (id),
  tipo text not null check (tipo in (
    'compra', 'venta', 'transferencia_salida', 'transferencia_entrada',
    'ajuste', 'merma', 'devolucion_entrada',
    'desarme_salida', 'desarme_entrada'
  )),
  -- Con signo: entrada positiva, salida negativa. Quien llama a
  -- registrar_movimiento() nunca pasa esto directamente para los tipos
  -- fijos (compra, venta, etc.) -- lo calcula la funcion segun el tipo.
  -- Unica excepcion: 'ajuste', que puede ir para cualquier lado y por eso
  -- el llamador pasa el delta ya firmado.
  cantidad integer not null check (cantidad <> 0),
  stock_anterior integer not null,
  stock_posterior integer not null,
  check (stock_posterior = stock_anterior + cantidad),
  usuario_id uuid not null references usuarios (id),
  fecha timestamptz not null default now(),
  motivo text,
  -- Referencia polimorfica al origen (compra, venta, transferencia,
  -- inventario, desarme...). Sin FK real: los modulos destino todavia no
  -- existen (compras es bloque 4, ventas bloque 6, etc.). Se valida en la
  -- app hasta que existan esas tablas.
  documento_tipo text,
  documento_id uuid,
  check ((documento_tipo is null) = (documento_id is null))
);

create index movimientos_stock_sku_sucursal_idx
  on movimientos_stock (sku_id, sucursal_id);
create index movimientos_stock_documento_idx
  on movimientos_stock (documento_tipo, documento_id);
create index movimientos_stock_fecha_idx on movimientos_stock (fecha);

-- =========================================================
-- Bloqueo de escritura directa
-- =========================================================
-- RLS sin politicas de insert/update/delete ya bloquea a anon/authenticated
-- (mismo patron de los bloques 1 y 2), pero no alcanza contra service_role
-- (bypassea RLS por diseño de Supabase) ni contra un superusuario que se
-- conecte por error. La regla 1 de CLAUDE.md no admite ese hueco: "no
-- alcanza con 'no lo hacemos', tiene que estar bloqueado a nivel base de
-- datos". Por eso el bloqueo real es un trigger que rechaza siempre, salvo
-- que exista una marca de sesion que solo prenden registrar_movimiento() y
-- desarmar_sku() (via registrar_movimiento) justo antes de escribir. Los
-- triggers corren para cualquier rol, incluido el dueño de la tabla, asi
-- que no tienen el mismo hueco que RLS.

create or replace function bloquear_escritura_directa_stock_sucursal()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.movimiento_en_curso', true), 'off') <> 'on' then
    raise exception
      'stock_sucursal solo se modifica a traves de registrar_movimiento()';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger stock_sucursal_bloquear_escritura_directa
  before insert or update or delete on stock_sucursal
  for each row
  execute function bloquear_escritura_directa_stock_sucursal();

-- movimientos_stock: el insert tambien pasa solo por la funcion (misma
-- marca de sesion), pero update/delete se rechazan siempre, sin excepcion
-- -- ni siquiera la funcion los usa. Los movimientos son inmutables
-- (CLAUDE.md regla 2): para corregir se genera un movimiento de ajuste
-- nuevo, nunca se toca uno viejo.

create or replace function bloquear_escritura_directa_movimientos_stock()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception
      'movimientos_stock es inmutable: no se edita ni se borra un movimiento historico';
  end if;

  if coalesce(current_setting('bebidas_moe.movimiento_en_curso', true), 'off') <> 'on' then
    raise exception
      'movimientos_stock solo se inserta a traves de registrar_movimiento()';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger movimientos_stock_bloquear_escritura_directa
  before insert or update or delete on movimientos_stock
  for each row
  execute function bloquear_escritura_directa_movimientos_stock();

-- =========================================================
-- registrar_movimiento(): unico camino para cambiar stock
-- =========================================================
-- Inserta el movimiento y actualiza stock_sucursal en la misma
-- transaccion. SECURITY DEFINER: corre como dueño de las tablas (postgres),
-- que por default esta exento de RLS sobre ellas (mismo mecanismo que los
-- bloques 1 y 2 usan para evitar recursion de RLS) -- por eso puede
-- escribir aunque no exista ninguna politica de insert/update.
--
-- p_cantidad es una MAGNITUD POSITIVA para todos los tipos salvo 'ajuste':
-- el signo lo decide el tipo de movimiento, no quien llama. Asi el POS,
-- las compras, las transferencias, etc. nunca tienen que acordarse de
-- poner el signo -- menos margen de error.

create or replace function registrar_movimiento(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo text default null,
  p_documento_tipo text default null,
  p_documento_id uuid default null
)
returns movimientos_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signo integer;
  v_delta integer;
  v_stock_anterior integer;
  v_stock_posterior integer;
  v_movimiento movimientos_stock;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para modificar stock de esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad = 0 then
    raise exception 'La cantidad debe ser distinta de cero';
  end if;

  if not exists (select 1 from skus where id = p_sku_id) then
    raise exception 'El SKU % no existe', p_sku_id;
  end if;

  if not exists (select 1 from sucursales where id = p_sucursal_id) then
    raise exception 'La sucursal % no existe', p_sucursal_id;
  end if;

  v_signo := case p_tipo
    when 'compra' then 1
    when 'transferencia_entrada' then 1
    when 'devolucion_entrada' then 1
    when 'desarme_entrada' then 1
    when 'venta' then -1
    when 'transferencia_salida' then -1
    when 'merma' then -1
    when 'desarme_salida' then -1
    when 'ajuste' then null
    else null
  end;

  if v_signo is null and p_tipo <> 'ajuste' then
    raise exception 'Tipo de movimiento invalido: %', p_tipo;
  end if;

  if p_tipo = 'ajuste' then
    -- unico tipo donde el delta viene firmado: un ajuste puede sumar o
    -- restar segun lo que haya dado el conteo fisico.
    v_delta := p_cantidad;
  else
    if p_cantidad < 0 then
      raise exception
        'Para el tipo % la cantidad se pasa en positivo (magnitud); el signo lo determina el sistema',
        p_tipo;
    end if;
    v_delta := v_signo * p_cantidad;
  end if;

  perform set_config('bebidas_moe.movimiento_en_curso', 'on', true);

  -- Garantiza que exista la fila antes de lockearla. on conflict do nothing
  -- para no pisar la cantidad si ya existia.
  insert into stock_sucursal (sku_id, sucursal_id, cantidad)
  values (p_sku_id, p_sucursal_id, 0)
  on conflict (sku_id, sucursal_id) do nothing;

  -- Lockea la fila para que dos movimientos concurrentes sobre el mismo
  -- sku/sucursal no calculen stock_anterior con el mismo valor viejo.
  select cantidad into v_stock_anterior
  from stock_sucursal
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id
  for update;

  v_stock_posterior := v_stock_anterior + v_delta;

  update stock_sucursal
  set cantidad = v_stock_posterior
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id;

  insert into movimientos_stock (
    sku_id, sucursal_id, tipo, cantidad, stock_anterior, stock_posterior,
    usuario_id, motivo, documento_tipo, documento_id
  ) values (
    p_sku_id, p_sucursal_id, p_tipo, v_delta, v_stock_anterior, v_stock_posterior,
    auth.uid(), p_motivo, p_documento_tipo, p_documento_id
  )
  returning * into v_movimiento;

  perform set_config('bebidas_moe.movimiento_en_curso', 'off', true);

  return v_movimiento;
end;
$$;

-- =========================================================
-- desarmar_sku(): cascada de desarme (arquitectura.md 1.3)
-- =========================================================
-- Un solo nivel por llamada (x24 -> x6, no encadena solo hasta unidad):
-- el desarme es una decision humana repetida en el POS, no una cascada
-- automatica de la base de datos. Genera un par de movimientos atomicos
-- (salida del contenedor, entrada del contenido) con el mismo
-- documento_id para poder rastrearlos juntos. Atomico porque es una sola
-- funcion: si la segunda llamada a registrar_movimiento() falla, Postgres
-- revierte la primera tambien.

create or replace function desarmar_sku(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_motivo text default null
)
returns setof movimientos_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desarma_en_sku_id uuid;
  v_desarma_en_cantidad integer;
  v_documento_id uuid;
  v_salida movimientos_stock;
  v_entrada movimientos_stock;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a desarmar debe ser positiva';
  end if;

  select desarma_en_sku_id, desarma_en_cantidad
  into v_desarma_en_sku_id, v_desarma_en_cantidad
  from skus
  where id = p_sku_id;

  if not found then
    raise exception 'El SKU % no existe', p_sku_id;
  end if;

  if v_desarma_en_sku_id is null then
    raise exception 'El SKU % no es desarmable', p_sku_id;
  end if;

  v_documento_id := gen_random_uuid();

  v_salida := registrar_movimiento(
    p_sku_id => p_sku_id,
    p_sucursal_id => p_sucursal_id,
    p_tipo => 'desarme_salida',
    p_cantidad => p_cantidad,
    p_motivo => p_motivo,
    p_documento_tipo => 'desarme',
    p_documento_id => v_documento_id
  );

  v_entrada := registrar_movimiento(
    p_sku_id => v_desarma_en_sku_id,
    p_sucursal_id => p_sucursal_id,
    p_tipo => 'desarme_entrada',
    p_cantidad => p_cantidad * v_desarma_en_cantidad,
    p_motivo => p_motivo,
    p_documento_tipo => 'desarme',
    p_documento_id => v_documento_id
  );

  return next v_salida;
  return next v_entrada;
end;
$$;

-- =========================================================
-- RLS
-- =========================================================
-- Lectura: cualquier usuario activo ve el stock de las dos sucursales
-- (arquitectura.md 1.11: "stock otra sucursal: lectura" para ambos
-- encargados -- lo necesitan para pedidos, dashboards, etc.). Sin
-- politicas de insert/update/delete: la escritura pasa exclusivamente por
-- las funciones de arriba (que la sortean por ser SECURITY DEFINER de un
-- dueño exento de RLS), reforzado por los triggers de bloqueo.

alter table stock_sucursal enable row level security;
alter table movimientos_stock enable row level security;

create policy stock_sucursal_select on stock_sucursal
  for select
  using (usuario_activo());

create policy movimientos_stock_select on movimientos_stock
  for select
  using (usuario_activo());
