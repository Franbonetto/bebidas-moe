-- Corrige un supuesto mío equivocado en 07_cerveza_latas.sql: asumí "lata
-- estándar = 354cc" (comentario "Supuestos" de ese archivo), pero el
-- usuario aclaró que la lata mínima real es de 473cc. Corrige volumen,
-- nombre y codigo_interno de todos los SKU de esa tanda (packs x24, x6 y
-- unidad suelta) -- no toca los de 710cc, esos sí venían confirmados
-- explícitos en la lista de precios original.
--
-- codigo_interno es una etiqueta interna (no una FK), renombrarla no
-- rompe nada: todo lo demás referencia estos SKU por su id (uuid).

begin;

update skus
set
  volumen = 473,
  nombre = replace(nombre, '354cc', '473cc'),
  codigo_interno = replace(codigo_interno, '-354-', '-473-')
where codigo_interno like 'CERVEZA-LATA-%-354-%';

commit;
