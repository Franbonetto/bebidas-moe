-- Bloque ARCA: alícuota de IVA por categoría, para desglosar
-- importe_neto/importe_iva al facturar sin hardcodear el 21% en el
-- código (docs/arquitectura.md 1.8, "Desglose de IVA"). Confirmado por
-- el dueño 2026-09-07: hoy todo el catálogo de Bebidas Moe va al 21%
-- (tasa general; la bebidass alcohólicas no acceden a alícuota reducida),
-- pero el dato vive en la categoría para poder cambiarlo sin tocar código
-- si algún día se suma algo con otro tratamiento.
--
-- No hace falta grant nuevo: categorias ya tiene sus grants/RLS de
-- siempre (bloque2_catalogo.sql), esto solo agrega una columna.

alter table categorias add column alicuota_iva numeric(5, 2) not null default 21;
