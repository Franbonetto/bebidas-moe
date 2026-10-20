-- Bloque: paso de ARCA de homologación a producción (2026-10-20).
--
-- El cache del Ticket de Acceso de WSAA (arca_ta_cache, creada en
-- 20260906090000_arca_facturacion.sql) tenía como clave primaria solo el
-- `servicio`. Eso alcanzaba mientras existiera un único ambiente, pero
-- hace peligroso el cambio de homologación a producción: el Token+Sign
-- vive 12hs, así que después de cambiar ARCA_ENTORNO el sistema seguiría
-- mandando a los servidores reales de ARCA un token emitido por
-- homologación, y toda emisión fallaría con un error de autenticación
-- hasta que caducara solo.
--
-- El TA es de un ambiente, no del servicio nada más: la clave pasa a ser
-- (entorno, servicio). Con eso se puede volver a homologación a probar
-- algo sin pisar el token de producción, y al revés.
--
-- La tabla se recrea en vez de alterarse: es un cache puro (lo único que
-- guarda es un token que ARCA vuelve a emitir cuando se le pide), no hay
-- historia que preservar, y vaciarla es justamente lo que hace falta para
-- cortar el token de homologación que haya quedado vivo.
--
-- Permisos: igual que antes -- RLS habilitada SIN políticas ni grants
-- para `authenticated`. Solo la tocan arca_leer_ta()/arca_guardar_ta()
-- (SECURITY DEFINER), que corren como dueñas de la tabla (CLAUDE.md:
-- "solo una función SECURITY DEFINER la escribe, no lleva grant").

drop table if exists arca_ta_cache;

create table arca_ta_cache (
  -- Los mismos dos valores que acepta EntornoArca en lib/arca/env.ts.
  entorno text not null check (entorno in ('homologacion', 'produccion')),
  servicio text not null,
  token text not null,
  sign text not null,
  expira_en timestamptz not null,
  primary key (entorno, servicio)
);

alter table arca_ta_cache enable row level security;

-- =========================================================
-- arca_leer_ta() / arca_guardar_ta(): ahora por ambiente.
--
-- Las versiones de un solo parámetro se dropean a propósito: dejarlas
-- vivas sería dejar un camino por el que la app podría volver a leer un
-- token sin saber de qué ambiente es, que es exactamente el problema que
-- esta migración viene a cerrar.
-- =========================================================

drop function if exists arca_leer_ta(text);
drop function if exists arca_guardar_ta(text, text, text, timestamptz);

create or replace function arca_leer_ta(p_entorno text, p_servicio text)
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
  where t.entorno = p_entorno
    and t.servicio = p_servicio;
end;
$$;

create or replace function arca_guardar_ta(
  p_entorno text,
  p_servicio text,
  p_token text,
  p_sign text,
  p_expira_en timestamptz
)
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

  -- El check de la tabla ya lo cubre, pero fallar acá da un mensaje
  -- entendible en vez de una violación de constraint.
  if p_entorno not in ('homologacion', 'produccion') then
    raise exception 'Entorno de ARCA invalido: %', p_entorno;
  end if;

  insert into arca_ta_cache (entorno, servicio, token, sign, expira_en)
  values (p_entorno, p_servicio, p_token, p_sign, p_expira_en)
  on conflict (entorno, servicio) do update set
    token = excluded.token,
    sign = excluded.sign,
    expira_en = excluded.expira_en;
end;
$$;
