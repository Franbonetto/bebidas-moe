-- Bloque 1: usuarios, sucursales, usuario_sucursal + RLS
-- Ver docs/arquitectura.md, secciones 1.11 (roles y permisos) y 2.1 (usuarios y organizacion).

-- =========================================================
-- Tablas
-- =========================================================

create table sucursales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  direccion text,
  -- Olavarria funciona como deposito central de facto (arquitectura.md 1.1).
  -- Se modela como dato, no como nombre hardcodeado en las politicas: si la
  -- funcion de central cambia de sucursal, es un UPDATE, no una migracion.
  es_central boolean not null default false,
  activo boolean not null default true
);

create table usuarios (
  -- Mismo id que auth.users: no hay auto-registro, el dueno crea la cuenta
  -- de auth (con service role, fuera de RLS) y esta fila en el mismo paso.
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  email text not null unique,
  rol text not null check (rol in ('dueno', 'encargado')),
  activo boolean not null default true
);

create table usuario_sucursal (
  -- El dueno no necesita filas aca: opera_sucursal()/opera_central() le dan
  -- acceso total por rol. Un encargado puede tener mas de una fila (p. ej.
  -- si cubre las dos sucursales temporalmente) — no se restringe a una sola.
  usuario_id uuid not null references usuarios (id) on delete cascade,
  sucursal_id uuid not null references sucursales (id) on delete cascade,
  primary key (usuario_id, sucursal_id)
);

create index usuario_sucursal_sucursal_id_idx on usuario_sucursal (sucursal_id);

-- =========================================================
-- Funciones de permisos
-- =========================================================
-- Unica fuente de verdad de la matriz de 1.11. Las politicas de esta
-- migracion y las de todas las tablas de negocio que vengan despues llaman
-- a estas funciones en vez de reimplementar la logica.
--
-- SECURITY DEFINER + search_path fijo: corren con los permisos del dueno de
-- la funcion, no del que llama. Sin esto, una politica de RLS sobre
-- `usuarios` que consulte `usuarios` (para saber si sos dueno) dispara la
-- misma politica de nuevo -> recursion. Con SECURITY DEFINER, la consulta
-- interna de la funcion no pasa por RLS y la recursion no ocurre.

create or replace function usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from usuarios where id = auth.uid() and activo = true
  );
$$;

create or replace function es_dueno()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from usuarios
    where id = auth.uid() and rol = 'dueno' and activo = true
  );
$$;

create or replace function opera_sucursal(p_sucursal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    es_dueno()
    or exists (
      select 1
      from usuario_sucursal us
      join usuarios u on u.id = us.usuario_id
      where us.usuario_id = auth.uid()
        and us.sucursal_id = p_sucursal_id
        and u.activo = true
    );
$$;

create or replace function opera_central()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    es_dueno()
    or exists (
      select 1
      from usuario_sucursal us
      join usuarios u on u.id = us.usuario_id
      join sucursales s on s.id = us.sucursal_id
      where us.usuario_id = auth.uid()
        and u.activo = true
        and s.es_central = true
    );
$$;

-- Filas de la matriz de 1.11 que ya se pueden expresar con lo anterior.
-- No se usan todavia (las tablas de costos/compras/auditoria no existen
-- en este bloque) pero quedan definidas aca para que nadie las reinvente
-- distinto mas adelante.

create or replace function ve_costos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select es_dueno() or opera_central();
$$;

create or replace function ve_rentabilidad_global()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select es_dueno();
$$;

create or replace function gestiona_usuarios()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select es_dueno();
$$;

-- =========================================================
-- RLS
-- =========================================================

alter table sucursales enable row level security;
alter table usuarios enable row level security;
alter table usuario_sucursal enable row level security;

-- sucursales: cualquier usuario activo lee (necesario para selectores de
-- sucursal en toda la app); solo el dueno administra.

create policy sucursales_select on sucursales
  for select
  using (usuario_activo());

create policy sucursales_insert on sucursales
  for insert
  with check (es_dueno());

create policy sucursales_update on sucursales
  for update
  using (es_dueno())
  with check (es_dueno());

create policy sucursales_delete on sucursales
  for delete
  using (es_dueno());

-- usuarios: cualquier usuario activo ve a todos (nombre/rol no es dato
-- sensible y se necesita para mostrar "despachado por X", "preparado por Y",
-- etc. en toda la app). Solo el dueno gestiona altas/bajas/cambios (1.11:
-- "Usuarios" es exclusivo del dueno).

create policy usuarios_select on usuarios
  for select
  using (usuario_activo());

create policy usuarios_insert on usuarios
  for insert
  with check (es_dueno());

create policy usuarios_update on usuarios
  for update
  using (es_dueno())
  with check (es_dueno());

create policy usuarios_delete on usuarios
  for delete
  using (es_dueno());

-- usuario_sucursal: el dueno ve y administra todas las asignaciones; un
-- encargado ve solo las suyas.

create policy usuario_sucursal_select on usuario_sucursal
  for select
  using (es_dueno() or usuario_id = auth.uid());

create policy usuario_sucursal_insert on usuario_sucursal
  for insert
  with check (es_dueno());

create policy usuario_sucursal_update on usuario_sucursal
  for update
  using (es_dueno())
  with check (es_dueno());

create policy usuario_sucursal_delete on usuario_sucursal
  for delete
  using (es_dueno());

-- =========================================================
-- Seed
-- =========================================================

insert into sucursales (nombre, es_central) values
  ('Olavarría', true),
  ('Laprida', false);
