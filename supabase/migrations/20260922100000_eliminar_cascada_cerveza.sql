-- Elimina la cascada de precio de cerveza en lata (decisión del usuario
-- 2026-09-22, cambio drástico): cada nivel (x24, x6, unidad) tiene su
-- propio precio de venta, cargado a mano SIEMPRE -- distintas cervezas se
-- manejan con márgenes distintos, no hay una fórmula única que sirva para
-- todas. El sistema no vuelve a calcular ningún precio de cerveza solo.
--
-- Lo que NO se toca: el desarme físico de stock (desarma_en_sku_id /
-- desarma_en_cantidad, desarmar_sku(), el auto-desarme silencioso del POS)
-- sigue funcionando exactamente igual -- eso es sobre STOCK, nunca fue
-- sobre precio, y la cerveza se sigue rompiendo sola en el momento de la
-- venta si hace falta.

-- =========================================================
-- precios: ya no hay SKU de cascada que bloquear -- cualquier SKU puede
-- tener precio manual, como era antes del bloque 5.
-- =========================================================

drop trigger if exists precios_validar_no_cascada on precios;
drop function if exists validar_precio_manual_no_cascada();

-- =========================================================
-- precios_sucursal: en la sucursal central, el precio se edita siempre
-- directo en precios.precio_base -- ya no existe la excepción de cascada
-- que justificaba permitir el override ahí.
-- =========================================================

create or replace function validar_precios_sucursal_central()
returns trigger
language plpgsql
as $$
declare
  v_es_central boolean;
begin
  select es_central into v_es_central from sucursales where id = new.sucursal_id;

  if v_es_central then
    raise exception
      'En la sucursal central el precio de este SKU se edita directo en precios.precio_base';
  end if;

  return new;
end;
$$;

-- =========================================================
-- recargos_sku: ya no hay SKU de cascada que excluir del sistema de
-- recargos por categoría/SKU.
-- =========================================================

drop trigger if exists recargos_sku_validar_no_cascada on recargos_sku;
drop function if exists validar_recargo_sku_no_cascada();

-- =========================================================
-- skus: se saca la columna, ya no hay ningún camino de código que la lea.
-- =========================================================

alter table skus drop column if exists cascada_cerveza_lata;
