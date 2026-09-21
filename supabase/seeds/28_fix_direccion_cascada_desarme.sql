-- Corrige un bug real en la dirección de la cascada de desarme de packs
-- (arquitectura.md 1.3: "pack x24 -> 4 x pack x6 -> 6 x unidad").
--
-- `desarma_en_sku_id`/`desarma_en_cantidad` quedaron cargados AL REVÉS en
-- 07_cerveza_latas.sql (y repetí el mismo error después en
-- 22_laprida_cervezas.sql y 23_laprida_gaseosas.sql, siguiendo ese mismo
-- patrón sin darme cuenta): el six-pack apuntaba al pack de 24 (su propio
-- "padre"), y la lata suelta apuntaba al six-pack. La función
-- desarmar_sku() y el POS (vender/page.tsx) están escritos para la
-- dirección CORRECTA -- el que grande apunta al chico, con la cantidad
-- que rinde -- así que el bug estaba solo en los datos, no en la lógica.
--
-- Con la dirección vieja (al revés), llamar a desarmar_sku() sobre un x6
-- o una unidad hacía lo opuesto a desarmar: restaba stock de la
-- presentación chica y sumaba stock de la grande. Nunca se llegó a usar
-- en la práctica (verificado: cero filas en movimientos_stock con tipo
-- desarme_salida/desarme_entrada), así que esto corrige solo el
-- catálogo, no hace falta tocar ningún movimiento histórico.
--
-- Dirección correcta: el SKU MÁS GRANDE de cada cascada tiene
-- desarma_en_sku_id apuntando al siguiente más chico, con
-- desarma_en_cantidad = cuántas unidades del chico salen de 1 del grande.
-- El SKU más chico de cada cascada (no tiene en qué más desarmarse) queda
-- con desarma_en_sku_id = null.

begin;

-- Paso 1: resetear todo lo que tocan estas dos tandas (cerveza en lata +
-- el pack de Cepita), para no arrastrar ningún valor viejo.
update skus
set desarma_en_sku_id = null, desarma_en_cantidad = null
where codigo_interno like 'CERVEZA-LATA-%'
   or codigo_interno in ('GASEOSA-CEPITA-1000-X6', 'GASEOSA-CEPITA-1000-UN');

-- Paso 2: cargar la dirección correcta, grande -> chico.
update skus as grande
set desarma_en_sku_id = chico.id,
    desarma_en_cantidad = v.factor
from (values
  -- 473cc: x24 -> x6 (factor 4)
  ('CERVEZA-LATA-SCHNEIDER-473-X24', 'CERVEZA-LATA-SCHNEIDER-473-X6', 4),
  ('CERVEZA-LATA-IMPLAGER-473-X24', 'CERVEZA-LATA-IMPLAGER-473-X6', 4),
  ('CERVEZA-LATA-IMPGOLDEN-473-X24', 'CERVEZA-LATA-IMPGOLDEN-473-X6', 4),
  ('CERVEZA-LATA-IMPIPA-473-X24', 'CERVEZA-LATA-IMPIPA-473-X6', 4),
  ('CERVEZA-LATA-IMPNEGRA-473-X24', 'CERVEZA-LATA-IMPNEGRA-473-X6', 4),
  ('CERVEZA-LATA-IMPROJA-473-X24', 'CERVEZA-LATA-IMPROJA-473-X6', 4),
  ('CERVEZA-LATA-HEINEKEN-473-X24', 'CERVEZA-LATA-HEINEKEN-473-X6', 4),
  ('CERVEZA-LATA-QUILMES1890-473-X24', 'CERVEZA-LATA-QUILMES1890-473-X6', 4),
  ('CERVEZA-LATA-GROLSCH-473-X24', 'CERVEZA-LATA-GROLSCH-473-X6', 4),
  ('CERVEZA-LATA-ANDESROJA-473-X24', 'CERVEZA-LATA-ANDESROJA-473-X6', 4),
  ('CERVEZA-LATA-ANDESNEGRA-473-X24', 'CERVEZA-LATA-ANDESNEGRA-473-X6', 4),
  ('CERVEZA-LATA-AMSTEL-473-X24', 'CERVEZA-LATA-AMSTEL-473-X6', 4),
  -- 473cc: x6 -> unidad (factor 6), incluye las marcas sin x24 propio
  ('CERVEZA-LATA-SCHNEIDER-473-X6', 'CERVEZA-LATA-SCHNEIDER-473-UN', 6),
  ('CERVEZA-LATA-IMPLAGER-473-X6', 'CERVEZA-LATA-IMPLAGER-473-UN', 6),
  ('CERVEZA-LATA-IMPGOLDEN-473-X6', 'CERVEZA-LATA-IMPGOLDEN-473-UN', 6),
  ('CERVEZA-LATA-IMPIPA-473-X6', 'CERVEZA-LATA-IMPIPA-473-UN', 6),
  ('CERVEZA-LATA-IMPNEGRA-473-X6', 'CERVEZA-LATA-IMPNEGRA-473-UN', 6),
  ('CERVEZA-LATA-IMPROJA-473-X6', 'CERVEZA-LATA-IMPROJA-473-UN', 6),
  ('CERVEZA-LATA-HEINEKEN-473-X6', 'CERVEZA-LATA-HEINEKEN-473-UN', 6),
  ('CERVEZA-LATA-QUILMES1890-473-X6', 'CERVEZA-LATA-QUILMES1890-473-UN', 6),
  ('CERVEZA-LATA-GROLSCH-473-X6', 'CERVEZA-LATA-GROLSCH-473-UN', 6),
  ('CERVEZA-LATA-ANDESROJA-473-X6', 'CERVEZA-LATA-ANDESROJA-473-UN', 6),
  ('CERVEZA-LATA-ANDESNEGRA-473-X6', 'CERVEZA-LATA-ANDESNEGRA-473-UN', 6),
  ('CERVEZA-LATA-AMSTEL-473-X6', 'CERVEZA-LATA-AMSTEL-473-UN', 6),
  ('CERVEZA-LATA-ESTRELLAGALICIA-473-X6', 'CERVEZA-LATA-ESTRELLAGALICIA-473-UN', 6),
  ('CERVEZA-LATA-ANTARES-473-X6', 'CERVEZA-LATA-ANTARES-473-UN', 6),
  ('CERVEZA-LATA-SCHNEIDERLIMON-473-X6', 'CERVEZA-LATA-SCHNEIDERLIMON-473-UN', 6),
  -- 710cc: x24 -> x6 (factor 4), x6 -> unidad (factor 6, Schneider y
  -- Heineken ya tienen su unidad suelta de 710cc desde
  -- 22_laprida_cervezas.sql). Quilmes 1890 710cc para en x4, no tiene
  -- unidad suelta en la lista.
  ('CERVEZA-LATA-SCHNEIDER-710-X24', 'CERVEZA-LATA-SCHNEIDER-710-X6', 4),
  ('CERVEZA-LATA-SCHNEIDER-710-X6', 'CERVEZA-LATA-SCHNEIDER-710-UN', 6),
  ('CERVEZA-LATA-HEINEKEN-710-X24', 'CERVEZA-LATA-HEINEKEN-710-X6', 4),
  ('CERVEZA-LATA-HEINEKEN-710-X6', 'CERVEZA-LATA-HEINEKEN-710-UN', 6),
  ('CERVEZA-LATA-QUILMES1890-710-X16', 'CERVEZA-LATA-QUILMES1890-710-X4', 4),
  -- Cepita: pack x6 -> unidad (factor 6)
  ('GASEOSA-CEPITA-1000-X6', 'GASEOSA-CEPITA-1000-UN', 6)
) as v(codigo_grande, codigo_chico, factor)
join skus as chico on chico.codigo_interno = v.codigo_chico
where grande.codigo_interno = v.codigo_grande;

commit;
