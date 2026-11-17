-- Apertura de caja con monto fijo, en las dos sucursales (pedido del
-- usuario 2026-11-16). Hasta ahora quien abria la caja contaba el efectivo
-- y tipeaba el monto: eso dejaba lugar a error (o a cargar cualquier
-- numero). A partir de ahora la apertura siempre es $10.000 y no se puede
-- tocar -- lo unico que se elige es quien abre.
--
-- Se saca el parametro p_monto_apertura de abrir_caja() en vez de dejarlo y
-- validarlo: asi no hay ningun punto de entrada (ni un request armado a
-- mano) por el que pueda viajar un monto distinto. El valor queda
-- hardcodeado en la funcion.

begin;

drop function if exists abrir_caja(uuid, numeric, uuid);

create or replace function abrir_caja(
  p_sucursal_id uuid,
  p_empleado_id uuid
)
returns cajas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja cajas;
  v_monto_apertura constant numeric(12, 2) := 10000;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para abrir la caja de esta sucursal';
  end if;

  if p_empleado_id is null then
    raise exception 'Decime quien abre la caja';
  end if;

  -- El empleado tiene que ser de ESTA sucursal: si no, desde el mostrador
  -- de Laprida se podria registrar a alguien de Olavarria.
  if not exists (
    select 1 from empleados
    where id = p_empleado_id and sucursal_id = p_sucursal_id and activo = true
  ) then
    raise exception 'Esa persona no trabaja en esta sucursal o esta dada de baja';
  end if;

  if exists (
    select 1 from cajas where sucursal_id = p_sucursal_id and fecha = fecha_operativa()
  ) then
    raise exception 'La caja de hoy en esta sucursal ya fue abierta';
  end if;

  -- cajas esta bloqueada contra escritura directa (trigger
  -- cajas_bloquear_escritura_directa, bloque 6): hay que prender el mismo
  -- flag de sesion que usan confirmar_venta()/cerrar_caja(), si no el
  -- insert lo rechaza.
  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  insert into cajas (
    sucursal_id, fecha, monto_apertura, usuario_apertura_id, empleado_apertura_id
  )
  values (
    p_sucursal_id, fecha_operativa(), v_monto_apertura, auth.uid(), p_empleado_id
  )
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;

comment on function abrir_caja(uuid, uuid) is
  'Abre la caja del dia con monto de apertura fijo ($10.000, hardcodeado): no recibe el monto como parametro para que no se pueda abrir con otro valor.';

commit;
