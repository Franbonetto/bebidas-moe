-- Empleado que abre y que cierra la caja.
--
-- Pedido del usuario 2026-10-06: en el punto de venta, al abrir la caja hay
-- que preguntar qué empleado la abre, y lo mismo al cerrarla.
--
-- Por qué empleados y no usuarios: el sistema tiene tres usuarios (dueño y
-- los dos encargados), pero el mostrador lo atienden varias personas que no
-- tienen cuenta propia. `cajas.usuario_apertura_id` ya guarda con qué cuenta
-- se abrió; eso no dice quién estaba atendiendo. Mismo problema que resolvió
-- `mermas.empleado_id` en 20261002090000_empleados_merma.sql, y se resuelve
-- igual: una referencia a `empleados`, validada contra la sucursal.
--
-- Obligatorio, no opcional (decisión del usuario 2026-10-06, mismo criterio
-- que la merma): si se pudiera dejar vacío, en una semana la caja la abre
-- "nadie" y la columna no sirve para auditar una diferencia de caja, que es
-- justo para lo que existe.
--
-- El que cierra puede ser distinto del que abrió: son dos columnas
-- separadas porque el turno cambia de manos.

begin;

-- =========================================================
-- Columnas
-- =========================================================

alter table cajas add column empleado_apertura_id uuid references empleados (id);
alter table cajas add column empleado_cierre_id uuid references empleados (id);

create index cajas_empleado_apertura_id_idx on cajas (empleado_apertura_id);
create index cajas_empleado_cierre_id_idx on cajas (empleado_cierre_id);

comment on column cajas.empleado_apertura_id is
  'Persona que abrió la caja (empleados), distinta de usuario_apertura_id, que es la cuenta con la que se entró al sistema.';
comment on column cajas.empleado_cierre_id is
  'Persona que cerró la caja. Puede ser otra que la que abrió: el turno cambia de manos.';

-- Las funciones de abajo ya exigen el empleado, pero si la tabla está vacía
-- se exige también a nivel base: es gratis hacerlo ahora y cierra la puerta
-- para siempre (CLAUDE.md regla 5). Si ya hay cajas cargadas no se puede
-- (las viejas no tienen empleado) y queda solo la validación de la función.
do $$
begin
  if not exists (select 1 from cajas) then
    alter table cajas alter column empleado_apertura_id set not null;

    alter table cajas add constraint cajas_empleado_cierre_completo
      check (estado = 'abierta' or empleado_cierre_id is not null);
  end if;
end $$;

-- =========================================================
-- abrir_caja(): ahora con empleado
-- =========================================================
-- Se borra la versión de dos argumentos en vez de dejarla al lado: Postgres
-- permite sobrecargar, y una firma vieja que todavía anda es una forma
-- silenciosa de seguir abriendo cajas sin empleado.

drop function if exists abrir_caja(uuid, numeric);

create or replace function abrir_caja(
  p_sucursal_id uuid,
  p_monto_apertura numeric,
  p_empleado_id uuid
)
returns cajas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja cajas;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para abrir la caja de esta sucursal';
  end if;

  if p_monto_apertura is null or p_monto_apertura < 0 then
    raise exception 'El monto de apertura no puede ser negativo';
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
    select 1 from cajas where sucursal_id = p_sucursal_id and fecha = current_date
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
    p_sucursal_id, current_date, p_monto_apertura, auth.uid(), p_empleado_id
  )
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;

-- =========================================================
-- cerrar_caja(): ahora con empleado
-- =========================================================
-- Cuerpo igual al de 20260919100000_venta_pagos.sql (el efectivo de ventas
-- sale de venta_pagos, no de ventas.total), mas la validacion y el guardado
-- del empleado.

drop function if exists cerrar_caja(uuid, numeric);

create or replace function cerrar_caja(
  p_caja_id uuid,
  p_efectivo_declarado numeric,
  p_empleado_id uuid
)
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

  if p_empleado_id is null then
    raise exception 'Decime quien cierra la caja';
  end if;

  -- Contra la sucursal de la caja, no contra la del usuario: el dueño opera
  -- las dos y podria cerrar la de Laprida desde Olavarria.
  if not exists (
    select 1 from empleados
    where id = p_empleado_id and sucursal_id = v_sucursal_id and activo = true
  ) then
    raise exception 'Esa persona no trabaja en esta sucursal o esta dada de baja';
  end if;

  select coalesce(sum(vp.monto), 0) into v_efectivo_ventas
  from venta_pagos vp
  join ventas v on v.id = vp.venta_id
  where v.caja_id = p_caja_id and v.estado = 'confirmada' and vp.medio_pago = 'efectivo';

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
    empleado_cierre_id = p_empleado_id,
    cerrada_en = now()
  where id = p_caja_id
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;

commit;

-- =========================================================
-- Permisos
-- =========================================================
-- Nada que agregar: no hay tablas nuevas, y `cajas` la escriben solo estas
-- dos funciones SECURITY DEFINER, que por eso no llevan grant de update
-- (ver NOTAS DEL ENTORNO en CLAUDE.md). `empleados` ya tiene su grant de
-- select desde 20261002090000_empleados_merma.sql.
