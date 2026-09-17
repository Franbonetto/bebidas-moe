-- Carga real de catálogo — categoría FERNET (segunda tanda).
-- Fuente: lista de precios de Moe, bloque dedicado "Fernet Branca /
-- Fernet 1882 / Fernet Buhero Negro / Fernet 777" (con precios sueltos,
-- no solo combos). Precio = precio_base de Olavarría.
--
-- Supuestos / pendientes:
--
--   1. Fernet Branca 450cc figura como "$---" en la lista (sin precio
--      todavía) -- se crea el SKU pero SIN fila en `precios`, así que en
--      /precios va a aparecer como "Sin precio cargado" hasta que me
--      pases el número real.
--   2. "1882", "Buhero Negro" y "777" se cargaron como marcas propias
--      (cada una con un único producto "Fernet X") -- no hay más contexto
--      en la lista para saber si son líneas de una marca más grande.
--   3. Las promos "Fernet + Coca-Cola" (6 combos: Branca 450/750/litro,
--      1882, Buhero Negro, 777, cada uno con su propio precio de combo)
--      quedan SIN cargar todavía -- son combos con Coca-Cola, que recién
--      va a existir cuando cargue Gaseosas. Cuando llegue esa tanda los
--      arma con el precio de cada Fernet ya cargado acá + lo que falte
--      para llegar al total del combo.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Fernet');

insert into marcas (nombre) values
  ('Branca'), ('1882'), ('Buhero Negro'), ('777');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Fernet')
from (values
  ('Fernet Branca', 'Branca'),
  ('Fernet 1882', '1882'),
  ('Fernet Buhero Negro', 'Buhero Negro'),
  ('Fernet 777', '777')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Fernet Branca', 'Branca', 'Fernet Branca Litro', 'FERNET-BRANCA-1000', 1000),
  ('Fernet Branca', 'Branca', 'Fernet Branca 750cc', 'FERNET-BRANCA-750', 750),
  ('Fernet Branca', 'Branca', 'Fernet Branca 450cc', 'FERNET-BRANCA-450', 450),
  ('Fernet 1882', '1882', 'Fernet 1882 750cc', 'FERNET-1882-750', 750),
  ('Fernet Buhero Negro', 'Buhero Negro', 'Fernet Buhero Negro 750cc', 'FERNET-BUHERONEGRO-750', 750),
  ('Fernet 777', '777', 'Fernet 777 750cc', 'FERNET-777-750', 750)
) as v(producto, marca, nombre_sku, codigo, volumen)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- Precios (Fernet Branca 450cc queda afuera a propósito: sin precio en la
-- lista todavía)
insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('FERNET-BRANCA-1000', 23850),
  ('FERNET-BRANCA-750', 18850),
  ('FERNET-1882-750', 9000),
  ('FERNET-BUHERONEGRO-750', 8800),
  ('FERNET-777-750', 9400)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

commit;
