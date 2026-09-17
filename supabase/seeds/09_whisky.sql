-- Carga real de catálogo — WHISKY (novena tanda).
-- Fuente: lista de precios de Moe, sección "whiskey".
--
-- Dos promociones de esta sección NO se cargaron -- son, textualmente,
-- los casos 2 y 3 que docs/arquitectura.md 3.4 ya marca como postergados
-- a propósito:
--   - "2 Jack Daniel's litro $93.000 ... tienen que ser dos botellas
--     diferentes" -- 2x que exige SKU distintos, el motor no lo soporta
--     (caso 2).
--   - "Botellas 3 Litros ... Abonando en efectivo 10% de descuento" -- el
--     descuento por efectivo hoy es por categoría, no por SKU puntual
--     (caso 3). Igual se cargaron las botellas de 3L como SKU con su
--     precio de lista (Jack Daniel's clásico y Johnnie Walker Black
--     Label), solo que sin ese descuento especial armado.
--
-- Supuestos:
--   1. Volumen no aclarado => 750cc, salvo "litro" (1000ml) o "3 litros"
--      (3000ml) explícitos.
--   2. Johnnie Walker Red Label 1 litro y Balletines litro figuran como
--      "$----"/"$---" -- se crean sin precio, igual que Fernet Branca
--      450cc.
--   3. "Blender's $8.800" y "Blenders Pride $10.600" se cargaron como dos
--      marcas/productos DISTINTOS -- así están nombrados por separado en
--      la lista, con precios distintos.
--   4. "Grant's litro $30.500" sale MÁS BARATO que "Grant's 750cc
--      $30.600" en tu lista -- lo cargué tal cual está (no lo "corregí"
--      invirtiendo los precios). Avisame si en realidad estaban al revés.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Whisky');

insert into marcas (nombre) values
  ('Macallan'), ('Johnnie Walker'), ('Chivas Regal'), ('Singleton'), ('Jameson'),
  ('Jack Daniel''s'), ('Jim Beam'), ('J&B'), ('Dalmore'), ('Jura'), ('Label 5'),
  ('Balletines'), ('Evan William'), ('Cardu'), ('Fireball'), ('Blenders Pride'),
  ('Bulleit'), ('Whyte y Mackay'), ('Buchanan''s'), ('El Buscador Obstinado'),
  ('White Horse'), ('Grant''s'), ('Old Parr'), ('Blender''s');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Whisky')
from (values
  ('Macallan', 'Macallan'),
  ('Johnnie Walker Red Label', 'Johnnie Walker'),
  ('Johnnie Walker Black Label', 'Johnnie Walker'),
  ('Johnnie Walker Black 200 Años', 'Johnnie Walker'),
  ('Johnnie Walker Gold Label', 'Johnnie Walker'),
  ('Johnnie Walker Gold Label 200 Años', 'Johnnie Walker'),
  ('Johnnie Walker Blonde', 'Johnnie Walker'),
  ('Johnnie Walker Green Label', 'Johnnie Walker'),
  ('Johnnie Walker 18 Años', 'Johnnie Walker'),
  ('Johnnie Walker Blue Label', 'Johnnie Walker'),
  ('Johnnie Walker Swing', 'Johnnie Walker'),
  ('Chivas Regal 12 Años', 'Chivas Regal'),
  ('Chivas Regal Extra', 'Chivas Regal'),
  ('Singleton 15 Años', 'Singleton'),
  ('Singleton 18 Años', 'Singleton'),
  ('Jameson Ipa', 'Jameson'),
  ('Jack Daniel''s', 'Jack Daniel''s'),
  ('Jack Daniel''s Honey', 'Jack Daniel''s'),
  ('Jack Daniel''s Apple', 'Jack Daniel''s'),
  ('Jack Daniel''s Fire', 'Jack Daniel''s'),
  ('Jim Beam Honey', 'Jim Beam'),
  ('Jim Beam Vainilla', 'Jim Beam'),
  ('J&B', 'J&B'),
  ('Dalmore', 'Dalmore'),
  ('Jura', 'Jura'),
  ('Label 5', 'Label 5'),
  ('Balletines', 'Balletines'),
  ('Evan William', 'Evan William'),
  ('Cardu', 'Cardu'),
  ('Fireball', 'Fireball'),
  ('Blenders Pride', 'Blenders Pride'),
  ('Bulleit Bourbon', 'Bulleit'),
  ('Whyte y Mackay', 'Whyte y Mackay'),
  ('Buchanan''s', 'Buchanan''s'),
  ('El Buscador Obstinado', 'El Buscador Obstinado'),
  ('White Horse', 'White Horse'),
  ('Grant''s', 'Grant''s'),
  ('Old Parr', 'Old Parr'),
  ('Blender''s', 'Blender''s')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, v.tipo, v.volumen, 'ml', 1
from (values
  ('Macallan', 'Macallan', 'Macallan 750cc', 'WHISKY-MACALLAN-750', 'unidad', 750),
  ('Johnnie Walker Red Label', 'Johnnie Walker', 'Johnnie Walker Red Label 750cc', 'WHISKY-JWRED-750', 'unidad', 750),
  ('Johnnie Walker Red Label', 'Johnnie Walker', 'Johnnie Walker Red Label Litro', 'WHISKY-JWRED-1000', 'unidad', 1000),
  ('Johnnie Walker Black Label', 'Johnnie Walker', 'Johnnie Walker Black Label Litro', 'WHISKY-JWBLACK-1000', 'unidad', 1000),
  ('Johnnie Walker Black Label', 'Johnnie Walker', 'Johnnie Walker Black Label 750cc', 'WHISKY-JWBLACK-750', 'unidad', 750),
  ('Johnnie Walker Black Label', 'Johnnie Walker', 'Johnnie Walker Black Label 3L', 'WHISKY-JWBLACK-3000', 'unidad', 3000),
  ('Johnnie Walker Black Label', 'Johnnie Walker', 'Johnnie Walker Black Label Estuche 750cc Lata', 'WHISKY-JWBLACK-ESTUCHE', 'estuche', 750),
  ('Johnnie Walker Black 200 Años', 'Johnnie Walker', 'Johnnie Walker Black 200 Años 750cc', 'WHISKY-JWBLACK200-750', 'unidad', 750),
  ('Johnnie Walker Gold Label', 'Johnnie Walker', 'Johnnie Walker Gold Label 750cc', 'WHISKY-JWGOLD-750', 'unidad', 750),
  ('Johnnie Walker Gold Label 200 Años', 'Johnnie Walker', 'Johnnie Walker Gold Label 200 Años 750cc', 'WHISKY-JWGOLD200-750', 'unidad', 750),
  ('Johnnie Walker Blonde', 'Johnnie Walker', 'Johnnie Walker Blonde 750cc', 'WHISKY-JWBLONDE-750', 'unidad', 750),
  ('Johnnie Walker Green Label', 'Johnnie Walker', 'Johnnie Walker Green Label 750cc', 'WHISKY-JWGREEN-750', 'unidad', 750),
  ('Johnnie Walker 18 Años', 'Johnnie Walker', 'Johnnie Walker 18 Años 750cc', 'WHISKY-JW18-750', 'unidad', 750),
  ('Johnnie Walker 18 Años', 'Johnnie Walker', 'Johnnie Walker 18 Años Estuche con 2 vasos', 'WHISKY-JW18-ESTUCHE', 'estuche', 750),
  ('Johnnie Walker Blue Label', 'Johnnie Walker', 'Johnnie Walker Blue Label 750cc', 'WHISKY-JWBLUE-750', 'unidad', 750),
  ('Johnnie Walker Swing', 'Johnnie Walker', 'Johnnie Walker Swing 750cc', 'WHISKY-JWSWING-750', 'unidad', 750),
  ('Chivas Regal 12 Años', 'Chivas Regal', 'Chivas Regal 12 Años 750cc', 'WHISKY-CHIVAS12-750', 'unidad', 750),
  ('Chivas Regal 12 Años', 'Chivas Regal', 'Chivas Regal 12 Años Litro', 'WHISKY-CHIVAS12-1000', 'unidad', 1000),
  ('Chivas Regal Extra', 'Chivas Regal', 'Chivas Regal Extra 750cc', 'WHISKY-CHIVASEXTRA-750', 'unidad', 750),
  ('Singleton 15 Años', 'Singleton', 'Singleton 15 Años 750cc', 'WHISKY-SINGLETON15-750', 'unidad', 750),
  ('Singleton 18 Años', 'Singleton', 'Singleton 18 Años 750cc', 'WHISKY-SINGLETON18-750', 'unidad', 750),
  ('Jameson Ipa', 'Jameson', 'Jameson Ipa 750cc', 'WHISKY-JAMESON-IPA-750', 'unidad', 750),
  ('Jack Daniel''s', 'Jack Daniel''s', 'Jack Daniel''s 750cc', 'WHISKY-JD-750', 'unidad', 750),
  ('Jack Daniel''s', 'Jack Daniel''s', 'Jack Daniel''s Clásico 3L', 'WHISKY-JD-3000', 'unidad', 3000),
  ('Jack Daniel''s Honey', 'Jack Daniel''s', 'Jack Daniel''s Honey 750cc', 'WHISKY-JDHONEY-750', 'unidad', 750),
  ('Jack Daniel''s Apple', 'Jack Daniel''s', 'Jack Daniel''s Apple Litro', 'WHISKY-JDAPPLE-1000', 'unidad', 1000),
  ('Jack Daniel''s Fire', 'Jack Daniel''s', 'Jack Daniel''s Fire Litro', 'WHISKY-JDFIRE-1000', 'unidad', 1000),
  ('Jack Daniel''s Fire', 'Jack Daniel''s', 'Jack Daniel''s Fire Estuche 750cc + 2 vasos', 'WHISKY-JDFIRE-ESTUCHE', 'estuche', 750),
  ('Jim Beam Honey', 'Jim Beam', 'Jim Beam Honey 750cc', 'WHISKY-JIMBEAM-HONEY-750', 'unidad', 750),
  ('Jim Beam Vainilla', 'Jim Beam', 'Jim Beam Vainilla 750cc', 'WHISKY-JIMBEAM-VAINILLA-750', 'unidad', 750),
  ('J&B', 'J&B', 'J&B 750cc', 'WHISKY-JB-750', 'unidad', 750),
  ('Dalmore', 'Dalmore', 'Dalmore 750cc', 'WHISKY-DALMORE-750', 'unidad', 750),
  ('Jura', 'Jura', 'Jura 750cc', 'WHISKY-JURA-750', 'unidad', 750),
  ('Label 5', 'Label 5', 'Label 5 750cc', 'WHISKY-LABEL5-750', 'unidad', 750),
  ('Balletines', 'Balletines', 'Balletines 750cc', 'WHISKY-BALLETINES-750', 'unidad', 750),
  ('Balletines', 'Balletines', 'Balletines Litro', 'WHISKY-BALLETINES-1000', 'unidad', 1000),
  ('Evan William', 'Evan William', 'Evan William 750cc', 'WHISKY-EVANWILLIAM-750', 'unidad', 750),
  ('Cardu', 'Cardu', 'Cardu 750cc', 'WHISKY-CARDU-750', 'unidad', 750),
  ('Fireball', 'Fireball', 'Fireball 750cc', 'WHISKY-FIREBALL-750', 'unidad', 750),
  ('Blenders Pride', 'Blenders Pride', 'Blenders Pride 750cc', 'WHISKY-BLENDERSPRIDE-750', 'unidad', 750),
  ('Bulleit Bourbon', 'Bulleit', 'Bulleit Bourbon 750cc', 'WHISKY-BULLEIT-750', 'unidad', 750),
  ('Whyte y Mackay', 'Whyte y Mackay', 'Whyte y Mackay 750cc', 'WHISKY-WHYTEMACKAY-750', 'unidad', 750),
  ('Buchanan''s', 'Buchanan''s', 'Buchanan''s Litro', 'WHISKY-BUCHANANS-1000', 'unidad', 1000),
  ('El Buscador Obstinado', 'El Buscador Obstinado', 'El Buscador Obstinado 750cc', 'WHISKY-ELBUSCADOR-750', 'unidad', 750),
  ('White Horse', 'White Horse', 'White Horse 750cc', 'WHISKY-WHITEHORSE-750', 'unidad', 750),
  ('Grant''s', 'Grant''s', 'Grant''s Litro', 'WHISKY-GRANTS-1000', 'unidad', 1000),
  ('Grant''s', 'Grant''s', 'Grant''s 750cc', 'WHISKY-GRANTS-750', 'unidad', 750),
  ('Old Parr', 'Old Parr', 'Old Parr 750cc', 'WHISKY-OLDPARR-750', 'unidad', 750),
  ('Blender''s', 'Blender''s', 'Blender''s 750cc', 'WHISKY-BLENDERS-750', 'unidad', 750)
) as v(producto, marca, nombre_sku, codigo, tipo, volumen)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- Precios (Johnnie Walker Red Label Litro y Balletines Litro quedan sin
-- precio a propósito: "$----"/"$---" en la lista)
insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('WHISKY-MACALLAN-750', 225000),
  ('WHISKY-JWRED-750', 33200),
  ('WHISKY-JWBLACK-1000', 66300),
  ('WHISKY-JWBLACK-750', 48450),
  ('WHISKY-JWBLACK-3000', 265100),
  ('WHISKY-JWBLACK-ESTUCHE', 85000),
  ('WHISKY-JWBLACK200-750', 67300),
  ('WHISKY-JWGOLD-750', 92000),
  ('WHISKY-JWGOLD200-750', 110900),
  ('WHISKY-JWBLONDE-750', 37400),
  ('WHISKY-JWGREEN-750', 193200),
  ('WHISKY-JW18-750', 228200),
  ('WHISKY-JW18-ESTUCHE', 350000),
  ('WHISKY-JWBLUE-750', 418000),
  ('WHISKY-JWSWING-750', 126350),
  ('WHISKY-CHIVAS12-750', 61400),
  ('WHISKY-CHIVAS12-1000', 79950),
  ('WHISKY-CHIVASEXTRA-750', 76750),
  ('WHISKY-SINGLETON15-750', 117700),
  ('WHISKY-SINGLETON18-750', 176600),
  ('WHISKY-JAMESON-IPA-750', 37600),
  ('WHISKY-JD-750', 46300),
  ('WHISKY-JD-3000', 344200),
  ('WHISKY-JDHONEY-750', 46300),
  ('WHISKY-JDAPPLE-1000', 53500),
  ('WHISKY-JDFIRE-1000', 53500),
  ('WHISKY-JDFIRE-ESTUCHE', 76300),
  ('WHISKY-JIMBEAM-HONEY-750', 41250),
  ('WHISKY-JIMBEAM-VAINILLA-750', 39950),
  ('WHISKY-JB-750', 22950),
  ('WHISKY-DALMORE-750', 304500),
  ('WHISKY-JURA-750', 250000),
  ('WHISKY-LABEL5-750', 32850),
  ('WHISKY-BALLETINES-750', 35100),
  ('WHISKY-EVANWILLIAM-750', 45000),
  ('WHISKY-CARDU-750', 127500),
  ('WHISKY-FIREBALL-750', 25300),
  ('WHISKY-BLENDERSPRIDE-750', 10600),
  ('WHISKY-BULLEIT-750', 59300),
  ('WHISKY-WHYTEMACKAY-750', 25000),
  ('WHISKY-BUCHANANS-1000', 63200),
  ('WHISKY-ELBUSCADOR-750', 28150),
  ('WHISKY-WHITEHORSE-750', 17600),
  ('WHISKY-GRANTS-1000', 30500),
  ('WHISKY-GRANTS-750', 30600),
  ('WHISKY-OLDPARR-750', 45700),
  ('WHISKY-BLENDERS-750', 8800)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

commit;
