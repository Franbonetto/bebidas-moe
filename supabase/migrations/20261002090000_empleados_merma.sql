-- Empleados: quién registró la merma, más allá de con qué usuario se
-- logueó.
--
-- Pedido del usuario 2026-09-28: en el mostrador comparten la sesión del
-- encargado, así que mermas.usuario_id dice "encargado de Olavarría" y no
-- sirve para lo único que importa acá -- saber quién dijo que se rompió.
--
-- Empleado NO es usuario del sistema: no tiene login, no tiene permisos, no
-- entra a ninguna pantalla. Es un nombre para atribuir lo que se carga desde
-- un mostrador compartido. Por eso tabla aparte y no un rol nuevo en
-- `usuarios`.
--
-- Va en tabla y no como lista fija en el código porque en un local la gente
-- entra y sale: agregar o dar de baja a alguien tiene que ser una fila, no
-- un deploy.

begin;

create table empleados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  sucursal_id uuid not null references sucursales (id),
  -- Baja lógica: si alguien se va, sus mermas viejas tienen que seguir
  -- diciendo quién fue (mismo criterio que proveedores.activo).
  activo boolean not null default true,
  unique (sucursal_id, nombre)
);

create index empleados_sucursal_id_idx on empleados (sucursal_id);

alter table empleados enable row level security;

-- Lectura: quien opera esa sucursal (el dueño, las dos). Es lo que llena el
-- desplegable al registrar una merma.
create policy empleados_select on empleados for select using (opera_sucursal(sucursal_id));

-- Altas y bajas: solo el dueño. Quién trabaja en el local no lo decide el
-- encargado (mismo criterio que la administración de usuarios, CLAUDE.md).
create policy empleados_insert on empleados for insert with check (es_dueno());
create policy empleados_update on empleados for update using (es_dueno()) with check (es_dueno());
create policy empleados_delete on empleados for delete using (es_dueno());

-- =========================================================
-- Carga inicial de la gente que trabaja hoy (usuario 2026-09-28)
-- =========================================================
-- Se resuelve la sucursal por es_central, no por nombre hardcodeado, mismo
-- criterio que el resto del sistema. Francisco y Lucas trabajan en las dos,
-- así que tienen una fila en cada una.

insert into empleados (nombre, sucursal_id)
select nombre, s.id
from sucursales s
cross join (values ('Macarena'), ('Rocío'), ('Andrea'), ('Francisco'), ('Lucas')) as gente(nombre)
where s.es_central = true
on conflict (sucursal_id, nombre) do nothing;

insert into empleados (nombre, sucursal_id)
select nombre, s.id
from sucursales s
cross join (values ('Morena'), ('Mono'), ('Lucas'), ('Francisco')) as gente(nombre)
where s.es_central = false
on conflict (sucursal_id, nombre) do nothing;

-- =========================================================
-- mermas.empleado_id
-- =========================================================
-- Nullable en la tabla para no invalidar las mermas ya cargadas (no hay
-- forma de saber retroactivamente quién fue), pero OBLIGATORIO de acá en
-- más: lo exige registrar_merma(), que es el único camino de escritura.

alter table mermas add column empleado_id uuid references empleados (id);

create index mermas_empleado_id_idx on mermas (empleado_id);

-- =========================================================
-- registrar_merma(): ahora con empleado
-- =========================================================
-- Se dropea la versión anterior en vez de sumar un parámetro con default:
-- con las dos vivas, PostgREST no puede resolver a cuál llamar. Y el
-- empleado no lleva default a propósito -- si fuera opcional, en una semana
-- estarían todas las mermas sin nombre y la pantalla no serviría para nada.

drop function if exists registrar_merma(uuid, uuid, integer, text, text);

create function registrar_merma(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_motivo text,
  p_empleado_id uuid,
  p_detalle text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merma_id uuid;
  v_detalle text;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para registrar mermas en esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor a cero';
  end if;

  if p_motivo is null or p_motivo not in ('rotura', 'vencido', 'consumo_interno', 'otro') then
    raise exception 'Motivo de merma invalido: %', coalesce(p_motivo, '(vacio)');
  end if;

  if p_empleado_id is null then
    raise exception 'Hay que indicar quién registra la merma';
  end if;

  -- El empleado tiene que ser de ESTA sucursal: si no, desde el mostrador
  -- de Laprida se podrían cargar mermas a nombre de alguien de Olavarría.
  if not exists (
    select 1 from empleados
    where id = p_empleado_id and sucursal_id = p_sucursal_id and activo = true
  ) then
    raise exception 'Ese empleado no trabaja en esta sucursal o está dado de baja';
  end if;

  v_detalle := nullif(trim(coalesce(p_detalle, '')), '');

  if p_motivo = 'otro' and v_detalle is null then
    raise exception 'Si el motivo es "otro", hay que explicar qué pasó';
  end if;

  if not exists (select 1 from skus where id = p_sku_id and activo = true) then
    raise exception 'El producto no existe o está dado de baja';
  end if;

  perform set_config('bebidas_moe.merma_en_curso', 'on', true);

  insert into mermas (sucursal_id, sku_id, cantidad, motivo, detalle, empleado_id, usuario_id)
  values (p_sucursal_id, p_sku_id, p_cantidad, p_motivo, v_detalle, p_empleado_id, auth.uid())
  returning id into v_merma_id;

  perform set_config('bebidas_moe.merma_en_curso', 'off', true);

  -- El nombre del empleado entra también en el motivo del movimiento: el
  -- histórico de cada SKU se lee sin tener que cruzar tablas a mano.
  perform registrar_movimiento(
    p_sku_id => p_sku_id,
    p_sucursal_id => p_sucursal_id,
    p_tipo => 'merma',
    p_cantidad => p_cantidad,
    p_motivo => (case p_motivo
      when 'rotura' then 'Rotura'
      when 'vencido' then 'Vencido'
      when 'consumo_interno' then 'Consumo interno'
      else 'Otro'
    end)
      || ' (' || (select nombre from empleados where id = p_empleado_id) || ')'
      || coalesce(': ' || v_detalle, ''),
    p_documento_tipo => 'merma',
    p_documento_id => v_merma_id
  );

  return v_merma_id;
end;
$$;

-- =========================================================
-- Permisos base (CLAUDE.md, notas del entorno)
-- =========================================================
-- empleados se escribe directo desde la app (políticas de insert/update/
-- delete para el dueño), así que lleva los tres grants: sin ellos la
-- política de RLS nunca llega a evaluarse.

grant select on all tables in schema public to authenticated;
grant insert, update, delete on empleados to authenticated;

commit;
