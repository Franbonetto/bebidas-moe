-- Carga real de catálogo — CERVEZA EN LATA con cascada (séptima tanda).
-- Fuente: lista de precios de Moe, secciones "Precios pack por 6 latas" y
-- "Latas de Cervezas. Packs por 24 latas".
--
-- Reusa marcas/productos "Imperial Lager", "Imperial Golden", "Imperial
-- Ipa", "Amstel", "Heineken" de tandas anteriores (misma cerveza, formato
-- lata en vez de retornable/porrón -- mismo criterio que la tanda de
-- descartables).
--
-- Confirmado con el usuario: se arma la cascada x24→4×x6→6×unidad
-- (desarma_en_sku_id + desarma_en_cantidad) para cada marca, aunque la
-- lista no traiga precio de la lata suelta -- el SKU "unidad" se crea SIN
-- fila en `precios` (va a aparecer "Sin precio cargado" hasta que me
-- pases el número real de venta por unidad).
--
-- Dirección de desarma_en_sku_id/desarma_en_cantidad (corregida
-- 2026-09-20, ver 28_fix_direccion_cascada_desarme.sql): el SKU más
-- GRANDE de cada cascada apunta al siguiente más chico, con la cantidad
-- que rinde -- así lo esperan desarmar_sku() y el POS
-- (vender/page.tsx). Por eso los 3 tiers se insertan primero SIN estas
-- columnas y se completan al final, cuando ya existen los tres niveles:
-- insertarlas en el mismo insert de cada tier (como estaba antes)
-- obligaba a que el SKU chico ya existiera, y de paso quedó apuntando en
-- el sentido incorrecto (chico -> grande) las primeras veces que se
-- escribió este archivo.
--
-- Ninguna de estas marcas se cargó con cascada_cerveza_lata=true (el
-- modo de precio automático por costo, arquitectura.md 1.7): ese modo
-- necesita costo_actual real, que no existe todavía (no hay compras
-- cargadas). Quedan como precio manual -- se puede activar la cascada de
-- precio más adelante desde /precios, sku por sku, cuando haya costos
-- reales.
--
-- Supuestos:
--   1. "Lata" estándar = 473cc salvo que la lista diga "710cc" explícito.
--   2. Estrella Galicia, Antares y Schneider Limón solo traen precio de
--      pack x6 en la lista (sin x24) -- quedan como tope de su propia
--      cascada (su x6 no desarma de ningún x24, porque no existe).
--   3. "Andes Roja y Negra $12.200 / $48.200" se leyó como DOS productos
--      distintos (Andes Roja, Andes Negra) con el mismo precio -- mismo
--      criterio de sabor/variedad = producto distinto del resto de la
--      lista.
--   4. Quilmes 1890 en lata 710cc usa una cascada propia de x16→4×x4 (los
--      tamaños que trae la lista para ese formato), no x24→x6.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values
  ('Estrella Galicia'), ('Antares'), ('Schneider'), ('Grolsch');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Cerveza')
from (values
  ('Estrella Galicia', 'Estrella Galicia'),
  ('Antares', 'Antares'),
  ('Imperial Roja', 'Imperial'),
  ('Imperial Negra', 'Imperial'),
  ('Schneider', 'Schneider'),
  ('Schneider Limón', 'Schneider'),
  ('Grolsch', 'Grolsch'),
  ('Quilmes 1890', 'Quilmes'),
  ('Andes Roja', 'Andes'),
  ('Andes Negra', 'Andes')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

-- ---------------------------------------------------------
-- Tier 1: packs x24 (473cc) y x24/x16 (710cc) -- tope de cada cascada
-- ---------------------------------------------------------
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'pack', v.volumen, 'ml', v.unidades
from (values
  ('Schneider', 'Schneider', 'Schneider Pack x24 · 473cc', 'CERVEZA-LATA-SCHNEIDER-473-X24', 473, 24),
  ('Imperial Lager', 'Imperial', 'Imperial Lager Pack x24 · 473cc', 'CERVEZA-LATA-IMPLAGER-473-X24', 473, 24),
  ('Imperial Golden', 'Imperial', 'Imperial Golden Pack x24 · 473cc', 'CERVEZA-LATA-IMPGOLDEN-473-X24', 473, 24),
  ('Imperial Ipa', 'Imperial', 'Imperial Ipa Pack x24 · 473cc', 'CERVEZA-LATA-IMPIPA-473-X24', 473, 24),
  ('Imperial Negra', 'Imperial', 'Imperial Negra Pack x24 · 473cc', 'CERVEZA-LATA-IMPNEGRA-473-X24', 473, 24),
  ('Imperial Roja', 'Imperial', 'Imperial Roja Pack x24 · 473cc', 'CERVEZA-LATA-IMPROJA-473-X24', 473, 24),
  ('Heineken', 'Heineken', 'Heineken Pack x24 · 473cc', 'CERVEZA-LATA-HEINEKEN-473-X24', 473, 24),
  ('Quilmes 1890', 'Quilmes', 'Quilmes 1890 Pack x24 · 473cc', 'CERVEZA-LATA-QUILMES1890-473-X24', 473, 24),
  ('Grolsch', 'Grolsch', 'Grolsch Pack x24 · 473cc', 'CERVEZA-LATA-GROLSCH-473-X24', 473, 24),
  ('Andes Roja', 'Andes', 'Andes Roja Pack x24 · 473cc', 'CERVEZA-LATA-ANDESROJA-473-X24', 473, 24),
  ('Andes Negra', 'Andes', 'Andes Negra Pack x24 · 473cc', 'CERVEZA-LATA-ANDESNEGRA-473-X24', 473, 24),
  ('Amstel', 'Amstel', 'Amstel Pack x24 · 473cc', 'CERVEZA-LATA-AMSTEL-473-X24', 473, 24),
  ('Schneider', 'Schneider', 'Schneider Pack x24 · 710cc', 'CERVEZA-LATA-SCHNEIDER-710-X24', 710, 24),
  ('Heineken', 'Heineken', 'Heineken Pack x24 · 710cc', 'CERVEZA-LATA-HEINEKEN-710-X24', 710, 24),
  ('Quilmes 1890', 'Quilmes', 'Quilmes 1890 Pack x16 · 710cc', 'CERVEZA-LATA-QUILMES1890-710-X16', 710, 16)
) as v(producto, marca, nombre_sku, codigo, volumen, unidades)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- ---------------------------------------------------------
-- Tier 2: packs x6 (473cc) y x6/x4 (710cc) -- desarman del tier 1
-- correspondiente cuando existe (factor 4); Estrella Galicia, Antares y
-- Schneider Limón no tienen x24, quedan como tope de su propia cascada.
-- ---------------------------------------------------------
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'pack', v.volumen, 'ml', v.unidades
from (values
  ('Estrella Galicia', 'Estrella Galicia', 'Estrella Galicia Pack x6 · 473cc', 'CERVEZA-LATA-ESTRELLAGALICIA-473-X6', 473, 6),
  ('Antares', 'Antares', 'Antares Pack x6 · 473cc', 'CERVEZA-LATA-ANTARES-473-X6', 473, 6),
  ('Imperial Lager', 'Imperial', 'Imperial Lager Pack x6 · 473cc', 'CERVEZA-LATA-IMPLAGER-473-X6', 473, 6),
  ('Imperial Golden', 'Imperial', 'Imperial Golden Pack x6 · 473cc', 'CERVEZA-LATA-IMPGOLDEN-473-X6', 473, 6),
  ('Imperial Roja', 'Imperial', 'Imperial Roja Pack x6 · 473cc', 'CERVEZA-LATA-IMPROJA-473-X6', 473, 6),
  ('Imperial Negra', 'Imperial', 'Imperial Negra Pack x6 · 473cc', 'CERVEZA-LATA-IMPNEGRA-473-X6', 473, 6),
  ('Imperial Ipa', 'Imperial', 'Imperial Ipa Pack x6 · 473cc', 'CERVEZA-LATA-IMPIPA-473-X6', 473, 6),
  ('Schneider', 'Schneider', 'Schneider Pack x6 · 473cc', 'CERVEZA-LATA-SCHNEIDER-473-X6', 473, 6),
  ('Schneider Limón', 'Schneider', 'Schneider Limón Pack x6 · 473cc', 'CERVEZA-LATA-SCHNEIDERLIMON-473-X6', 473, 6),
  ('Grolsch', 'Grolsch', 'Grolsch Pack x6 · 473cc', 'CERVEZA-LATA-GROLSCH-473-X6', 473, 6),
  ('Amstel', 'Amstel', 'Amstel Pack x6 · 473cc', 'CERVEZA-LATA-AMSTEL-473-X6', 473, 6),
  ('Heineken', 'Heineken', 'Heineken Pack x6 · 473cc', 'CERVEZA-LATA-HEINEKEN-473-X6', 473, 6),
  ('Quilmes 1890', 'Quilmes', 'Quilmes 1890 Pack x6 · 473cc', 'CERVEZA-LATA-QUILMES1890-473-X6', 473, 6),
  ('Andes Roja', 'Andes', 'Andes Roja Pack x6 · 473cc', 'CERVEZA-LATA-ANDESROJA-473-X6', 473, 6),
  ('Andes Negra', 'Andes', 'Andes Negra Pack x6 · 473cc', 'CERVEZA-LATA-ANDESNEGRA-473-X6', 473, 6),
  ('Schneider', 'Schneider', 'Schneider Pack x6 · 710cc', 'CERVEZA-LATA-SCHNEIDER-710-X6', 710, 6),
  ('Heineken', 'Heineken', 'Heineken Pack x6 · 710cc', 'CERVEZA-LATA-HEINEKEN-710-X6', 710, 6),
  ('Quilmes 1890', 'Quilmes', 'Quilmes 1890 Pack x4 · 710cc', 'CERVEZA-LATA-QUILMES1890-710-X4', 710, 4)
) as v(producto, marca, nombre_sku, codigo, volumen, unidades)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- ---------------------------------------------------------
-- Tier 3: unidad suelta (473cc), SIN precio -- desarma del x6
-- correspondiente (factor 6). No hay tier "unidad" para 710cc: la lista
-- no menciona lata 710cc suelta en ningún lado.
-- ---------------------------------------------------------
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', 473, 'ml', 1
from (values
  ('Estrella Galicia', 'Estrella Galicia', 'Estrella Galicia 473cc', 'CERVEZA-LATA-ESTRELLAGALICIA-473-UN'),
  ('Antares', 'Antares', 'Antares 473cc', 'CERVEZA-LATA-ANTARES-473-UN'),
  ('Imperial Lager', 'Imperial', 'Imperial Lager 473cc', 'CERVEZA-LATA-IMPLAGER-473-UN'),
  ('Imperial Golden', 'Imperial', 'Imperial Golden 473cc', 'CERVEZA-LATA-IMPGOLDEN-473-UN'),
  ('Imperial Roja', 'Imperial', 'Imperial Roja 473cc', 'CERVEZA-LATA-IMPROJA-473-UN'),
  ('Imperial Negra', 'Imperial', 'Imperial Negra 473cc', 'CERVEZA-LATA-IMPNEGRA-473-UN'),
  ('Imperial Ipa', 'Imperial', 'Imperial Ipa 473cc', 'CERVEZA-LATA-IMPIPA-473-UN'),
  ('Schneider', 'Schneider', 'Schneider 473cc', 'CERVEZA-LATA-SCHNEIDER-473-UN'),
  ('Schneider Limón', 'Schneider', 'Schneider Limón 473cc', 'CERVEZA-LATA-SCHNEIDERLIMON-473-UN'),
  ('Grolsch', 'Grolsch', 'Grolsch 473cc', 'CERVEZA-LATA-GROLSCH-473-UN'),
  ('Amstel', 'Amstel', 'Amstel 473cc', 'CERVEZA-LATA-AMSTEL-473-UN'),
  ('Heineken', 'Heineken', 'Heineken 473cc', 'CERVEZA-LATA-HEINEKEN-473-UN'),
  ('Quilmes 1890', 'Quilmes', 'Quilmes 1890 473cc', 'CERVEZA-LATA-QUILMES1890-473-UN'),
  ('Andes Roja', 'Andes', 'Andes Roja 473cc', 'CERVEZA-LATA-ANDESROJA-473-UN'),
  ('Andes Negra', 'Andes', 'Andes Negra 473cc', 'CERVEZA-LATA-ANDESNEGRA-473-UN')
) as v(producto, marca, nombre_sku, codigo)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- ---------------------------------------------------------
-- Ahora que existen los 3 tiers, se completa desarma_en_sku_id/cantidad
-- en la dirección correcta: el grande apunta al chico (ver aviso arriba).
-- ---------------------------------------------------------
update skus as grande
set desarma_en_sku_id = chico.id,
    desarma_en_cantidad = v.factor
from (values
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
  ('CERVEZA-LATA-SCHNEIDER-710-X24', 'CERVEZA-LATA-SCHNEIDER-710-X6', 4),
  ('CERVEZA-LATA-HEINEKEN-710-X24', 'CERVEZA-LATA-HEINEKEN-710-X6', 4),
  ('CERVEZA-LATA-QUILMES1890-710-X16', 'CERVEZA-LATA-QUILMES1890-710-X4', 4)
  -- Schneider/Heineken 710cc no tienen unidad suelta EN ESTA tanda -- esa
  -- se agregó recién en 22_laprida_cervezas.sql, que ya completa su
  -- propio desarme x6->unidad ahí (no hace falta acá).
) as v(codigo_grande, codigo_chico, factor)
join skus as chico on chico.codigo_interno = v.codigo_chico
where grande.codigo_interno = v.codigo_grande;

-- ---------------------------------------------------------
-- Precios (solo x24/x16/x6/x4 -- los "unidad" quedan sin precio)
-- ---------------------------------------------------------
insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('CERVEZA-LATA-SCHNEIDER-473-X24', 37800),
  ('CERVEZA-LATA-IMPLAGER-473-X24', 50100),
  ('CERVEZA-LATA-IMPGOLDEN-473-X24', 50100),
  ('CERVEZA-LATA-IMPIPA-473-X24', 55300),
  ('CERVEZA-LATA-IMPNEGRA-473-X24', 55300),
  ('CERVEZA-LATA-IMPROJA-473-X24', 55300),
  ('CERVEZA-LATA-HEINEKEN-473-X24', 65200),
  ('CERVEZA-LATA-QUILMES1890-473-X24', 33900),
  ('CERVEZA-LATA-GROLSCH-473-X24', 62400),
  ('CERVEZA-LATA-ANDESROJA-473-X24', 48200),
  ('CERVEZA-LATA-ANDESNEGRA-473-X24', 48200),
  ('CERVEZA-LATA-AMSTEL-473-X24', 45400),
  ('CERVEZA-LATA-SCHNEIDER-710-X24', 65550),
  ('CERVEZA-LATA-HEINEKEN-710-X24', 110750),
  ('CERVEZA-LATA-QUILMES1890-710-X16', 26800),
  ('CERVEZA-LATA-ESTRELLAGALICIA-473-X6', 18750),
  ('CERVEZA-LATA-ANTARES-473-X6', 16200),
  ('CERVEZA-LATA-IMPLAGER-473-X6', 12700),
  ('CERVEZA-LATA-IMPGOLDEN-473-X6', 12700),
  ('CERVEZA-LATA-IMPROJA-473-X6', 13950),
  ('CERVEZA-LATA-IMPNEGRA-473-X6', 13950),
  ('CERVEZA-LATA-IMPIPA-473-X6', 13950),
  ('CERVEZA-LATA-SCHNEIDER-473-X6', 9600),
  ('CERVEZA-LATA-SCHNEIDERLIMON-473-X6', 11450),
  ('CERVEZA-LATA-GROLSCH-473-X6', 15700),
  ('CERVEZA-LATA-AMSTEL-473-X6', 11500),
  ('CERVEZA-LATA-HEINEKEN-473-X6', 16400),
  ('CERVEZA-LATA-QUILMES1890-473-X6', 8600),
  ('CERVEZA-LATA-ANDESROJA-473-X6', 12200),
  ('CERVEZA-LATA-ANDESNEGRA-473-X6', 12200),
  ('CERVEZA-LATA-SCHNEIDER-710-X6', 16500),
  ('CERVEZA-LATA-HEINEKEN-710-X6', 25300),
  ('CERVEZA-LATA-QUILMES1890-710-X4', 6800)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

commit;
