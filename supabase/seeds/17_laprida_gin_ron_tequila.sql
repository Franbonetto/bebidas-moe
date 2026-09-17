-- Carga real de catálogo + precios de Laprida — sección "GIN Y BLANCAS"
-- (lista de precios de Laprida, 12/09/26). El título de la sección mezcla
-- varias categorías reales: Gin, Vodka, Ron y Tequila, más dos licores
-- (Jägermeister, Holdmoser) que van a la categoría "Licores" ya creada en
-- 16_laprida_licores.sql.
--
-- MISMO CASO QUE "Burnett's" EN LA TANDA ANTERIOR: varios nombres de esta
-- lista ya existen como SKU (categorías Gin de 01_gin.sql y Vodka de
-- 03_vodka.sql). Para esos se agrega el override de precio de Laprida
-- sobre el SKU existente, NO se duplica el producto.
--
-- Además, esto resuelve un pendiente de 03_vodka.sql: "CocoBongo (ron de
-- coco)" aparecía en un combo sin precio propio y no se había cargado --
-- acá sí tiene precio solo ($7.550), se da de alta en la categoría Ron.
--
-- Supuestos de MATCHING (nombre ambiguo -> qué SKU existente se asumió;
-- si está mal, se corrige el codigo_interno correspondiente):
--   - "Pastizal Gin" -> Pastizal London Dry 750cc (no aclara variante).
--   - "Heredero Gin" -> Heredero London Dry 750cc (no aclara sabor).
--   - "Gordon" -> Gordon's Pink 750cc (es la única SKU de Gordon's que
--     existe en el catálogo).
--   - "Cordillera" -> Cordillera London Dry 750cc (no aclara variante).
--   - "Bombay" -> Bombay Sapphire 750cc (no aclara Bramble/Sapphire).
--   - "Aconcagua" -> Aconcagua Blanco (Cardamomo) 750cc (no aclara sabor;
--     de los 4 sabores a $21.850 de Olavarría, se tomó el primero de la
--     lista como default).
--   - "Tanqueray Export" -> el Tanqueray base ya cargado (sin variante).
--   - "Beefeater 750 ml" -> el Beefeater base (no Orange/Pink).
--   - "Terrier" $13.150 NO se cargó como override del Bag in Box 2L
--     existente (base $35.000: implicaría vender muy por debajo de costo).
--     Se asumió que es una presentación más chica (750cc) que todavía no
--     estaba en el catálogo y se dio de alta como SKU nuevo del mismo
--     producto Terrier.
--
-- Nuevos productos (no existían en ninguna categoría):
--   - Gin: "London Dry Gin" genérico (sin marca reconocible en la lista),
--     Malaria Black, Tanqueray Dark Berry, Restinga Edición Limitada,
--     Bosque, Blu Spirito, Covent, Merle Pink, Merle Contemporary.
--   - Vodka: Smirnoff Citric (la lista distingue "Citric" de "saborizado"
--     genérico, así que se cargan como productos separados).
--   - Ron (categoría nueva): Malibú, Coco Bongo, Barceló, Havana Club,
--     Chilangos, Ron Rico, Bacardí.
--   - Tequila (categoría nueva): José Cuervo.
--   - Licores: Jäger Cold Brew, Jäger Clásico (marca Jägermeister),
--     Holdmoser.
--
-- Volúmenes: la lista no aclara volumen salvo donde dice "1 L" / "750 ml".
-- Se asumió 750cc como default, salvo:
--   - Bacardí "litro" -> 1000cc explícito.
--   - Jägermeister (Cold Brew y Clásico): 700cc, presentación real de la
--     marca en Argentina.
--   - Terrier (nuevo SKU chico): 750cc, tamaño estándar de la categoría.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Ron'), ('Tequila');

-- "Licores" ya se crea en 16_laprida_licores.sql -- este insert es solo
-- una red de seguridad por si este archivo se corre antes que ese (o
-- contra una base donde esa tanda todavía no se aplicó). Sin esto, los
-- productos de Jägermeister/Holdmoser de más abajo quedarían con
-- categoria_id null y el insert de productos falla.
insert into categorias (nombre) values ('Licores') on conflict (nombre) do nothing;

insert into marcas (nombre) values
  ('London Dry Gin'), ('Bosque'), ('Blu Spirito'), ('Covent'),
  ('Malibú'), ('Coco Bongo'), ('Barceló'), ('Havana Club'), ('Chilangos'),
  ('Ron Rico'), ('Bacardí'), ('José Cuervo'), ('Jägermeister'), ('Holdmoser');

-- Productos nuevos
insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = v.categoria)
from (values
  ('London Dry Gin', 'London Dry Gin', 'Gin'),
  ('Malaria Black', 'Malaria', 'Gin'),
  ('Tanqueray Dark Berry', 'Tanqueray', 'Gin'),
  ('Restinga Edición Limitada', 'Restinga', 'Gin'),
  ('Bosque', 'Bosque', 'Gin'),
  ('Blu Spirito', 'Blu Spirito', 'Gin'),
  ('Covent', 'Covent', 'Gin'),
  ('Merle Pink', 'Merle', 'Gin'),
  ('Merle Contemporary', 'Merle', 'Gin'),
  ('Smirnoff Citric', 'Smirnoff', 'Vodka'),
  ('Malibú', 'Malibú', 'Ron'),
  ('Coco Bongo', 'Coco Bongo', 'Ron'),
  ('Barceló', 'Barceló', 'Ron'),
  ('Havana Club', 'Havana Club', 'Ron'),
  ('Chilangos', 'Chilangos', 'Ron'),
  ('Ron Rico', 'Ron Rico', 'Ron'),
  ('Bacardí', 'Bacardí', 'Ron'),
  ('José Cuervo', 'José Cuervo', 'Tequila'),
  ('Jäger Cold Brew', 'Jägermeister', 'Licores'),
  ('Jäger Clásico', 'Jägermeister', 'Licores'),
  ('Holdmoser', 'Holdmoser', 'Licores')
) as v(nombre, marca, categoria)
join marcas m on m.nombre = v.marca;

-- SKUs de los productos nuevos
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('London Dry Gin', 'London Dry Gin 750cc', 'GIN-LONDONDRY-750', 750),
  ('Malaria Black', 'Malaria Black 750cc', 'GIN-MALARIA-BLACK-750', 750),
  ('Tanqueray Dark Berry', 'Tanqueray Dark Berry 750cc', 'GIN-TANQUERAY-DARKBERRY-750', 750),
  ('Restinga Edición Limitada', 'Restinga Edición Limitada 750cc', 'GIN-RESTINGA-EDLIMITADA-750', 750),
  ('Bosque', 'Bosque 750cc', 'GIN-BOSQUE-750', 750),
  ('Blu Spirito', 'Blu Spirito 750cc', 'GIN-BLUSPIRITO-750', 750),
  ('Covent', 'Covent 750cc', 'GIN-COVENT-750', 750),
  ('Merle Pink', 'Merle Pink 750cc', 'GIN-MERLE-PINK-750', 750),
  ('Merle Contemporary', 'Merle Contemporary 750cc', 'GIN-MERLE-CONTEMPORARY-750', 750),
  ('Terrier', 'Terrier 750cc', 'GIN-TERRIER-750', 750),
  ('Smirnoff Citric', 'Smirnoff Citric 750cc', 'VODKA-SMIRNOFF-CITRIC-750', 750),
  ('Malibú', 'Malibú 750cc', 'RON-MALIBU-750', 750),
  ('Coco Bongo', 'Coco Bongo 750cc', 'RON-COCOBONGO-750', 750),
  ('Barceló', 'Barceló 750cc', 'RON-BARCELO-750', 750),
  ('Havana Club', 'Havana Club 750cc', 'RON-HAVANACLUB-750', 750),
  ('Chilangos', 'Chilangos 750cc', 'RON-CHILANGOS-750', 750),
  ('Ron Rico', 'Ron Rico 750cc', 'RON-RONRICO-750', 750),
  ('Bacardí', 'Bacardí 1 L', 'RON-BACARDI-1000', 1000),
  ('José Cuervo', 'José Cuervo 750cc', 'TEQUILA-JOSECUERVO-750', 750),
  ('Jäger Cold Brew', 'Jäger Cold Brew 700cc', 'LICOR-JAGERCOLDBREW-700', 700),
  ('Jäger Clásico', 'Jäger Clásico 700cc', 'LICOR-JAGERCLASICO-700', 700),
  ('Holdmoser', 'Holdmoser 750cc', 'LICOR-HOLDMOSER-750', 750)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto
  and p.marca_id in (select id from marcas where nombre in (
    'London Dry Gin', 'Malaria', 'Tanqueray', 'Restinga', 'Bosque', 'Blu Spirito',
    'Covent', 'Merle', 'Terrier', 'Smirnoff', 'Malibú', 'Coco Bongo', 'Barceló',
    'Havana Club', 'Chilangos', 'Ron Rico', 'Bacardí', 'José Cuervo', 'Jägermeister',
    'Holdmoser'
  ));

-- Precios de Laprida: overrides sobre SKUs ya existentes (Gin/Vodka) +
-- precios de los SKUs nuevos (altas en Olavarría sin precio propio).
insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  -- Overrides sobre Gin (01_gin.sql)
  ('GIN-MG-750', 22750),
  ('GIN-PASARON-DC-750', 7100),
  ('GIN-HEREDERO-LD-750', 13650),
  ('GIN-MALARIA-ORIG-750', 32200),
  ('GIN-MALARIA-LD-750', 26500),
  ('GIN-SUR-CLASICO-750', 11550),
  ('GIN-GORDONS-PINK-750', 13300),
  ('GIN-HERACLITO-750', 16000),
  ('GIN-SUR-NARANJA-750', 20300),
  ('GIN-ARGWILD-750', 19200),
  ('GIN-TANQUERAY-750', 28000),
  ('GIN-RESTINGA-750', 18100),
  ('GIN-CORDILLERA-LD-750', 16800),
  ('GIN-BULLDOG-750', 37700),
  ('GIN-BEEFEATER-1000', 32100),
  ('GIN-BEEFEATER-750', 29100),
  ('GIN-MERLE-ORANGE-750', 9700),
  ('GIN-BOMBAY-SAPPHIRE-750', 39600),
  ('GIN-PASTIZAL-LD-750', 17700),
  ('GIN-ACONCAGUA-BLANCO-750', 21950),
  -- Overrides sobre Vodka (03_vodka.sql)
  ('VODKA-SERNOVA-750', 8300),
  ('VODKA-SKYY-CLASICO-750', 9000),
  ('VODKA-SKYY-SABOR-750', 9450),
  ('VODKA-SMIRNOFF-CLASICO-750', 8200),
  ('VODKA-SMIRNOFF-SABOR-750', 9450),
  ('VODKA-ABSOLUT-700', 31800),
  ('VODKA-CIROC-750', 71000),
  -- SKUs nuevos
  ('GIN-LONDONDRY-750', 11300),
  ('GIN-MALARIA-BLACK-750', 35000),
  ('GIN-TANQUERAY-DARKBERRY-750', 33500),
  ('GIN-RESTINGA-EDLIMITADA-750', 54800),
  ('GIN-BOSQUE-750', 8000),
  ('GIN-BLUSPIRITO-750', 13600),
  ('GIN-COVENT-750', 10000),
  ('GIN-MERLE-PINK-750', 9700),
  ('GIN-MERLE-CONTEMPORARY-750', 9450),
  ('GIN-TERRIER-750', 13150),
  ('VODKA-SMIRNOFF-CITRIC-750', 8350),
  ('RON-MALIBU-750', 16050),
  ('RON-COCOBONGO-750', 7550),
  ('RON-BARCELO-750', 23800),
  ('RON-HAVANACLUB-750', 16400),
  ('RON-CHILANGOS-750', 7000),
  ('RON-RONRICO-750', 7000),
  ('RON-BACARDI-1000', 27800),
  ('TEQUILA-JOSECUERVO-750', 36300),
  ('LICOR-JAGERCOLDBREW-700', 46300),
  ('LICOR-JAGERCLASICO-700', 32300),
  ('LICOR-HOLDMOSER-750', 24900)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
