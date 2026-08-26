-- Bloque 9: circuito de envases retornables (stock_envases, movimientos_envases,
-- registrar_movimiento_envase()) + pantalla de gestion de envases.
-- Ver docs/arquitectura.md, secciones 1.1 (sucursales), 1.4 (retornables) y
-- 2.4 (modelo de datos). tipos_envase ya existe desde el bloque 2.
--
-- Decisiones de implementacion (no de negocio, no estaban en arquitectura.md
-- como tal, asi que no se improvisaron sin base -- se documentan aca, mismo
-- criterio que los bloques 7 y 8):
--
--   1. El bloque 6 (POS/ventas) todavia no existe (misma situacion que dejo
--      escrita el bloque 8). El toggle "con envase / sin envase" y el cobro
--      de deposito en la venta (arquitectura.md 1.4, 2.8 venta_items.con_envase
--      y ventas.deposito_envases) no tienen todavia una pantalla que los
--      dispare. Lo que se deja listo es la funcion de base de datos
--      (registrar_movimiento_envase(), con p_venta_id) para que el POS,
--      cuando exista, solo tenga que llamarla con tipo='ingreso_cliente' al
--      vender "con envase" -- cero trabajo adicional aca. "Sin envase" no
--      genera movimiento de envases (arquitectura.md 1.4: "cobra deposito,
--      sin cambio de vacios"), solo un cobro que le corresponde a la venta,
--      no a este circuito.
--   2. venta_id en movimientos_envases queda sin FK por el mismo motivo que
--      documento_id en movimientos_stock (bloque 3): la tabla ventas todavia
--      no existe. Se agrega la FK real cuando se construya el bloque 6.
--   3. Devolucion al proveedor solo desde la sucursal central (Olavarria):
--      no esta en el texto de arquitectura.md 1.4, pero surge de 1.1
--      ("Laprida no compra a proveedores") y del propio mockup del dashboard
--      (docs/mockups/paneles.html, tarjeta "Envases" de Laprida: "Los vacios
--      de Laprida se envian a Olavarria con la proxima transferencia"). No
--      existe todavia un movimiento de traspaso de envases entre sucursales
--      documentado -- inventar ese circuito no correspondia aca -- asi que
--      esto queda limitado a: cada sucursal acumula sus propios vacios
--      (ingreso_cliente) y solo Olavarria los devuelve a proveedor. El envio
--      fisico de los vacios de Laprida a Olavarria queda fuera de alcance,
--      igual que en el mockup.
--   4. Un ajuste de envases exige motivo obligatorio, igual que un ajuste de
--      inventario (arquitectura.md 1.9) -- es la unica via para corregir un
--      conteo mal cargado, y la regla 5 de CLAUDE.md pide trazabilidad ante
--      la duda.
--   5. cantidad_vacios de stock_envases no puede quedar negativa. A
--      diferencia de stock_sucursal (bloque 3), que permite vender sin stock
--      a proposito (arquitectura.md 1.8), no hay ningun flujo documentado
--      que le de sentido a un vacio negativo -- no existe "vender un envase"
--      sin tenerlo. Un movimiento que lo llevaria a negativo se rechaza.

-- =========================================================
-- Tablas
-- =========================================================

create table stock_envases (
  tipo_envase_id uuid not null references tipos_envase (id),
  sucursal_id uuid not null references sucursales (id),
  cantidad_vacios integer not null default 0 check (cantidad_vacios >= 0),
  primary key (tipo_envase_id, sucursal_id)
);

create index stock_envases_sucursal_id_idx on stock_envases (sucursal_id);

create table movimientos_envases (
  id uuid primary key default gen_random_uuid(),
  tipo_envase_id uuid not null references tipos_envase (id),
  sucursal_id uuid not null references sucursales (id),
  tipo text not null check (tipo in ('ingreso_cliente', 'devolucion_proveedor', 'ajuste')),
  -- Con signo, igual que movimientos_stock.cantidad: entrada positiva,
  -- salida negativa. El signo lo calcula registrar_movimiento_envase()
  -- segun el tipo, salvo 'ajuste', unico caso donde lo pasa quien llama.
  cantidad integer not null check (cantidad <> 0),
  cantidad_anterior integer not null,
  cantidad_posterior integer not null,
  check (cantidad_posterior = cantidad_anterior + cantidad),
  usuario_id uuid not null references usuarios (id),
  fecha timestamptz not null default now(),
  motivo text,
  -- Ver decision de implementacion 2: sin FK todavia, la tabla ventas no
  -- existe hasta el bloque 6. Solo tiene sentido para tipo='ingreso_cliente'
  -- que provenga de una venta con envase.
  venta_id uuid,
  check (venta_id is null or tipo = 'ingreso_cliente')
);

create index movimientos_envases_tipo_envase_sucursal_idx
  on movimientos_envases (tipo_envase_id, sucursal_id);
create index movimientos_envases_fecha_idx on movimientos_envases (fecha);

-- =========================================================
-- Bloqueo de escritura directa (mismo mecanismo que stock_sucursal /
-- movimientos_stock en el bloque 3: RLS sin politicas de escritura ya
-- alcanza contra anon/authenticated, pero no contra service_role ni un
-- superusuario, asi que el bloqueo real es este trigger).
-- =========================================================

create or replace function bloquear_escritura_directa_stock_envases()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.movimiento_envase_en_curso', true), 'off') <> 'on' then
    raise exception
      'stock_envases solo se modifica a traves de registrar_movimiento_envase()';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger stock_envases_bloquear_escritura_directa
  before insert or update or delete on stock_envases
  for each row
  execute function bloquear_escritura_directa_stock_envases();

-- movimientos_envases es inmutable, igual que movimientos_stock (CLAUDE.md
-- regla 2): update/delete se rechazan siempre, sin excepcion.

create or replace function bloquear_escritura_directa_movimientos_envases()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception
      'movimientos_envases es inmutable: no se edita ni se borra un movimiento historico';
  end if;

  if coalesce(current_setting('bebidas_moe.movimiento_envase_en_curso', true), 'off') <> 'on' then
    raise exception
      'movimientos_envases solo se inserta a traves de registrar_movimiento_envase()';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger movimientos_envases_bloquear_escritura_directa
  before insert or update or delete on movimientos_envases
  for each row
  execute function bloquear_escritura_directa_movimientos_envases();

-- =========================================================
-- registrar_movimiento_envase(): unico camino para cambiar stock_envases.
-- Mismo patron que registrar_movimiento() (bloque 3): p_cantidad es una
-- MAGNITUD POSITIVA salvo para 'ajuste', donde va firmada.
-- =========================================================

create or replace function registrar_movimiento_envase(
  p_tipo_envase_id uuid,
  p_sucursal_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo text default null,
  p_venta_id uuid default null
)
returns movimientos_envases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signo integer;
  v_delta integer;
  v_cantidad_anterior integer;
  v_cantidad_posterior integer;
  v_movimiento movimientos_envases;
  v_es_central boolean;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para modificar envases de esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad = 0 then
    raise exception 'La cantidad debe ser distinta de cero';
  end if;

  if not exists (select 1 from tipos_envase where id = p_tipo_envase_id) then
    raise exception 'El tipo de envase % no existe', p_tipo_envase_id;
  end if;

  select es_central into v_es_central from sucursales where id = p_sucursal_id;
  if not found then
    raise exception 'La sucursal % no existe', p_sucursal_id;
  end if;

  if p_tipo not in ('ingreso_cliente', 'devolucion_proveedor', 'ajuste') then
    raise exception 'Tipo de movimiento de envase invalido: %', p_tipo;
  end if;

  -- Decision de implementacion 3: la devolucion al proveedor sale siempre
  -- de la sucursal central.
  if p_tipo = 'devolucion_proveedor' and not coalesce(v_es_central, false) then
    raise exception
      'La devolucion al proveedor se hace desde la sucursal central (Olavarria)';
  end if;

  -- Decision de implementacion 4.
  if p_tipo = 'ajuste' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Un ajuste de envases necesita motivo';
  end if;

  if p_venta_id is not null and p_tipo <> 'ingreso_cliente' then
    raise exception 'venta_id solo aplica a un ingreso por venta con envase';
  end if;

  v_signo := case p_tipo
    when 'ingreso_cliente' then 1
    when 'devolucion_proveedor' then -1
    when 'ajuste' then null
  end;

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

  perform set_config('bebidas_moe.movimiento_envase_en_curso', 'on', true);

  -- Garantiza que exista la fila antes de lockearla. on conflict do nothing
  -- para no pisar la cantidad si ya existia.
  insert into stock_envases (tipo_envase_id, sucursal_id, cantidad_vacios)
  values (p_tipo_envase_id, p_sucursal_id, 0)
  on conflict (tipo_envase_id, sucursal_id) do nothing;

  -- Lockea la fila para que dos movimientos concurrentes sobre el mismo
  -- tipo/sucursal no calculen cantidad_anterior con el mismo valor viejo.
  select cantidad_vacios into v_cantidad_anterior
  from stock_envases
  where tipo_envase_id = p_tipo_envase_id and sucursal_id = p_sucursal_id
  for update;

  v_cantidad_posterior := v_cantidad_anterior + v_delta;

  -- Decision de implementacion 5.
  if v_cantidad_posterior < 0 then
    raise exception
      'Ese movimiento dejaria el stock de envases en negativo (hay % vacios, se pidio %)',
      v_cantidad_anterior, v_delta;
  end if;

  update stock_envases
  set cantidad_vacios = v_cantidad_posterior
  where tipo_envase_id = p_tipo_envase_id and sucursal_id = p_sucursal_id;

  insert into movimientos_envases (
    tipo_envase_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_posterior,
    usuario_id, motivo, venta_id
  ) values (
    p_tipo_envase_id, p_sucursal_id, p_tipo, v_delta, v_cantidad_anterior, v_cantidad_posterior,
    auth.uid(), p_motivo, p_venta_id
  )
  returning * into v_movimiento;

  perform set_config('bebidas_moe.movimiento_envase_en_curso', 'off', true);

  return v_movimiento;
end;
$$;

-- =========================================================
-- RLS
-- =========================================================
-- Lectura: cualquier usuario activo, igual que stock_sucursal (arquitectura.md
-- 1.11: "stock otra sucursal: lectura" para ambos encargados). Sin politicas
-- de insert/update/delete: la escritura pasa exclusivamente por
-- registrar_movimiento_envase() (SECURITY DEFINER, dueño de las tablas),
-- reforzado por los triggers de bloqueo de arriba.

alter table stock_envases enable row level security;
alter table movimientos_envases enable row level security;

create policy stock_envases_select on stock_envases
  for select
  using (usuario_activo());

create policy movimientos_envases_select on movimientos_envases
  for select
  using (usuario_activo());

-- =========================================================
-- Permisos base (ver notas del entorno en CLAUDE.md)
-- =========================================================
-- select: todas las tablas nuevas, RLS decide que filas se ven.
-- stock_envases/movimientos_envases: sin politicas de escritura, solo las
-- escribe registrar_movimiento_envase() (SECURITY DEFINER, dueño de las
-- tablas) -> NO llevan grants de insert/update/delete, mismo criterio que
-- stock_sucursal/movimientos_stock en el bloque 3.

grant select on all tables in schema public to authenticated;
