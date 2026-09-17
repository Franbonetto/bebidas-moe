-- Carga real de catálogo + precios de Laprida — secciones "ENCENDEDORES",
-- "ACCESORIOS / REGALERÍA" y "PORRÓN 330 cc" de la lista de Laprida
-- (12/09/26).
--
-- Encendedores y Regalería son categorías nuevas, sin nada cargado antes.
-- Ninguna de las dos son bebidas ni se venden por peso -- volumen=1 con
-- unidad_volumen='un' (1 unidad), mismo criterio que tabaco
-- (04_tabacos.sql).
--
-- Regalería reutiliza marcas ya existentes de otras categorías cuando el
-- accesorio es de una marca de bebida puntual (Stella Artois, Corona,
-- Merle, Runa, Trumpeter, La Scala, Sernova, Animal) -- son la misma
-- marca real, el producto de regalería es propio. Para los accesorios sin
-- marca de bebida asociada (vaso, decantador, caja de madera, cubiertos,
-- fernets temáticos) se creó una marca "Moe" para agrupar la mercadería
-- propia de la casa.
--
-- "Gin Tirado litro $7.700" es el mismo producto que "Runa Tirado
-- Arándanos 1L (sin botella)" ya cargado en 01_gin.sql (GIN-RUNA-
-- ARANDANOS-1000-SB, base $7.600) -- se agrega el override ahí, no se
-- duplica.
--
-- Porrón 330cc cruza con 06_cerveza_descartable.sql: Miller, Corona,
-- Imperial Golden, Heineken y Stella 0% son overrides directos. "Miller
-- 660cc" y "Corona 710cc" son SKU nuevos de esos mismos productos (el
-- catálogo solo tenía Miller 600cc y ningún Corona grande).

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Encendedores'), ('Regalería');

insert into marcas (nombre) values ('Encendedor'), ('Moe');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = v.categoria)
from (values
  ('Encendedor Lata Plateada', 'Encendedor', 'Encendedores'),
  ('Encendedor Soplete', 'Encendedor', 'Encendedores'),
  ('Encendedor Bencina Labrado', 'Encendedor', 'Encendedores'),
  ('Encendedor Bencina Color', 'Encendedor', 'Encendedores'),
  ('Encendedor Bencina Clásico', 'Encendedor', 'Encendedores'),
  ('Encendedor Animados', 'Encendedor', 'Encendedores'),
  ('Vaso Fernet Moe', 'Moe', 'Regalería'),
  ('Frapera Stella', 'Stella Artois', 'Regalería'),
  ('Conservadora Corona', 'Corona', 'Regalería'),
  ('Fernet Menta x2', 'Moe', 'Regalería'),
  ('Fernet Mundial', 'Moe', 'Regalería'),
  ('Tenedor + Cuchillo', 'Moe', 'Regalería'),
  ('Estuche Merle', 'Merle', 'Regalería'),
  ('Runa + Copa', 'Runa', 'Regalería'),
  ('Estuche Trumpeter', 'Trumpeter', 'Regalería'),
  ('Estuche Limoncello La Scala', 'La Scala', 'Regalería'),
  ('Decantador', 'Moe', 'Regalería'),
  ('Caja Madera para Vino', 'Moe', 'Regalería'),
  ('Estuche Merle River', 'Merle', 'Regalería'),
  ('Estuche Sernova', 'Sernova', 'Regalería'),
  ('Estuche Animal x6', 'Animal', 'Regalería')
) as v(nombre, marca, categoria)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, v.tipo, 1, 'un', v.unidades
from (values
  ('Encendedor Lata Plateada', 'Encendedor Lata Plateada', 'ENCENDEDOR-LATAPLATEADA-UN', 'unidad', 1),
  ('Encendedor Soplete', 'Encendedor Soplete', 'ENCENDEDOR-SOPLETE-UN', 'unidad', 1),
  ('Encendedor Bencina Labrado', 'Encendedor Bencina Labrado', 'ENCENDEDOR-BENCINALABRADO-UN', 'unidad', 1),
  ('Encendedor Bencina Color', 'Encendedor Bencina Color', 'ENCENDEDOR-BENCINACOLOR-UN', 'unidad', 1),
  ('Encendedor Bencina Clásico', 'Encendedor Bencina Clásico', 'ENCENDEDOR-BENCINACLASICO-UN', 'unidad', 1),
  ('Encendedor Animados', 'Encendedor Animados', 'ENCENDEDOR-ANIMADOS-UN', 'unidad', 1),
  ('Vaso Fernet Moe', 'Vaso Fernet Moe', 'REGALO-VASOFERNETMOE-UN', 'unidad', 1),
  ('Frapera Stella', 'Frapera Stella', 'REGALO-FRAPERASTELLA-UN', 'unidad', 1),
  ('Conservadora Corona', 'Conservadora Corona', 'REGALO-CONSERVADORACORONA-UN', 'unidad', 1),
  ('Fernet Menta x2', 'Fernet Menta x2', 'REGALO-FERNETMENTAX2-UN', 'estuche', 2),
  ('Fernet Mundial', 'Fernet Mundial', 'REGALO-FERNETMUNDIAL-UN', 'unidad', 1),
  ('Tenedor + Cuchillo', 'Tenedor + Cuchillo', 'REGALO-TENEDORCUCHILLO-UN', 'estuche', 1),
  ('Estuche Merle', 'Estuche Merle', 'REGALO-ESTUCHEMERLE-UN', 'estuche', 1),
  ('Runa + Copa', 'Runa + Copa', 'REGALO-RUNACOPA-UN', 'estuche', 1),
  ('Estuche Trumpeter', 'Estuche Trumpeter', 'REGALO-ESTUCHETRUMPETER-UN', 'estuche', 1),
  ('Estuche Limoncello La Scala', 'Estuche Limoncello La Scala', 'REGALO-LIMONCELLOLASCALA-UN', 'estuche', 1),
  ('Decantador', 'Decantador', 'REGALO-DECANTADOR-UN', 'unidad', 1),
  ('Caja Madera para Vino', 'Caja Madera para Vino', 'REGALO-CAJAMADERAVINO-UN', 'unidad', 1),
  ('Estuche Merle River', 'Estuche Merle River', 'REGALO-ESTUCHEMERLERIVER-UN', 'estuche', 1),
  ('Estuche Sernova', 'Estuche Sernova', 'REGALO-ESTUCHESERNOVA-UN', 'estuche', 1),
  ('Estuche Animal x6', 'Estuche Animal x6', 'REGALO-ESTUCHEANIMALX6-UN', 'estuche', 6)
) as v(producto, nombre_sku, codigo, tipo, unidades)
join productos p on p.nombre = v.producto
  and p.categoria_id in (select id from categorias where nombre in ('Encendedores', 'Regalería'));

-- Porrón: SKU nuevos que faltaban en 06_cerveza_descartable.sql
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, es_retornable)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1, false
from (values
  ('Miller', 'Miller', 'Miller 660cc', 'CERVEZA-DESC-MILLER-660', 660),
  ('Corona', 'Corona', 'Corona 710cc', 'CERVEZA-DESC-CORONA-710', 710)
) as v(producto, marca, nombre_sku, codigo, volumen)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  -- Encendedores
  ('ENCENDEDOR-LATAPLATEADA-UN', 7200),
  ('ENCENDEDOR-SOPLETE-UN', 13700),
  ('ENCENDEDOR-BENCINALABRADO-UN', 10200),
  ('ENCENDEDOR-BENCINACOLOR-UN', 11800),
  ('ENCENDEDOR-BENCINACLASICO-UN', 3700),
  ('ENCENDEDOR-ANIMADOS-UN', 5500),
  -- Regalería
  ('REGALO-VASOFERNETMOE-UN', 12000),
  ('REGALO-FRAPERASTELLA-UN', 40000),
  ('REGALO-CONSERVADORACORONA-UN', 110000),
  ('REGALO-FERNETMENTAX2-UN', 28000),
  ('REGALO-FERNETMUNDIAL-UN', 21000),
  ('REGALO-TENEDORCUCHILLO-UN', 25000),
  ('REGALO-ESTUCHEMERLE-UN', 45000),
  ('REGALO-RUNACOPA-UN', 29450),
  ('REGALO-ESTUCHETRUMPETER-UN', 28000),
  ('REGALO-LIMONCELLOLASCALA-UN', 26000),
  ('REGALO-DECANTADOR-UN', 24000),
  ('REGALO-CAJAMADERAVINO-UN', 25000),
  ('REGALO-ESTUCHEMERLERIVER-UN', 29000),
  ('REGALO-ESTUCHESERNOVA-UN', 28000),
  ('REGALO-ESTUCHEANIMALX6-UN', 79300),
  ('GIN-RUNA-ARANDANOS-1000-SB', 7700),
  -- Porrón 330cc (overrides sobre 06_cerveza_descartable.sql)
  ('CERVEZA-DESC-MILLER-330', 2750),
  ('CERVEZA-DESC-CORONA-330', 3400),
  ('CERVEZA-DESC-IMPGOLDEN-330', 2100),
  ('CERVEZA-DESC-HEINEKEN-330', 2900),
  ('CERVEZA-DESC-STELLA0-330', 1800),
  ('CERVEZA-DESC-MILLER-660', 4600),
  ('CERVEZA-DESC-CORONA-710', 5450)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
