-- =====================================================================
-- Ventas en papel del 2026-10-15 (Olavarría) — PASO 1: DIAGNÓSTICO
-- =====================================================================
-- SOLO LECTURA. No escribe nada. No abre transacción.
--
-- Qué hace: toma la lista de ventas anotadas en papel, tal como vino, y
-- busca para cada nombre los SKU del catálogo que podrían corresponder.
-- La lista en papel está escrita en el idioma del mostrador ("Fernet
-- Branca 1 litro") y el catálogo en el del sistema ("Fernet Branca
-- 1000cc"), así que el match es por palabras, no por igualdad de texto:
--
--   1. Normaliza los dos lados (minúsculas, sin acentos, sin signos).
--   2. Separa el nombre en papel en palabras, descartando las que no
--      distinguen nada (litro, ml, cc, lata, pack, x6, números sueltos).
--   3. Cuenta cuántas de esas palabras aparecen en marca + producto +
--      nombre del SKU. Esa cuenta es el puntaje.
--   4. Suma un punto si el volumen escrito en papel coincide con el
--      volumen del SKU (473ml = 473ml, 1 litro = 1000ml).
--   5. Devuelve, por cada línea, los SKU de mayor puntaje.
--
-- Es a propósito tolerante: preferimos ver dos candidatos y elegir, que
-- no ver ninguno. La columna ESTADO dice dónde hay que decidir:
--
--   SIN CANDIDATOS     -> ningún SKU se parece. O no está en el catálogo,
--                         o está cargado con otro nombre. Esa línea no se
--                         va a descontar.
--   UNICO              -> un solo candidato.
--   DESEMPATE - MIRAR  -> empataron varios. Mirá PRESENTACION, UNIDADES y
--                         VOL_SKU para distinguir lata de pack y 750 de
--                         1000.
--
-- La columna PASO_2 dice "SE DESCUENTA" en el SKU que `02-ajustes.sql` va
-- a elegir para esa línea. En los empates es el que gana el desempate
-- documentado más abajo; si no es el correcto, se fuerza en la tabla
-- ELECCIONES del paso 2.
--
-- Mirá también COINCIDENCIA (palabras que matchearon / palabras
-- buscadas): si dice 1/3, el match es flojo aunque sea único.
--
-- AVISO_STOCK marca las líneas donde el descuento dejaría el stock en
-- negativo, con el número exacto en que quedaría. Esas son las que hay
-- que decidir antes del paso 2.
--
-- Las filas salen ordenadas por problema: primero SIN CANDIDATOS, después
-- los empates, al final las que están resueltas.
-- =====================================================================

with lista (orden, nombre, cantidad) as (
  values
    ( 1, '1890 lata 473ml',                      10),
    ( 2, 'Alma Mora Malbec',                      6),
    ( 3, 'Andes IPA',                             6),
    ( 4, 'Andes Roja lata 473ml',                 4),
    ( 5, 'Brahma lata 473ml',                    12),
    ( 6, 'Budweiser 1 litro',                     1),
    ( 7, 'Campari 750ml',                         1),
    ( 8, 'Cepita 1 litro',                        2),
    ( 9, 'Chateau Subsónico Malbec Cabernet',     1),
    (10, 'Coca Cola 3 litros',                    3),
    (11, 'Cordero Malbec',                        1),
    (12, 'Corona 330ml',                          6),
    (13, 'Cynar 70',                              1),
    (14, 'Cynar clásico',                         1),
    (15, 'DV Catena Pinot-Pinot',                 1),
    (16, 'Esperado Syrah Malbec',                 1),
    (17, 'Etchart Privado Torrontés',             1),
    (18, 'Fausto Malbec',                         3),
    (19, 'Fernet Branca 750ml',                   1),
    (20, 'Fernet Branca 1 litro',                 2),
    (21, 'Fernet Branca Menta 450ml',             1),
    (22, 'Fuego Negro Petit Verdot',              1),
    (23, 'Gancia 1 litro',                        2),
    (24, 'Gold Label 200 Years',                  1),
    (25, 'Gold Label Reserve',                    1),
    (26, 'Grant''s Whisky 1 litro',               1),
    (27, 'Heineken lata 473ml',                   4),
    (28, 'Heineken pack x6 473ml',                2),
    (29, 'Heineken 710ml',                        1),
    (30, 'Heineken 1 litro',                      8),
    (31, 'Hijos Red Wine',                        1),
    (32, 'Imperial IPA 1 litro',                  1),
    (33, 'Imperial Lager 1 litro',                1),
    (34, 'Johnnie Walker Black Label 750ml',      2),
    (35, 'La Scala licor de dulce de leche',      1),
    (36, 'Las Perdices Malbec',                   2),
    (37, 'Los Bocheros Malbec',                   1),
    (38, 'Los Bocheros Red Blend',                1),
    (39, 'Monster Peachy Keen',                   1),
    (40, 'Monster Ultra',                         1),
    (41, 'Mula IPA botella',                      1),
    (42, 'New Age',                               1),
    (43, 'Pájaros Argentinos Malbec',             1),
    (44, 'Peroni',                                1),
    (45, 'Perro Callejero Pinot Noir',            2),
    (46, 'Portillo Malbec',                       3),
    (47, 'Privado Reserva Cabernet Franc',        1),
    (48, 'Privado Reserva Cabernet Sauvignon',    1),
    (49, 'Privado Reserva Tempranillo',           2),
    (50, 'Salentein Extra Brut',                  2),
    (51, 'Santa Julia Chenin Dulce',              2),
    (52, 'Santa Julia Tintillo',                  1),
    (53, 'Schneider 473ml pack x6',               1),
    (54, 'Schneider 710ml',                       2),
    (55, 'Schweppes clásica 1.5 litros',          1),
    (56, 'Schweppes Tónica 1.5 litros',           1),
    (57, 'Smirnoff clásico',                      2),
    (58, 'Speed 473ml',                           6),
    (59, 'Stella Artois lata 473ml',             12),
    (60, 'Stella Artois porrón 330ml',            8),
    (61, 'Trumpeter Chardonnay',                  1),
    (62, 'Trumpeter Malbec',                     12),
    (63, 'Trumpeter Reserva Malbec',              3),
    (64, 'Whyte & Mackay Whisky 700ml',           1)
),

-- Normalización del lado del papel:
--   minúsculas -> sin acentos -> todo lo que no es letra, número o punto
--   pasa a ser espacio -> se separan números de letras ("473ml" -> "473
--   ml", "x6" -> "x 6").
-- El punto se conserva para no partir "1.5 litros" en dos números.
norm as (
  select
    l.orden,
    l.nombre,
    l.cantidad,
    btrim(regexp_replace(regexp_replace(
      regexp_replace(
        translate(lower(l.nombre), 'áéíóúàèìòùäëïöüñç', 'aeiouaeiouaeiounc'),
        '[^a-z0-9.]+', ' ', 'g'
      ),
      '([0-9])([a-z])', '\1 \2', 'g'),
      '([a-z])([0-9])', '\1 \2', 'g'
    )) as n
  from lista l
),

-- Volumen escrito en papel. vol_ml es para comparar contra el SKU;
-- vol_escrito es el número tal como está en el papel (1, 473, 1.5), y se
-- usa para saber qué número NO es un nombre: el 473 de "473ml" no
-- distingue nada, pero el 1890 de "1890 lata" es la marca y el 70 de
-- "Cynar 70" es el producto.
vol as (
  select
    n.orden,
    coalesce(
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:ml|cc)(?: |$)'))::numeric,
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:l|lt|litro|litros)(?: |$)'))::numeric * 1000
    ) as vol_ml,
    coalesce(
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:ml|cc)(?: |$)'))::numeric,
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:l|lt|litro|litros)(?: |$)'))::numeric
    ) as vol_escrito
  from norm n
),

-- Presentación escrita en papel. Hace falta porque la lata y el pack x6
-- comparten volumen (473ml los dos) y sin esto empatan siempre.
pres as (
  select
    n.orden,
    case
      when n.n ~ '(pack|x [0-9])'              then 'pack'
      when n.n ~ '(lata|latas|porron|botella)' then 'unidad'
      else null
    end as pres_papel
  from norm n
),

-- Palabras que sí distinguen. Se descartan las de presentación y las de
-- volumen porque el catálogo no siempre las escribe igual.
tokens as (
  select n.orden, t.tok
  from norm n
  left join vol v on v.orden = n.orden
  cross join lateral unnest(string_to_array(n.n, ' ')) as t(tok)
  where t.tok <> ''
    -- Se va solo el número del volumen. Los demás números son nombre
    -- (1890, Cynar 70, Gold Label 200) o cantidad de pack (x6 -> 6).
    and not coalesce(
      t.tok ~ '^[0-9]+(\.[0-9]+)?$' and t.tok::numeric = v.vol_escrito,
      false
    )
    and t.tok not in (
      'l', 'lt', 'litro', 'litros', 'ml', 'cc',
      'lata', 'latas', 'pack', 'packs', 'porron', 'porrones',
      'botella', 'botellas', 'x', 'de', 'del', 'la', 'el', 'y',
      'whisky', 'licor', 'vino'
    )
),

tok_tot as (
  select orden, count(*) as total from tokens group by orden
),

-- Lado catálogo: marca + producto + nombre del SKU, normalizado igual.
cand as (
  select
    s.id,
    s.codigo_interno,
    s.nombre as sku_nombre,
    s.activo,
    p.nombre as producto,
    m.nombre as marca,
    s.tipo_presentacion,
    s.unidades_contenidas,
    s.volumen,
    s.unidad_volumen,
    case when s.unidad_volumen = 'l' then s.volumen * 1000 else s.volumen end as vol_ml_sku,
    btrim(regexp_replace(regexp_replace(
      regexp_replace(
        translate(lower(m.nombre || ' ' || p.nombre || ' ' || s.nombre),
                  'áéíóúàèìòùäëïöüñç', 'aeiouaeiouaeiounc'),
        '[^a-z0-9.]+', ' ', 'g'
      ),
      '([0-9])([a-z])', '\1 \2', 'g'),
      '([a-z])([0-9])', '\1 \2', 'g'
    )) as h
  from skus s
  join productos p on p.id = s.producto_id
  join marcas m on m.id = p.marca_id
),

puntajes as (
  select t.orden, c.id, count(*) as score
  from tokens t
  join cand c on position(t.tok in c.h) > 0
  group by t.orden, c.id
),

-- Se exige al menos la mitad de las palabras. Después, un punto extra por
-- volumen coincidente (separa el 750 del 1000) y otro por presentación
-- coincidente (separa la lata del pack x6, que tienen el mismo volumen).
rankeados as (
  select
    pj.orden,
    pj.id,
    pj.score,
    tt.total,
    pj.score
      + case when v.vol_ml is not null and c.vol_ml_sku = v.vol_ml then 1 else 0 end
      + case when pr.pres_papel is not null and c.tipo_presentacion = pr.pres_papel then 1 else 0 end
      as puntaje,
    pr.pres_papel,
    c.tipo_presentacion,
    c.codigo_interno,
    length(c.h) as largo,
    (ss.cantidad is not null) as tiene_stock
  from puntajes pj
  join tok_tot tt on tt.orden = pj.orden
  join cand c on c.id = pj.id
  left join vol v on v.orden = pj.orden
  left join pres pr on pr.orden = pj.orden
  left join stock_sucursal ss
    on ss.sku_id = c.id
   and ss.sucursal_id = (select id from sucursales where es_central limit 1)
  where pj.score >= greatest(1, ceil(tt.total / 2.0))
),

con_rank as (
  select
    rk.*,
    dense_rank() over (partition by rk.orden order by rk.puntaje desc) as posicion
  from rankeados rk
),

-- Mismo desempate que aplica 02-ajustes.sql, para que el diagnóstico
-- muestre exactamente el SKU que se va a descontar:
--   1. si el papel no dice pack, gana la unidad suelta
--   2. gana el que tiene stock contado en Olavarría
--   3. gana el nombre más corto (el que no agrega palabras)
--   4. por código interno, para que siempre dé lo mismo
mejores as (
  select
    cr.*,
    row_number() over (
      partition by cr.orden
      order by
        case when cr.pres_papel is null and cr.tipo_presentacion = 'unidad' then 0 else 1 end,
        case when cr.tiene_stock then 0 else 1 end,
        cr.largo,
        cr.codigo_interno
    ) as eleccion
  from con_rank cr
  where cr.posicion = 1
),

cuenta as (
  select orden, count(*) as cantidad_candidatos from mejores group by orden
),

sucursal_central as (
  select id from sucursales where es_central limit 1
),

sucursal_satelite as (
  select id from sucursales where not es_central limit 1
)

select
  n.orden,
  n.nombre                                    as nombre_en_papel,
  n.cantidad                                  as cantidad_vendida,
  case
    when mj.id is null              then 'SIN CANDIDATOS'
    when ct.cantidad_candidatos = 1 then 'UNICO'
    else 'DESEMPATE - MIRAR'
  end                                         as estado,
  case when mj.eleccion = 1 then 'SE DESCUENTA' else '' end as paso_2,
  case
    when mj.eleccion = 1
     and count(*) filter (where mj.eleccion = 1) over (partition by mj.id) > 1
    then 'REPETIDO - otra linea cae en este mismo SKU'
    else ''
  end                                         as repetido,
  c.codigo_interno,
  c.sku_nombre,
  c.producto,
  c.marca,
  c.tipo_presentacion                         as presentacion,
  c.unidades_contenidas                       as unidades,
  (c.volumen::text || c.unidad_volumen)       as vol_sku,
  case when coalesce(c.activo, true) then '' else 'SKU INACTIVO' end as aviso_activo,
  so.cantidad                                 as stock_olavarria,
  sl.cantidad                                 as stock_laprida,
  case
    when mj.id is null            then null
    when so.cantidad is null      then 'sin stock contado -> quedaria en ' || (-n.cantidad)::text
    when so.cantidad < n.cantidad then 'stock insuficiente -> quedaria en ' || (so.cantidad - n.cantidad)::text
    else ''
  end                                         as aviso_stock,
  (mj.score::text || '/' || mj.total::text)   as coincidencia
from norm n
left join mejores mj on mj.orden = n.orden
left join cuenta  ct on ct.orden = n.orden
left join cand    c  on c.id = mj.id
left join stock_sucursal so
  on so.sku_id = c.id and so.sucursal_id = (select id from sucursal_central)
left join stock_sucursal sl
  on sl.sku_id = c.id and sl.sucursal_id = (select id from sucursal_satelite)
order by
  case
    when mj.id is null              then 0
    when ct.cantidad_candidatos > 1 then 1
    else 2
  end,
  n.orden,
  mj.eleccion,
  c.codigo_interno;
