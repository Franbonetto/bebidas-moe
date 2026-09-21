-- Carga real de catálogo + precios de Laprida — secciones "CERVEZAS
-- LITRO", "Latón 710ml", "Latas 473ml" y las latas grandes sueltas (Faxe,
-- Golden Drak, Coca-Cola+Jack Daniel's) de la lista de Laprida (12/09/26).
--
-- Reusa marcas/productos ya existentes de 05/06/07_cerveza_*.sql
-- (retornable, descartable, lata con cascada) para todo lo que ya estaba
-- cargado -- override de precio de Laprida, no duplicado. "Jack Daniel's"
-- también se reutiliza de 09_whisky.sql para el RTD de lata.
--
-- Casos donde el override aplica a VARIAS SKU con el mismo precio, porque
-- la lista de Laprida no distingue variedad (mismo criterio que "Andes
-- (todas)" en la sección litro):
--   - "Andes" (lata 473cc, sin decir Roja/Negra) -> mismo precio para
--     Andes Roja y Andes Negra en lata.
--   - "Imperial" (lata 473cc, sin variedad) -> mismo precio para las 5
--     variedades de Imperial en lata (Lager, Golden, Ipa, Roja, Negra).
--
-- Altas nuevas (no existían):
--   - SKU "unidad suelta" de Latón 710cc para Schneider y Heineken -- el
--     comentario de 07_cerveza_latas.sql decía explícitamente que la lista
--     original no traía ese tamaño suelto; ahora la lista de Laprida sí
--     lo tiene, así que se agrega como tier 3 de la cascada existente
--     (desarma del x6 · 710cc, factor 6).
--   - SKU de lata para Stella Artois (nunca existió en lata, solo
--     retornable y porrón) -- se agrega como SKU nuevo del producto
--     'Stella Artois' ya existente, sin relación de desarme (no hay pack
--     x6/x24 confirmado en la lista).
--   - Marcas/productos totalmente nuevos: Cheverry, Patagonia, Peñón
--     Águila (3 variedades: Mexican, October, Wald Bierd -- esta última
--     puede ser "Weiss/Weizen" mal escrito, revisar), Stones (Limón,
--     Maracuyá), Faxe (10% y Premium, lata de 1L), Golden Drak (330cc), y
--     el RTD "Jack Daniel's & Cola" en lata de 269cc (marca Jack Daniel's
--     ya existente, producto nuevo).
--
-- No se cargó la segunda mención de "Heineken $5400" en la sección litro
-- (aparece dos veces en la planilla con el mismo precio) -- ya está
-- cubierta por el primer override.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values
  ('Cheverry'), ('Patagonia'), ('Peñón Águila'), ('Stones'), ('Faxe'), ('Golden Drak');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Cerveza')
from (values
  ('Cheverry', 'Cheverry'),
  ('Patagonia', 'Patagonia'),
  ('Peñón Águila Mexican', 'Peñón Águila'),
  ('Peñón Águila October', 'Peñón Águila'),
  ('Peñón Águila Wald Bierd', 'Peñón Águila'),
  ('Stones Limón', 'Stones'),
  ('Stones Maracuyá', 'Stones'),
  ('Faxe 10%', 'Faxe'),
  ('Faxe Premium', 'Faxe'),
  ('Golden Drak', 'Golden Drak'),
  ('Jack Daniel''s & Cola', 'Jack Daniel''s')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

-- SKUs nuevos independientes (sin relación de desarme)
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Stella Artois', 'Stella Artois Lata 473cc', 'CERVEZA-LATA-STELLA-473-UN', 473),
  ('Cheverry', 'Cheverry Lata 473cc', 'CERVEZA-CHEVERRY-473-UN', 473),
  ('Patagonia', 'Patagonia Lata 473cc', 'CERVEZA-PATAGONIA-473-UN', 473),
  ('Peñón Águila Mexican', 'Peñón Águila Mexican Lata 473cc', 'CERVEZA-PENONAGUILA-MEXICAN-473-UN', 473),
  ('Peñón Águila October', 'Peñón Águila October Lata 473cc', 'CERVEZA-PENONAGUILA-OCTOBER-473-UN', 473),
  ('Peñón Águila Wald Bierd', 'Peñón Águila Wald Bierd Lata 473cc', 'CERVEZA-PENONAGUILA-WALDBIERD-473-UN', 473),
  ('Stones Limón', 'Stones Limón Lata 473cc', 'CERVEZA-STONES-LIMON-473-UN', 473),
  ('Stones Maracuyá', 'Stones Maracuyá Lata 473cc', 'CERVEZA-STONES-MARACUYA-473-UN', 473),
  ('Faxe 10%', 'Faxe 10% Lata 1L', 'CERVEZA-FAXE-10-1000-UN', 1000),
  ('Faxe Premium', 'Faxe Premium Lata 1L', 'CERVEZA-FAXE-PREMIUM-1000-UN', 1000),
  ('Golden Drak', 'Golden Drak Lata 330cc', 'CERVEZA-GOLDENDRAK-330-UN', 330),
  ('Jack Daniel''s & Cola', 'Jack Daniel''s & Cola Lata 269cc', 'CERVEZA-JDCOLA-269-UN', 269)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto
  and p.categoria_id = (select id from categorias where nombre = 'Cerveza');

-- SKUs nuevos que sí completan una cascada existente (tier 3 de 710cc,
-- desarman del x6 · 710cc correspondiente, factor 6). Se insertan SIN
-- desarma_en_sku_id (son el tier más chico, no desarman en nada) y en vez
-- de eso se completa el x6 -710 YA EXISTENTE (de 07_cerveza_latas.sql)
-- para que apunte para acá -- dirección correcta: el grande apunta al
-- chico (ver 28_fix_direccion_cascada_desarme.sql).
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', 710, 'ml', 1
from (values
  ('Schneider', 'Schneider', 'Schneider Latón 710cc', 'CERVEZA-LATA-SCHNEIDER-710-UN'),
  ('Heineken', 'Heineken', 'Heineken Latón 710cc', 'CERVEZA-LATA-HEINEKEN-710-UN')
) as v(producto, marca, nombre_sku, codigo)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

update skus as grande
set desarma_en_sku_id = chico.id, desarma_en_cantidad = 6
from (values
  ('CERVEZA-LATA-SCHNEIDER-710-X6', 'CERVEZA-LATA-SCHNEIDER-710-UN'),
  ('CERVEZA-LATA-HEINEKEN-710-X6', 'CERVEZA-LATA-HEINEKEN-710-UN')
) as v(codigo_grande, codigo_chico)
join skus as chico on chico.codigo_interno = v.codigo_chico
where grande.codigo_interno = v.codigo_grande;

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  -- Retornable 1L (05_cerveza_retornable.sql)
  ('CERVEZA-RETORNABLE-STELLA-1000', 6300),
  ('CERVEZA-RETORNABLE-QUILMES-1000', 4100),
  ('CERVEZA-RETORNABLE-AMSTEL-1000', 4500),
  ('CERVEZA-RETORNABLE-HEINEKEN-1000', 5400),
  ('CERVEZA-RETORNABLE-IMPIPA-1000', 5400),
  ('CERVEZA-RETORNABLE-BRAHMA-1000', 4200),
  ('CERVEZA-RETORNABLE-IMPLAGER-1000', 4500),
  ('CERVEZA-RETORNABLE-IMPGOLDEN-1000', 4500),
  ('CERVEZA-RETORNABLE-BUDWEISER-1000', 4500),
  ('CERVEZA-RETORNABLE-ANDES-1000', 5400),
  -- Latas 473cc existentes (07_cerveza_latas.sql)
  ('CERVEZA-LATA-HEINEKEN-473-UN', 2900),
  ('CERVEZA-LATA-ANDESROJA-473-UN', 2400),
  ('CERVEZA-LATA-ANDESNEGRA-473-UN', 2400),
  ('CERVEZA-LATA-IMPLAGER-473-UN', 2500),
  ('CERVEZA-LATA-IMPGOLDEN-473-UN', 2500),
  ('CERVEZA-LATA-IMPIPA-473-UN', 2500),
  ('CERVEZA-LATA-IMPROJA-473-UN', 2500),
  ('CERVEZA-LATA-IMPNEGRA-473-UN', 2500),
  ('CERVEZA-LATA-AMSTEL-473-UN', 2200),
  ('CERVEZA-LATA-QUILMES1890-473-UN', 1600),
  ('CERVEZA-LATA-SCHNEIDER-473-UN', 1800),
  ('CERVEZA-LATA-ESTRELLAGALICIA-473-UN', 3300),
  -- SKUs nuevos
  ('CERVEZA-LATA-SCHNEIDER-710-UN', 3000),
  ('CERVEZA-LATA-HEINEKEN-710-UN', 4400),
  ('CERVEZA-LATA-STELLA-473-UN', 2800),
  ('CERVEZA-CHEVERRY-473-UN', 4200),
  ('CERVEZA-PATAGONIA-473-UN', 3100),
  ('CERVEZA-PENONAGUILA-MEXICAN-473-UN', 2100),
  ('CERVEZA-PENONAGUILA-OCTOBER-473-UN', 1800),
  ('CERVEZA-PENONAGUILA-WALDBIERD-473-UN', 1900),
  ('CERVEZA-STONES-LIMON-473-UN', 2500),
  ('CERVEZA-STONES-MARACUYA-473-UN', 2500),
  ('CERVEZA-FAXE-10-1000-UN', 13500),
  ('CERVEZA-FAXE-PREMIUM-1000-UN', 12500),
  ('CERVEZA-GOLDENDRAK-330-UN', 9000),
  ('CERVEZA-JDCOLA-269-UN', 3100)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
