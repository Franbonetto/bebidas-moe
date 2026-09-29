-- Merma por vencimiento: cuándo vencía.
--
-- Pedido del usuario 2026-09-28: al elegir el motivo "vencido", preguntar la
-- fecha de vencimiento.
--
-- Para qué sirve el dato: no es lo mismo tirar algo que venció ayer que algo
-- que venció hace cuatro meses y nadie lo vio. Lo primero es normal; lo
-- segundo dice que el producto estuvo meses ahí sin que nadie lo mirara, y
-- es lo que hay que poder ver.
--
-- Nullable en la tabla, obligatoria en la función cuando el motivo es
-- 'vencido' -- mismo criterio que empleado_id: un check constraint haría
-- fallar la migración si ya existiera alguna merma 'vencido' cargada antes
-- de esta columna, y el único camino de escritura es registrar_merma().

begin;

alter table mermas add column fecha_vencimiento date;

-- =========================================================
-- registrar_merma(): + fecha de vencimiento
-- =========================================================
-- Se dropea la versión anterior por lo de siempre: con las dos vivas,
-- PostgREST no puede resolver a cuál llamar.

drop function if exists registrar_merma(uuid, uuid, integer, text, uuid, text);

create function registrar_merma(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_motivo text,
  p_empleado_id uuid,
  p_detalle text default null,
  p_fecha_vencimiento date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merma_id uuid;
  v_detalle text;
  v_fecha_vencimiento date;
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

  -- La fecha solo tiene sentido cuando el motivo es el vencimiento: si vino
  -- con otro motivo se descarta, en vez de guardar un dato que nadie va a
  -- poder interpretar después.
  if p_motivo = 'vencido' then
    if p_fecha_vencimiento is null then
      raise exception 'Si se venció, hay que indicar cuándo vencía';
    end if;
    v_fecha_vencimiento := p_fecha_vencimiento;
  else
    v_fecha_vencimiento := null;
  end if;

  if not exists (select 1 from skus where id = p_sku_id and activo = true) then
    raise exception 'El producto no existe o está dado de baja';
  end if;

  perform set_config('bebidas_moe.merma_en_curso', 'on', true);

  insert into mermas (
    sucursal_id, sku_id, cantidad, motivo, detalle, empleado_id, usuario_id, fecha_vencimiento
  )
  values (
    p_sucursal_id, p_sku_id, p_cantidad, p_motivo, v_detalle, p_empleado_id, auth.uid(),
    v_fecha_vencimiento
  )
  returning id into v_merma_id;

  perform set_config('bebidas_moe.merma_en_curso', 'off', true);

  -- El nombre del empleado y la fecha de vencimiento entran también en el
  -- motivo del movimiento: el histórico de cada SKU se lee sin tener que
  -- cruzar tablas a mano.
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
      || coalesce(' el ' || to_char(v_fecha_vencimiento, 'DD/MM/YYYY'), '')
      || ' (' || (select nombre from empleados where id = p_empleado_id) || ')'
      || coalesce(': ' || v_detalle, ''),
    p_documento_tipo => 'merma',
    p_documento_id => v_merma_id
  );

  return v_merma_id;
end;
$$;

commit;
