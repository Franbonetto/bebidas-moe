-- Ajustar el stock de un SKU desde la pantalla de editar producto.
--
-- Pedido del usuario 2026-10-19: "en productos agregar poder ajustar stock
-- desde el boton editar". Hasta ahora la unica forma de corregir stock era
-- un inventario (general, por categoria o puntual) o una merma. Eso sigue
-- siendo el camino bueno para un conteo en serio; esto es para el caso
-- suelto: un SKU que quedo mal y hay que dejarlo en el numero real sin
-- abrir un inventario.
--
-- Se escribe como funcion y no desde la app por dos razones:
--
--   1. REGLA 1 DE CLAUDE.md. El stock no se toca con un update: todo
--      cambio pasa por un movimiento. Esta funcion no inventa nada, solo
--      calcula la diferencia y llama a registrar_movimiento() con tipo
--      'ajuste', que es el unico camino.
--
--   2. PARA QUE EL AJUSTE SEA EXACTO. La encargada escribe el stock REAL
--      que conto ("quedan 12"), no la diferencia -- mismo criterio que un
--      inventario, donde se carga lo contado y el sistema saca el ajuste.
--      Si la diferencia se calculara en la app, entre leer el stock y
--      escribir el movimiento podria entrar una venta y el ajuste
--      quedaria corrido. Aca el `for update` bloquea la fila y la cuenta
--      pasa en la misma transaccion que el movimiento.
--
-- El motivo es OBLIGATORIO: un ajuste sin explicacion es exactamente lo
-- que la regla de trazabilidad quiere evitar (CLAUDE.md, Inventarios:
-- "Diferencias requieren motivo obligatorio").
--
-- Quien puede: opera_sucursal(). La pantalla de editar producto ademas
-- exige ve_costos() (dueño + encargado de Olavarria), asi que en la
-- practica el encargado de Laprida no llega -- pero la funcion se defiende
-- igual por si se la llama de otro lado.
--
-- Ademas, la app pide un PIN antes de confirmar (ver lib/pin.ts). Eso es
-- un freno de UI, no un permiso: no se valida aca.

begin;

create or replace function ajustar_stock_contado(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad_real integer,
  p_motivo text
)
returns movimientos_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_actual integer;
  v_delta integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para ajustar stock de esta sucursal';
  end if;

  if p_cantidad_real is null or p_cantidad_real < 0 then
    raise exception 'El stock contado tiene que ser cero o mas';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'El ajuste necesita un motivo';
  end if;

  -- Igual que registrar_movimiento(): garantiza que exista la fila antes de
  -- lockearla. Sin esto, un SKU que nunca tuvo stock en esta sucursal no
  -- tiene fila que bloquear y la cuenta se haria sobre la nada.
  perform set_config('bebidas_moe.movimiento_en_curso', 'on', true);

  insert into stock_sucursal (sku_id, sucursal_id, cantidad)
  values (p_sku_id, p_sucursal_id, 0)
  on conflict (sku_id, sucursal_id) do nothing;

  select cantidad into v_stock_actual
  from stock_sucursal
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id
  for update;

  v_delta := p_cantidad_real - v_stock_actual;

  if v_delta = 0 then
    raise exception 'El stock del sistema ya es %: no hay nada que ajustar', v_stock_actual;
  end if;

  -- El movimiento guarda stock_anterior/stock_posterior, usuario y motivo:
  -- queda el rastro de quien lo dejo en ese numero y por que.
  --
  -- documento_tipo/documento_id van en null: no hay documento detras de
  -- este ajuste (no es un inventario ni una compra), y movimientos_stock
  -- tiene un check de que los dos van juntos o ninguno.
  return registrar_movimiento(
    p_sku_id => p_sku_id,
    p_sucursal_id => p_sucursal_id,
    p_tipo => 'ajuste',
    p_cantidad => v_delta,
    p_motivo => p_motivo
  );
end;
$$;

comment on function ajustar_stock_contado(uuid, uuid, integer, text) is
  'Deja el stock de un SKU en la cantidad contada, generando el movimiento de ajuste por la diferencia. Se usa desde /productos (editar). El motivo es obligatorio.';

commit;
