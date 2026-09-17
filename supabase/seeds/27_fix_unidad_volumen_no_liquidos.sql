-- Corrige un supuesto mío equivocado, repetido en varias tandas: para
-- productos que no son líquidos (tabaco, snacks/frutos secos, regalería,
-- encendedores) usé volumen=1 / unidad_volumen='ml' como RELLENO sin
-- significado real, porque en su momento la constraint de `skus` solo
-- aceptaba 'ml'/'l'. Eso ya se resolvió en
-- 20260910090000_unidad_volumen_un_gramo.sql (agregó 'un' y 'g'), pero las
-- filas que ya estaban cargadas de antes de esa migración -- y las que
-- cargué después sin darme cuenta de que ya podía usar el valor real --
-- se quedaron con el relleno viejo. Afecta: 04_tabacos.sql,
-- 24_laprida_otros.sql, 25_laprida_tabaco.sql,
-- 26_laprida_encendedores_regaleria_porron.sql (esos cuatro archivos ya
-- quedaron corregidos para que una carga nueva salga bien de una).
--
-- codigo_interno es una etiqueta interna (no una FK), corregir estas
-- columnas no rompe nada: todo lo demás referencia estos SKU por su id
-- (uuid). No toca precios, stock ni nada que dependa de volumen/unidad
-- para calcular algo -- ese campo hoy es solo informativo para estos
-- productos.

begin;

-- Paso 1: todo lo que tenía el relleno viejo (volumen=1, unidad='ml') en
-- estas cuatro categorías pasa a 'un' (1 unidad de venta -- paquete, lata,
-- bolsa, pieza -- sin gramaje/volumen real conocido).
update skus
set unidad_volumen = 'un'
where volumen = 1
  and unidad_volumen = 'ml'
  and (
    codigo_interno like 'TABACO-%'
    or codigo_interno = 'PAPELILLOS-LRC-SAYRI'
    or codigo_interno like 'OTROS-%'
    or codigo_interno like 'ENCENDEDOR-%'
    or codigo_interno like 'REGALO-%'
  );

-- Paso 2: las únicas líneas de esas categorías con gramaje REAL conocido
-- (la lista lo aclaraba en el nombre) se corrigen a 'g' con el peso real,
-- pisando el 'un' que les puso el paso anterior.
update skus set volumen = 50, unidad_volumen = 'g'
where codigo_interno in ('TABACO-ARGENTO-PIPA-EL-AZUL', 'TABACO-ARGENTO-PIPA-EL-NEGRA');

update skus set volumen = 105, unidad_volumen = 'g'
where codigo_interno = 'OTROS-PRINGLES-105-UN';

commit;
