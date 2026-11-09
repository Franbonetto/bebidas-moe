-- sugerir_pedido(): que también la pueda consultar quien opera Olavarría
-- (pedido del usuario 2026-11-09, despacho directo de Olavarría a Laprida).
--
-- Antes exigía opera_sucursal(destino), o sea dueño o encargada de
-- Laprida. Pero ahora es Olavarría quien arma el envío mirando lo que
-- Laprida vendió, y su encargada no está asignada a Laprida: sin este
-- cambio la pantalla del pedido semanal le tiraba "No tenes permiso".
--
-- Mismo cuerpo que la versión original (20260821090000). Única diferencia:
-- el chequeo de permiso, que ahora también acepta opera_central(). Sigue
-- siendo solo lectura (no es SECURITY DEFINER, lee con las políticas de
-- quien llama).

create or replace function sugerir_pedido(p_sucursal_destino_id uuid)
returns table (
  sku_id uuid,
  stock_actual integer,
  en_transito integer,
  pendiente_pedidos_abiertos integer,
  stock_objetivo integer,
  arrastre integer,
  sugerido integer
)
language plpgsql
stable
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not (opera_sucursal(p_sucursal_destino_id) or opera_central()) then
    raise exception 'No tenes permiso para ver la sugerencia de esta sucursal';
  end if;

  return query
  with transito as (
    select st.sku_id, sum(st.cantidad)::integer as cantidad
    from stock_transito st
    join transferencias t on t.id = st.transferencia_id
    where t.sucursal_destino_id = p_sucursal_destino_id
    group by st.sku_id
  ),
  abiertos as (
    -- Pedidos ya en curso que todavia no se reflejan en stock_transito:
    -- mientras estan enviado/en_preparacion cuenta lo solicitado (es lo
    -- maximo que le puede llegar a pedir a Olavarria); una vez preparado
    -- cuenta lo preparado que todavia no se despacho (lo ya despachado
    -- entra por "transito"). Los cerrados no suman aca -- su faltante
    -- entra por "arrastre".
    select pi.sku_id, sum(
      case
        when p.estado in ('enviado', 'en_preparacion') then pi.cantidad_solicitada
        when p.estado in ('preparado', 'despachado') then
          greatest(
            coalesce(pi.cantidad_preparada, 0) - coalesce((
              select sum(ti.cantidad_despachada)
              from transferencia_items ti
              where ti.pedido_item_id = pi.id
            ), 0),
            0
          )
        else 0
      end
    )::integer as cantidad
    from pedido_items pi
    join pedidos p on p.id = pi.pedido_id
    where p.sucursal_destino_id = p_sucursal_destino_id
      and p.estado not in ('borrador', 'cerrado')
    group by pi.sku_id
  ),
  ultimo_pendiente as (
    -- Solo el pendiente del ULTIMO pedido cerrado por sku (decision de
    -- negocio confirmada en el bloque 7): la sugerencia ya compara contra
    -- stock_objetivo, que ya refleja el stock bajo de hoy.
    select distinct on (pi.sku_id)
      pi.sku_id, pi.cantidad_pendiente
    from pedido_items pi
    join pedidos p on p.id = pi.pedido_id
    where p.sucursal_destino_id = p_sucursal_destino_id
      and p.estado = 'cerrado'
      and pi.cantidad_pendiente > 0
    order by pi.sku_id, p.fecha_cierre desc
  )
  select
    s.id,
    coalesce(ss.cantidad, 0),
    coalesce(tr.cantidad, 0),
    coalesce(ab.cantidad, 0),
    s.stock_objetivo,
    coalesce(up.cantidad_pendiente, 0),
    greatest(
      s.stock_objetivo
        - (coalesce(ss.cantidad, 0) + coalesce(tr.cantidad, 0) + coalesce(ab.cantidad, 0))
        + coalesce(up.cantidad_pendiente, 0),
      0
    )
  from skus s
  left join stock_sucursal ss on ss.sku_id = s.id and ss.sucursal_id = p_sucursal_destino_id
  left join transito tr on tr.sku_id = s.id
  left join abiertos ab on ab.sku_id = s.id
  left join ultimo_pendiente up on up.sku_id = s.id
  where s.activo = true;
end;
$$;
