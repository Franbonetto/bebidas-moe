-- Corrección de la cascada de cerveza en lata (decisión del usuario
-- 2026-09-22): la base del cálculo es el PRECIO DE VENTA que la encargada
-- carga a mano para el pack x24 al recibir la mercadería -- no un
-- costo×1,20 automático como se había implementado antes. El x6 y la
-- unidad se siguen derivando de esa base con la misma fórmula de siempre
-- (bloque 5): x6 = x24/4 + $1.000, unidad = redondeo de (x6+$300)/6, etc.
--
-- Esto significa que el x24 de una familia con cascada activada SÍ
-- necesita poder tener una fila manual en `precios` (algo que el trigger
-- original bloqueaba para TODO SKU de cascada, sin distinguir el x24 del
-- x6/unidad). El x6 y la unidad siguen sin poder cargarse a mano: esos dos
-- siempre se calculan solos a partir del precio del x24.

create or replace function validar_precio_manual_no_cascada()
returns trigger
language plpgsql
as $$
declare
  v_unidades_contenidas integer;
  v_es_cascada boolean;
begin
  select unidades_contenidas, cascada_cerveza_lata
  into v_unidades_contenidas, v_es_cascada
  from skus where id = new.sku_id;

  -- El x24 (tope de la cascada) SÍ puede tener precio manual: es la base
  -- de la que se calculan el x6 y la unidad. Solo se bloquea el resto
  -- (x6, unidad) de una familia con la cascada activada.
  if v_es_cascada and v_unidades_contenidas <> 24 then
    raise exception
      'Este SKU es parte de la cascada de cerveza en lata: su precio se calcula solo a partir del precio de venta del pack x24 (usa precios_sucursal si necesitas una excepción puntual)';
  end if;

  return new;
end;
$$;
