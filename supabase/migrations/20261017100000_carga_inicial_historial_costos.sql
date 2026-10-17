-- Carga inicial con costo: devolver la excepcion que se comio la
-- migracion del costo con impuestos.
--
-- REGRESION introducida el 2026-10-16 en
-- 20261016090000_costo_con_impuestos.sql. Esa migracion reescribio
-- bloquear_escritura_directa_historial_costos() para permitir completar
-- costo_con_impuestos cuando el remito recibe su factura despues, y al
-- reescribirla copio la version del bloque 4 (20260820150000), que es
-- anterior a la carga inicial. En el camino perdio la excepcion que
-- 20260930090000_carga_inicial_vencimiento_proveedor.sql le habia
-- agregado:
--
--     and coalesce(current_setting('bebidas_moe.carga_inicial_en_curso',
--                                  true), 'off') <> 'on'
--
-- cargar_stock_inicial() sigue prendiendo ese flag (ver
-- 20261006090000_carga_inicial_varios_lotes.sql), pero el trigger dejo de
-- mirarlo, asi que cualquier conteo que viniera con costo moria en
-- "historial_costos solo se inserta al confirmar una recepcion".
--
-- Sintoma que reporto el usuario el 2026-10-17, con el sistema ya
-- operando: en Carga inicial no se podia guardar ningun producto que
-- tuviera costo cargado. El formulario precarga el campo Costo con
-- skus.costo_actual, asi que justamente los productos que habian entrado
-- por mercaderia eran los que no se podian contar. Los que nunca tuvieron
-- costo guardaban bien, porque mandaban null y no insertaban nada en
-- historial_costos.
--
-- Esta migracion NO cambia ninguna regla: deja el trigger exactamente como
-- quedo ayer (inmutabilidad del lote + la excepcion de costo_con_impuestos)
-- y le devuelve la de la carga inicial. Los dos caminos que pueden escribir
-- historial_costos siguen siendo los mismos de siempre: confirmar una
-- recepcion y cargar el stock inicial, cada uno con su flag de transaccion.

begin;

create or replace function bloquear_escritura_directa_historial_costos()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- Unica edicion permitida: llenar costo_con_impuestos cuando estaba
    -- vacio (el remito al que despues le llega la factura), desde
    -- recalcular_costo_con_impuestos_compra() y nada mas. Igual que ayer.
    if coalesce(current_setting('bebidas_moe.costo_con_impuestos_en_curso', true), 'off') = 'on'
      and old.costo_con_impuestos is null
      and new.id = old.id
      and new.sku_id = old.sku_id
      and new.proveedor_id = old.proveedor_id
      and new.recepcion_id = old.recepcion_id
      and new.costo_unitario = old.costo_unitario
      and new.cantidad = old.cantidad
      and new.fecha = old.fecha
      and new.fecha_vencimiento is not distinct from old.fecha_vencimiento
    then
      return new;
    end if;

    raise exception
      'historial_costos es inmutable: una fila por lote recibido, nunca se sobrescribe';
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'historial_costos es inmutable: una fila por lote recibido, nunca se sobrescribe';
  end if;

  -- INSERT: los dos caminos legitimos. El segundo es el que se habia
  -- perdido.
  if coalesce(current_setting('bebidas_moe.recepcion_en_curso', true), 'off') <> 'on'
    and coalesce(current_setting('bebidas_moe.carga_inicial_en_curso', true), 'off') <> 'on'
  then
    raise exception
      'historial_costos solo se inserta al confirmar una recepcion o al cargar el stock inicial';
  end if;

  return coalesce(new, old);
end;
$$;

commit;

-- =========================================================
-- Permisos
-- =========================================================
-- Nada que agregar: no hay tablas nuevas. historial_costos la escriben
-- unicamente confirmar_recepcion() y cargar_stock_inicial(), las dos
-- SECURITY DEFINER, asi que no lleva grant de insert -- ver NOTAS DEL
-- ENTORNO en CLAUDE.md.
