-- Carga real de catálogo — categoría GIN (primera tanda).
-- Fuente: lista de precios de Moe (WhatsApp, 28/8/2026), sección "GIN".
-- Precio = precio_base de OLAVARRÍA (Laprida se arma sola con el recargo
-- por categoría ya configurado en /precios — no se carga acá).
--
-- Supuestos que tuve que hacer porque la lista no los deja explícitos —
-- REVISAR en /productos y /precios antes de seguir con la próxima
-- categoría:
--
--   1. Volumen no aclarado => se asumió 750 ml (tamaño estándar de botella
--      de gin), salvo que la lista diga "litro", "375cc", "500cc", etc.
--   2. "Estuche X con [vasos/copa]" se cargó como un SKU más del MISMO
--      producto base (tipo_presentacion='estuche'), no como producto
--      aparte -- es el mismo líquido, solo cambia el empaque.
--   3. "Aconcagua 500cc de aluminio" se cargó como producto propio
--      ("Aconcagua Lata"), separado de las variedades con sabor (azul,
--      blanco, verde, rosa, naranja) porque no se aclara a cuál
--      corresponde.
--   4. "Estuche 9 Botánicos $39.700" se asumió que es la presentación
--      estuche de "Blue" (aparece inmediatamente después en la lista) --
--      si en realidad es de otra marca, avisame.
--   5. Las promos "Merle clásico + tónica", "Cordillera + tónica" y
--      "Burnett's + tónica" NO se cargaron todavía: son combos con un
--      mixer (tónica) que todavía no existe en el catálogo (va en la
--      tanda de Gaseosas). Solo se cargaron los 2x que son 100% Gin:
--      Heraclito 2x$20.000 y Blue 2x$25.000.
--   6. Stock mínimo/objetivo quedan en 0 para todo -- se ajustan después
--      desde /productos una vez que se sepa el consumo real.

begin;

-- Cargar precios (trigger registrar_autor_precio, bloque 5) y promociones
-- (guardar_promocion(), que exige ve_costos()) dependen de auth.uid() --
-- pero corriendo esto por SQL Editor no hay sesion de la app, asi que
-- auth.uid() da null y ambas cosas fallarian (actualizado_por es not
-- null; ve_costos() da false para null). Se simula la sesion del dueño
-- para esta transaccion nada mas -- no persiste, no toca nada de auth de
-- verdad.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Gin');

insert into marcas (nombre) values
  ('Aconcagua'), ('Argentina Wild'), ('Burnett''s'), ('Joplin'), ('Beefeater'),
  ('Bombay'), ('Bulldog'), ('Gordon''s'), ('Hendrick''s'), ('Heraclito'),
  ('Heredero'), ('Le Tribute'), ('Malaria'), ('Merle'), ('MG'), ('Monkey'),
  ('Pasaron Cosas'), ('Pastizal'), ('Restinga'), ('Sur'), ('Tanqueray'),
  ('Terrier'), ('Cordillera'), ('Blue'), ('Runa');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Gin')
from (values
  ('Aconcagua Lata', 'Aconcagua'),
  ('Aconcagua Azul', 'Aconcagua'),
  ('Aconcagua Blanco (Cardamomo)', 'Aconcagua'),
  ('Aconcagua Verde (Lima)', 'Aconcagua'),
  ('Aconcagua Rosa (Frutos Rojos)', 'Aconcagua'),
  ('Aconcagua Naranja (Pomelo Rosado)', 'Aconcagua'),
  ('Argentina Wild', 'Argentina Wild'),
  ('Argentina Wild Flores Salvajes', 'Argentina Wild'),
  ('Burnett''s', 'Burnett''s'),
  ('Joplin', 'Joplin'),
  ('Beefeater', 'Beefeater'),
  ('Beefeater Orange', 'Beefeater'),
  ('Beefeater Pink', 'Beefeater'),
  ('Bombay Bramble', 'Bombay'),
  ('Bombay Sapphire', 'Bombay'),
  ('Bulldog', 'Bulldog'),
  ('Gordon''s Pink', 'Gordon''s'),
  ('Hendrick''s', 'Hendrick''s'),
  ('Heraclito', 'Heraclito'),
  ('Heraclito 40 Botánicos', 'Heraclito'),
  ('Heredero London Dry', 'Heredero'),
  ('Heredero Pomelo Rosa', 'Heredero'),
  ('Heredero Boysenberry', 'Heredero'),
  ('Heredero Lemon & Ginger', 'Heredero'),
  ('Le Tribute', 'Le Tribute'),
  ('Malaria Original', 'Malaria'),
  ('Malaria London Dry', 'Malaria'),
  ('Merle', 'Merle'),
  ('Merle Orange', 'Merle'),
  ('MG', 'MG'),
  ('Monkey', 'Monkey'),
  ('Pasaron Cosas Double Color', 'Pasaron Cosas'),
  ('Pasaron Cosas London Dry', 'Pasaron Cosas'),
  ('Pastizal London Dry', 'Pastizal'),
  ('Pastizal Contemporáneo', 'Pastizal'),
  ('Restinga Cerámica', 'Restinga'),
  ('Sur Clásico', 'Sur'),
  ('Sur Naranja', 'Sur'),
  ('Tanqueray', 'Tanqueray'),
  ('Tanqueray Royale', 'Tanqueray'),
  ('Tanqueray Sevilla', 'Tanqueray'),
  ('Terrier', 'Terrier'),
  ('Cordillera London Dry', 'Cordillera'),
  ('Cordillera Pink', 'Cordillera'),
  ('Blue', 'Blue'),
  ('Runa Tirado Arándanos', 'Runa')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

-- SKUs: (producto, marca, nombre_sku, codigo_interno, tipo_presentacion, volumen, unidad_volumen, precio_base)
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, v.tipo::text, v.volumen, v.unidad, 1
from (values
  ('Aconcagua Lata', 'Aconcagua', 'Aconcagua Lata 500cc', 'GIN-ACONCAGUA-LATA-500', 'unidad', 500, 'ml'),
  ('Aconcagua Azul', 'Aconcagua', 'Aconcagua Azul 750cc', 'GIN-ACONCAGUA-AZUL-750', 'unidad', 750, 'ml'),
  ('Aconcagua Blanco (Cardamomo)', 'Aconcagua', 'Aconcagua Blanco (Cardamomo) 750cc', 'GIN-ACONCAGUA-BLANCO-750', 'unidad', 750, 'ml'),
  ('Aconcagua Verde (Lima)', 'Aconcagua', 'Aconcagua Verde (Lima) 750cc', 'GIN-ACONCAGUA-VERDE-750', 'unidad', 750, 'ml'),
  ('Aconcagua Rosa (Frutos Rojos)', 'Aconcagua', 'Aconcagua Rosa (Frutos Rojos) 750cc', 'GIN-ACONCAGUA-ROSA-750', 'unidad', 750, 'ml'),
  ('Aconcagua Naranja (Pomelo Rosado)', 'Aconcagua', 'Aconcagua Naranja (Pomelo Rosado) 750cc', 'GIN-ACONCAGUA-NARANJA-750', 'unidad', 750, 'ml'),
  ('Argentina Wild', 'Argentina Wild', 'Argentina Wild 750cc', 'GIN-ARGWILD-750', 'unidad', 750, 'ml'),
  ('Argentina Wild Flores Salvajes', 'Argentina Wild', 'Argentina Wild Flores Salvajes 750cc', 'GIN-ARGWILD-FLORES-750', 'unidad', 750, 'ml'),
  ('Burnett''s', 'Burnett''s', 'Burnett''s 750cc', 'GIN-BURNETTS-750', 'unidad', 750, 'ml'),
  ('Joplin', 'Joplin', 'Joplin 750cc', 'GIN-JOPLIN-750', 'unidad', 750, 'ml'),
  ('Beefeater', 'Beefeater', 'Beefeater 750cc', 'GIN-BEEFEATER-750', 'unidad', 750, 'ml'),
  ('Beefeater', 'Beefeater', 'Beefeater Litro', 'GIN-BEEFEATER-1000', 'unidad', 1000, 'ml'),
  ('Beefeater Orange', 'Beefeater', 'Beefeater Orange 750cc', 'GIN-BEEFEATER-ORANGE-750', 'unidad', 750, 'ml'),
  ('Beefeater Pink', 'Beefeater', 'Beefeater Pink 750cc', 'GIN-BEEFEATER-PINK-750', 'unidad', 750, 'ml'),
  ('Bombay Bramble', 'Bombay', 'Bombay Bramble 750cc', 'GIN-BOMBAY-BRAMBLE-750', 'unidad', 750, 'ml'),
  ('Bombay Sapphire', 'Bombay', 'Bombay Sapphire 750cc', 'GIN-BOMBAY-SAPPHIRE-750', 'unidad', 750, 'ml'),
  ('Bulldog', 'Bulldog', 'Bulldog 750cc', 'GIN-BULLDOG-750', 'unidad', 750, 'ml'),
  ('Bulldog', 'Bulldog', 'Bulldog Estuche con copa negra', 'GIN-BULLDOG-ESTUCHE', 'estuche', 750, 'ml'),
  ('Gordon''s Pink', 'Gordon''s', 'Gordon''s Pink 750cc', 'GIN-GORDONS-PINK-750', 'unidad', 750, 'ml'),
  ('Hendrick''s', 'Hendrick''s', 'Hendrick''s 750cc', 'GIN-HENDRICKS-750', 'unidad', 750, 'ml'),
  ('Heraclito', 'Heraclito', 'Heraclito 750cc', 'GIN-HERACLITO-750', 'unidad', 750, 'ml'),
  ('Heraclito 40 Botánicos', 'Heraclito', 'Heraclito 40 Botánicos 750cc', 'GIN-HERACLITO-40BOT-750', 'unidad', 750, 'ml'),
  ('Heredero London Dry', 'Heredero', 'Heredero London Dry 750cc', 'GIN-HEREDERO-LD-750', 'unidad', 750, 'ml'),
  ('Heredero Pomelo Rosa', 'Heredero', 'Heredero Pomelo Rosa 750cc', 'GIN-HEREDERO-POMELO-750', 'unidad', 750, 'ml'),
  ('Heredero Boysenberry', 'Heredero', 'Heredero Boysenberry 750cc', 'GIN-HEREDERO-BOYSEN-750', 'unidad', 750, 'ml'),
  ('Heredero Lemon & Ginger', 'Heredero', 'Heredero Lemon & Ginger 750cc', 'GIN-HEREDERO-LEMONGIN-750', 'unidad', 750, 'ml'),
  ('Heredero London Dry', 'Heredero', 'Heredero Estuche con 2 vasos', 'GIN-HEREDERO-EST2VASOS', 'estuche', 750, 'ml'),
  ('Heredero London Dry', 'Heredero', 'Heredero Estuche con 1 copa', 'GIN-HEREDERO-EST1COPA', 'estuche', 750, 'ml'),
  ('Le Tribute', 'Le Tribute', 'Le Tribute 750cc', 'GIN-LETRIBUTE-750', 'unidad', 750, 'ml'),
  ('Malaria Original', 'Malaria', 'Malaria Original 750cc', 'GIN-MALARIA-ORIG-750', 'unidad', 750, 'ml'),
  ('Malaria London Dry', 'Malaria', 'Malaria London Dry 750cc', 'GIN-MALARIA-LD-750', 'unidad', 750, 'ml'),
  ('Malaria Original', 'Malaria', 'Malaria Original Estuche', 'GIN-MALARIA-ORIG-EST', 'estuche', 750, 'ml'),
  ('Merle', 'Merle', 'Merle 750cc', 'GIN-MERLE-750', 'unidad', 750, 'ml'),
  ('Merle Orange', 'Merle', 'Merle Orange 750cc', 'GIN-MERLE-ORANGE-750', 'unidad', 750, 'ml'),
  ('MG', 'MG', 'MG 750cc', 'GIN-MG-750', 'unidad', 750, 'ml'),
  ('Monkey', 'Monkey', 'Monkey 750cc', 'GIN-MONKEY-750', 'unidad', 750, 'ml'),
  ('Pasaron Cosas Double Color', 'Pasaron Cosas', 'Pasaron Cosas Double Color 750cc', 'GIN-PASARON-DC-750', 'unidad', 750, 'ml'),
  ('Pasaron Cosas London Dry', 'Pasaron Cosas', 'Pasaron Cosas London Dry 750cc', 'GIN-PASARON-LD-750', 'unidad', 750, 'ml'),
  ('Pastizal London Dry', 'Pastizal', 'Pastizal London Dry 750cc', 'GIN-PASTIZAL-LD-750', 'unidad', 750, 'ml'),
  ('Pastizal London Dry', 'Pastizal', 'Pastizal London Dry 375cc', 'GIN-PASTIZAL-LD-375', 'unidad', 375, 'ml'),
  ('Pastizal Contemporáneo', 'Pastizal', 'Pastizal Contemporáneo 750cc', 'GIN-PASTIZAL-CONT-750', 'unidad', 750, 'ml'),
  ('Pastizal Contemporáneo', 'Pastizal', 'Pastizal Contemporáneo 375cc', 'GIN-PASTIZAL-CONT-375', 'unidad', 375, 'ml'),
  ('Restinga Cerámica', 'Restinga', 'Restinga Cerámica 750cc', 'GIN-RESTINGA-750', 'unidad', 750, 'ml'),
  ('Sur Clásico', 'Sur', 'Sur Clásico 750cc', 'GIN-SUR-CLASICO-750', 'unidad', 750, 'ml'),
  ('Sur Naranja', 'Sur', 'Sur Naranja 750cc', 'GIN-SUR-NARANJA-750', 'unidad', 750, 'ml'),
  ('Tanqueray', 'Tanqueray', 'Tanqueray 750cc', 'GIN-TANQUERAY-750', 'unidad', 750, 'ml'),
  ('Tanqueray Royale', 'Tanqueray', 'Tanqueray Royale 750cc', 'GIN-TANQUERAY-ROYALE-750', 'unidad', 750, 'ml'),
  ('Tanqueray Sevilla', 'Tanqueray', 'Tanqueray Sevilla 750cc', 'GIN-TANQUERAY-SEVILLA-750', 'unidad', 750, 'ml'),
  ('Terrier', 'Terrier', 'Terrier Bag in Box 2L', 'GIN-TERRIER-2000', 'unidad', 2000, 'ml'),
  ('Cordillera London Dry', 'Cordillera', 'Cordillera London Dry 750cc', 'GIN-CORDILLERA-LD-750', 'unidad', 750, 'ml'),
  ('Cordillera Pink', 'Cordillera', 'Cordillera Pink 750cc', 'GIN-CORDILLERA-PINK-750', 'unidad', 750, 'ml'),
  ('Blue', 'Blue', 'Blue 750cc', 'GIN-BLUE-750', 'unidad', 750, 'ml'),
  ('Blue', 'Blue', 'Blue Estuche 9 Botánicos', 'GIN-BLUE-EST9BOT', 'estuche', 750, 'ml'),
  ('Runa Tirado Arándanos', 'Runa', 'Runa Tirado Arándanos 1L (sin botella)', 'GIN-RUNA-ARANDANOS-1000-SB', 'unidad', 1000, 'ml'),
  ('Runa Tirado Arándanos', 'Runa', 'Runa Tirado Arándanos 1L + botella descartable', 'GIN-RUNA-ARANDANOS-1000-CB', 'unidad', 1000, 'ml')
) as v(producto, marca, nombre_sku, codigo, tipo, volumen, unidad)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- Precios (precio_base = Olavarría)
insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('GIN-ACONCAGUA-LATA-500', 7850),
  ('GIN-ACONCAGUA-AZUL-750', 14350),
  ('GIN-ACONCAGUA-BLANCO-750', 21850),
  ('GIN-ACONCAGUA-VERDE-750', 21850),
  ('GIN-ACONCAGUA-ROSA-750', 21850),
  ('GIN-ACONCAGUA-NARANJA-750', 21850),
  ('GIN-ARGWILD-750', 19100),
  ('GIN-ARGWILD-FLORES-750', 19100),
  ('GIN-BURNETTS-750', 8000),
  ('GIN-JOPLIN-750', 9850),
  ('GIN-BEEFEATER-750', 24000),
  ('GIN-BEEFEATER-1000', 32000),
  ('GIN-BEEFEATER-ORANGE-750', 29000),
  ('GIN-BEEFEATER-PINK-750', 29000),
  ('GIN-BOMBAY-BRAMBLE-750', 39500),
  ('GIN-BOMBAY-SAPPHIRE-750', 39500),
  ('GIN-BULLDOG-750', 37600),
  ('GIN-BULLDOG-ESTUCHE', 59500),
  ('GIN-GORDONS-PINK-750', 13200),
  ('GIN-HENDRICKS-750', 61250),
  ('GIN-HERACLITO-750', 15000),
  ('GIN-HERACLITO-40BOT-750', 23500),
  ('GIN-HEREDERO-LD-750', 15350),
  ('GIN-HEREDERO-POMELO-750', 15350),
  ('GIN-HEREDERO-BOYSEN-750', 15350),
  ('GIN-HEREDERO-LEMONGIN-750', 15350),
  ('GIN-HEREDERO-EST2VASOS', 35500),
  ('GIN-HEREDERO-EST1COPA', 35500),
  ('GIN-LETRIBUTE-750', 100500),
  ('GIN-MALARIA-ORIG-750', 31200),
  ('GIN-MALARIA-LD-750', 25200),
  ('GIN-MALARIA-ORIG-EST', 34850),
  ('GIN-MERLE-750', 8450),
  ('GIN-MERLE-ORANGE-750', 9600),
  ('GIN-MG-750', 22650),
  ('GIN-MONKEY-750', 72100),
  ('GIN-PASARON-DC-750', 10300),
  ('GIN-PASARON-LD-750', 10300),
  ('GIN-PASTIZAL-LD-750', 20450),
  ('GIN-PASTIZAL-LD-375', 11100),
  ('GIN-PASTIZAL-CONT-750', 20450),
  ('GIN-PASTIZAL-CONT-375', 11100),
  ('GIN-RESTINGA-750', 51700),
  ('GIN-SUR-CLASICO-750', 20200),
  ('GIN-SUR-NARANJA-750', 20200),
  ('GIN-TANQUERAY-750', 27850),
  ('GIN-TANQUERAY-ROYALE-750', 33400),
  ('GIN-TANQUERAY-SEVILLA-750', 33400),
  ('GIN-TERRIER-2000', 35000),
  ('GIN-CORDILLERA-LD-750', 16700),
  ('GIN-CORDILLERA-PINK-750', 16700),
  ('GIN-BLUE-750', 13550),
  ('GIN-BLUE-EST9BOT', 39700),
  ('GIN-RUNA-ARANDANOS-1000-SB', 7600),
  ('GIN-RUNA-ARANDANOS-1000-CB', 8100)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

-- Promociones 2x (solo las que no dependen de un mixer todavia no cargado)
select guardar_promocion(
  null, 'Gin Heraclito 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object(
    'sku_id', (select id from skus where codigo_interno = 'GIN-HERACLITO-750'),
    'cantidad_requerida', 2,
    'precio_promocional', 20000
  ))
);

select guardar_promocion(
  null, 'Gin Blue 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object(
    'sku_id', (select id from skus where codigo_interno = 'GIN-BLUE-750'),
    'cantidad_requerida', 2,
    'precio_promocional', 25000
  ))
);

commit;
