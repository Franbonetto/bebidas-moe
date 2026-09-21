-- Movimientos de caja: entrada/salida de efectivo que NO son una venta
-- (ej. el dueño retira efectivo, o pone fondo extra a mitad de turno).
-- Hasta ahora `efectivo_sistema` en cerrar_caja() solo sumaba ventas en
-- efectivo -- sin esto, cualquier entrada/salida manual quedaba fuera de
-- la reconciliación y el "diferencia" del cierre salía mal.
--
-- Mismo patrón que el resto del sistema: tabla propia, bloqueo de
-- escritura directa, se escribe solo vía registrar_movimiento_caja()
-- (SECURITY DEFINER) -- nunca un UPDATE/INSERT suelto.

create table movimientos_caja (
  id uuid primary key default gen_random_uuid(),
  caja_id uuid not null references cajas (id),
  tipo text not null check (tipo in ('entrada', 'salida')),
  monto numeric(12, 2) not null check (monto > 0),
  motivo text not null check (trim(motivo) <> ''),
  usuario_id uuid not null references usuarios (id),
  creado_en timestamptz not null default now()
);

create index movimientos_caja_caja_id_idx on movimientos_caja (caja_id);

create or replace function bloquear_escritura_directa_movimientos_caja()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.movimiento_caja_en_curso', true), 'off') <> 'on' then
    raise exception '% solo se modifica a traves de registrar_movimiento_caja()', tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger movimientos_caja_bloquear_escritura_directa
  before insert or update or delete on movimientos_caja
  for each row
  execute function bloquear_escritura_directa_movimientos_caja();

alter table movimientos_caja enable row level security;

-- select: mismo criterio que ventas -- cualquiera que opere la sucursal
-- de esa caja (join, porque movimientos_caja no tiene sucursal_id propio).
create policy movimientos_caja_select on movimientos_caja
  for select
  using (
    exists (
      select 1 from cajas c
      where c.id = movimientos_caja.caja_id
        and opera_sucursal(c.sucursal_id)
    )
  );

-- Sin grant de insert/update/delete: solo la función SECURITY DEFINER
-- escribe (mismo criterio que stock_sucursal/movimientos_stock).
grant select on movimientos_caja to authenticated;

create or replace function registrar_movimiento_caja(
  p_caja_id uuid,
  p_tipo text,
  p_monto numeric,
  p_motivo text
)
returns movimientos_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_estado text;
  v_fila movimientos_caja;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id, estado into v_sucursal_id, v_estado from cajas where id = p_caja_id;
  if v_sucursal_id is null then
    raise exception 'La caja no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para operar esta caja';
  end if;

  if v_estado <> 'abierta' then
    raise exception 'Esta caja ya esta cerrada';
  end if;

  if p_tipo not in ('entrada', 'salida') then
    raise exception 'Tipo de movimiento invalido: %', p_tipo;
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor a cero';
  end if;

  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  perform set_config('bebidas_moe.movimiento_caja_en_curso', 'on', true);

  insert into movimientos_caja (caja_id, tipo, monto, motivo, usuario_id)
  values (p_caja_id, p_tipo, p_monto, trim(p_motivo), auth.uid())
  returning * into v_fila;

  perform set_config('bebidas_moe.movimiento_caja_en_curso', 'off', true);

  return v_fila;
end;
$$;

-- cerrar_caja(): ahora tambien suma/resta movimientos_caja (entrada/
-- salida). OJO -- esta funcion ya venia extendida por
-- 20260903100000_apertura_caja.sql (monto_apertura) y
-- 20260904090000_devoluciones_cliente.sql (resta devoluciones en
-- dinero); se reconstruye ACA con todo eso junto, no solo con lo de
-- ventas en efectivo, para no perder esos dos ajustes.
create or replace function cerrar_caja(p_caja_id uuid, p_efectivo_declarado numeric)
returns cajas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_estado text;
  v_monto_apertura numeric(12, 2);
  v_efectivo_ventas numeric(12, 2);
  v_devoluciones_dinero numeric(12, 2);
  v_entradas numeric(12, 2);
  v_salidas numeric(12, 2);
  v_efectivo_sistema numeric(12, 2);
  v_cantidad_tickets integer;
  v_caja cajas;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id, estado, monto_apertura into v_sucursal_id, v_estado, v_monto_apertura
  from cajas where id = p_caja_id
  for update;

  if not found then
    raise exception 'La caja no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para cerrar la caja de esta sucursal';
  end if;

  if v_estado <> 'abierta' then
    raise exception 'Esta caja ya esta cerrada';
  end if;

  if p_efectivo_declarado is null or p_efectivo_declarado < 0 then
    raise exception 'El efectivo declarado no puede ser negativo';
  end if;

  select coalesce(sum(total), 0) into v_efectivo_ventas
  from ventas
  where caja_id = p_caja_id and estado = 'confirmada' and medio_pago = 'efectivo';

  select coalesce(sum(monto_reembolsado), 0) into v_devoluciones_dinero
  from devoluciones
  where caja_id = p_caja_id and resolucion = 'dinero';

  select coalesce(sum(monto), 0) into v_entradas
  from movimientos_caja
  where caja_id = p_caja_id and tipo = 'entrada';

  select coalesce(sum(monto), 0) into v_salidas
  from movimientos_caja
  where caja_id = p_caja_id and tipo = 'salida';

  v_efectivo_sistema := v_monto_apertura + v_efectivo_ventas - v_devoluciones_dinero + v_entradas - v_salidas;

  select count(*) into v_cantidad_tickets
  from ventas
  where caja_id = p_caja_id and estado = 'confirmada';

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  update cajas set
    estado = 'cerrada',
    efectivo_sistema = v_efectivo_sistema,
    efectivo_declarado = p_efectivo_declarado,
    diferencia = p_efectivo_declarado - v_efectivo_sistema,
    cantidad_tickets = v_cantidad_tickets,
    usuario_cierre_id = auth.uid(),
    cerrada_en = now()
  where id = p_caja_id
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;
