-- Carga real de catálogo + precios de Laprida — categoría nueva VINOS,
-- primera parte: secciones "VINOS BLANCOS" y "VINOS / BLANCOS Y DULCES"
-- de la lista de Laprida (12/09/26). Todo alta nueva -- se da de alta en
-- Olavarría sin precio y Laprida recibe el override, mismo criterio de
-- siempre.
--
-- La categoría "Vinos" queda creada acá y se reutiliza en la próxima
-- tanda (tintos) -- no se vuelve a insertar en ese archivo.
--
-- Marcas "Las Perdices" y "Emilia" ya existían (se cargaron en
-- 19_laprida_espumantes.sql para sus productos espumantes/sidra) -- se
-- reutilizan acá para sus vinos, no se duplican.
--
-- "Santa Julia Estuche 2 vasos" no aclara varietal -- se cargó como
-- producto propio genérico (mismo criterio que "Bulldog Estuche con copa
-- negra": el packaging manda cuando no se sabe qué líquido lleva adentro).

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Vinos');

insert into marcas (nombre) values
  ('Finca Las Moras'), ('Trumpeter'), ('Portillo'), ('Santa Julia'),
  ('Sol Fa Soul'), ('Benjamín'), ('Alma Mora'), ('Cordero'), ('Killka'),
  ('Marlo'), ('Colón'), ('Dilema'), ('Cosecha Tardía'), ('Callia');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Vinos')
from (values
  ('Finca Las Moras Blanco', 'Finca Las Moras'),
  ('Trumpeter Chardonnay', 'Trumpeter'),
  ('Trumpeter Sauvignon Blanc', 'Trumpeter'),
  ('Portillo Naranjo Dulce', 'Portillo'),
  ('Portillo Dulce Natural', 'Portillo'),
  ('Santa Julia Estuche 2 Vasos', 'Santa Julia'),
  ('Portillo Rosé', 'Portillo'),
  ('Sol Fa Soul', 'Sol Fa Soul'),
  ('Emilia Dulce Natural', 'Emilia'),
  ('Santa Julia Chenin Dulce', 'Santa Julia'),
  ('Benjamín Dulce', 'Benjamín'),
  ('Benjamín Sauvignon', 'Benjamín'),
  ('Las Perdices Torrontés', 'Las Perdices'),
  ('Las Perdices Sauvignon Blanc', 'Las Perdices'),
  ('Alma Mora Chardonnay', 'Alma Mora'),
  ('Cordero Chardonnay', 'Cordero'),
  ('Killka Sauvignon Blanc', 'Killka'),
  ('Killka Chardonnay', 'Killka'),
  ('Marlo Blanco Dulce', 'Marlo'),
  ('Colón Durazno', 'Colón'),
  ('Dilema Blanco Dulce', 'Dilema'),
  ('Cosecha Tardía Blanco', 'Cosecha Tardía'),
  ('Callia Blanco Dulce', 'Callia')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, v.tipo, v.volumen, 'ml', 1
from (values
  ('Finca Las Moras Blanco', 'Finca Las Moras Blanco 750cc', 'VINO-FINCALASMORAS-BLANCO-750', 'unidad', 750),
  ('Trumpeter Chardonnay', 'Trumpeter Chardonnay 750cc', 'VINO-TRUMPETER-CHARDONNAY-750', 'unidad', 750),
  ('Trumpeter Sauvignon Blanc', 'Trumpeter Sauvignon Blanc 750cc', 'VINO-TRUMPETER-SAUVBLANC-750', 'unidad', 750),
  ('Portillo Naranjo Dulce', 'Portillo Naranjo Dulce 750cc', 'VINO-PORTILLO-NARANJODULCE-750', 'unidad', 750),
  ('Portillo Dulce Natural', 'Portillo Dulce Natural 750cc', 'VINO-PORTILLO-DULCENATURAL-750', 'unidad', 750),
  ('Santa Julia Estuche 2 Vasos', 'Santa Julia Estuche 2 Vasos', 'VINO-SANTAJULIA-EST2VASOS', 'estuche', 750),
  ('Portillo Rosé', 'Portillo Rosé 750cc', 'VINO-PORTILLO-ROSE-750', 'unidad', 750),
  ('Sol Fa Soul', 'Sol Fa Soul 750cc', 'VINO-SOLFASOUL-750', 'unidad', 750),
  ('Emilia Dulce Natural', 'Emilia Dulce Natural 750cc', 'VINO-EMILIA-DULCENATURAL-750', 'unidad', 750),
  ('Santa Julia Chenin Dulce', 'Santa Julia Chenin Dulce 750cc', 'VINO-SANTAJULIA-CHENINDULCE-750', 'unidad', 750),
  ('Benjamín Dulce', 'Benjamín Dulce 750cc', 'VINO-BENJAMIN-DULCE-750', 'unidad', 750),
  ('Benjamín Sauvignon', 'Benjamín Sauvignon 750cc', 'VINO-BENJAMIN-SAUVIGNON-750', 'unidad', 750),
  ('Las Perdices Torrontés', 'Las Perdices Torrontés 750cc', 'VINO-PERDICES-TORRONTES-750', 'unidad', 750),
  ('Las Perdices Sauvignon Blanc', 'Las Perdices Sauvignon Blanc 750cc', 'VINO-PERDICES-SAUVBLANC-750', 'unidad', 750),
  ('Alma Mora Chardonnay', 'Alma Mora Chardonnay 750cc', 'VINO-ALMAMORA-CHARDONNAY-750', 'unidad', 750),
  ('Cordero Chardonnay', 'Cordero Chardonnay 750cc', 'VINO-CORDERO-CHARDONNAY-750', 'unidad', 750),
  ('Killka Sauvignon Blanc', 'Killka Sauvignon Blanc 750cc', 'VINO-KILLKA-SAUVBLANC-750', 'unidad', 750),
  ('Killka Chardonnay', 'Killka Chardonnay 750cc', 'VINO-KILLKA-CHARDONNAY-750', 'unidad', 750),
  ('Marlo Blanco Dulce', 'Marlo Blanco Dulce 750cc', 'VINO-MARLO-BLANCODULCE-750', 'unidad', 750),
  ('Colón Durazno', 'Colón Durazno 750cc', 'VINO-COLON-DURAZNO-750', 'unidad', 750),
  ('Dilema Blanco Dulce', 'Dilema Blanco Dulce 750cc', 'VINO-DILEMA-BLANCODULCE-750', 'unidad', 750),
  ('Cosecha Tardía Blanco', 'Cosecha Tardía Blanco 750cc', 'VINO-COSECHATARDIA-BLANCO-750', 'unidad', 750),
  ('Callia Blanco Dulce', 'Callia Blanco Dulce 750cc', 'VINO-CALLIA-BLANCODULCE-750', 'unidad', 750)
) as v(producto, nombre_sku, codigo, tipo, volumen)
join productos p on p.nombre = v.producto;

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('VINO-FINCALASMORAS-BLANCO-750', 6500),
  ('VINO-TRUMPETER-CHARDONNAY-750', 8500),
  ('VINO-TRUMPETER-SAUVBLANC-750', 8500),
  ('VINO-PORTILLO-NARANJODULCE-750', 6000),
  ('VINO-PORTILLO-DULCENATURAL-750', 6000),
  ('VINO-SANTAJULIA-EST2VASOS', 21000),
  ('VINO-PORTILLO-ROSE-750', 5600),
  ('VINO-SOLFASOUL-750', 5800),
  ('VINO-EMILIA-DULCENATURAL-750', 7400),
  ('VINO-SANTAJULIA-CHENINDULCE-750', 7300),
  ('VINO-BENJAMIN-DULCE-750', 5300),
  ('VINO-BENJAMIN-SAUVIGNON-750', 5300),
  ('VINO-PERDICES-TORRONTES-750', 9900),
  ('VINO-PERDICES-SAUVBLANC-750', 9900),
  ('VINO-ALMAMORA-CHARDONNAY-750', 6500),
  ('VINO-CORDERO-CHARDONNAY-750', 5300),
  ('VINO-KILLKA-SAUVBLANC-750', 7800),
  ('VINO-KILLKA-CHARDONNAY-750', 7800),
  ('VINO-MARLO-BLANCODULCE-750', 5300),
  ('VINO-COLON-DURAZNO-750', 7700),
  ('VINO-DILEMA-BLANCODULCE-750', 5000),
  ('VINO-COSECHATARDIA-BLANCO-750', 4850),
  ('VINO-CALLIA-BLANCODULCE-750', 5300)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
