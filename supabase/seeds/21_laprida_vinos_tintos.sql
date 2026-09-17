-- Carga real de catálogo + precios de Laprida — categoría VINOS, segunda
-- parte: secciones "TINTOS" y "VINOS – MALBEC / CABERNET / VARIETALES" de
-- la lista de Laprida (12/09/26). Todo alta nueva. La categoría "Vinos"
-- ya fue creada en 20_laprida_vinos_blancos.sql -- no se vuelve a insertar
-- acá.
--
-- Marcas reutilizadas de la tanda de blancos (mismo criterio, no se
-- duplican): Trumpeter, Portillo, Santa Julia, Killka, Cordero, Callia,
-- Cosecha Tardía, Emilia, Finca Las Moras, Las Perdices, Alma Mora
-- (distinta de "Alma Negra", que es marca nueva y no tiene relación).
-- Salentein se reutiliza de 19_laprida_espumantes.sql.
--
-- Supuestos:
--   1. "Caja" sin litraje aclarado (Alambrado, Don David, San Felipe, Las
--      Perdices) se asumió 3L -- en esta misma lista otros vinos en caja
--      SÍ aclaran "3L" (Sinergia, Red Blend Perdices, Mosquita Muerta), así
--      que se tomó ese tamaño como default de la presentación "caja".
--   2. "Fausto x2 $54.900" se cargó como un SKU de tipo 'pack' (2 botellas
--      de 750cc), no como una botella de 1500cc -- "x2" en el resto de la
--      lista siempre significa "dos unidades", nunca litraje.
--   3. Nombres con errores de tipeo evidentes en la planilla se
--      normalizaron a la ortografía real de la marca: "Sain Felicien" ->
--      Saint Felicien, "Padrillos" -> Padrillo (ya había "Padrillo Malbec"
--      antes en la misma lista), "Tucumen" -> Tucumán. "Patridge" se dejó
--      tal cual porque no hay otra mención en la lista para confirmar si
--      es "Partridge" -- revisar en /productos.
--   4. "Portillo (todos) $5.600" se cargó como un único producto genérico
--      "Portillo Tinto" (la planilla no distingue variedades para ese
--      precio, dice literal "todos").
--   5. Volumen no aclarado => 750cc en el resto de los vinos.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values
  ('Alambrado'), ('Fausto'), ('Sinergia'), ('Don David'), ('San Felipe'),
  ('Finca Gabriel'), ('Mosquita Muerta'), ('Privado'), ('Uva Sweet'),
  ('Saint Felicien'), ('Tonel 14'), ('Altos Las Hormigas'), ('Ampakama'),
  ('Aristides'), ('Alzamora'), ('Casa Agostina'), ('Contraviento'),
  ('Latitud 33'), ('Cocoliche'), ('Dada'), ('La Máquina'), ('Tucumán'),
  ('Cafayate'), ('Animal'), ('Amalaya'), ('Perro Callejero'), ('Hitos'),
  ('Aguijón de Abeja'), ('Hormiga Negra'), ('Padrillo'), ('Civit 757'),
  ('El Bautismo'), ('Abrasado'), ('Fuego'), ('Alma Negra'), ('DV Catena'),
  ('Rutini'), ('Pájaros Argentinos'), ('Fabre Montmayor'), ('Monteagrelo'),
  ('Patridge'), ('Colomé'), ('Luigi Bosca'), ('Hippie');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Vinos')
from (values
  ('Alambrado Caja', 'Alambrado'),
  ('Fausto x2', 'Fausto'),
  ('Sinergia 3L', 'Sinergia'),
  ('Las Perdices Red Blend 3L', 'Las Perdices'),
  ('Don David Caja', 'Don David'),
  ('San Felipe Caja', 'San Felipe'),
  ('Las Perdices Caja', 'Las Perdices'),
  ('Finca Gabriel Dulce', 'Finca Gabriel'),
  ('Cosecha Tardía Dulce', 'Cosecha Tardía'),
  ('Finca Gabriel Dulce Natural', 'Finca Gabriel'),
  ('Mosquita Muerta 3L', 'Mosquita Muerta'),
  ('Privado', 'Privado'),
  ('Callia Malbec', 'Callia'),
  ('Uva Sweet', 'Uva Sweet'),
  ('Alambrado Cabernet Franc', 'Alambrado'),
  ('Saint Felicien Malbec', 'Saint Felicien'),
  ('Santa Julia Cabernet Sauvignon', 'Santa Julia'),
  ('Tonel 14 Cabernet Sauvignon', 'Tonel 14'),
  ('Santa Julia Malbec', 'Santa Julia'),
  ('Altos Las Hormigas', 'Altos Las Hormigas'),
  ('Ampakama Cabernet Sauvignon', 'Ampakama'),
  ('Aristides', 'Aristides'),
  ('Alzamora Malbec', 'Alzamora'),
  ('Casa Agostina Malbec', 'Casa Agostina'),
  ('Contraviento Blend Tintas', 'Contraviento'),
  ('Latitud 33 Malbec', 'Latitud 33'),
  ('Cocoliche Cabernet Sauvignon', 'Cocoliche'),
  ('Dada Malbec', 'Dada'),
  ('La Máquina Malbec', 'La Máquina'),
  ('Tucumán Cabernet Sauvignon', 'Tucumán'),
  ('Cafayate Malbec', 'Cafayate'),
  ('Killka Malbec', 'Killka'),
  ('Santa Julia Dulce', 'Santa Julia'),
  ('Animal Malbec', 'Animal'),
  ('Amalaya Malbec', 'Amalaya'),
  ('Perro Callejero', 'Perro Callejero'),
  ('Hitos Malbec', 'Hitos'),
  ('Emilia Cabernet', 'Emilia'),
  ('Portillo Tinto', 'Portillo'),
  ('Finca Gabriel Cabernet', 'Finca Gabriel'),
  ('Aguijón de Abeja Obrera', 'Aguijón de Abeja'),
  ('Aguijón de Abeja Reina', 'Aguijón de Abeja'),
  ('Cordero Malbec', 'Cordero'),
  ('Hormiga Negra', 'Hormiga Negra'),
  ('Padrillo Malbec', 'Padrillo'),
  ('Finca Las Moras Malbec', 'Finca Las Moras'),
  ('Civit 757', 'Civit 757'),
  ('El Bautismo', 'El Bautismo'),
  ('Alma Mora Tinto', 'Alma Mora'),
  ('Abrasado Cabernet', 'Abrasado'),
  ('Fuego Negro', 'Fuego'),
  ('Trumpeter Reserva', 'Trumpeter'),
  ('Alma Negra', 'Alma Negra'),
  ('DV Catena Malbec', 'DV Catena'),
  ('Rutini Malbec', 'Rutini'),
  ('Rutini Cabernet Malbec', 'Rutini'),
  ('Fuego Blanco Syrah Malbec', 'Fuego'),
  ('Pájaros Argentinos', 'Pájaros Argentinos'),
  ('DV Catena Malbec Cabernet', 'DV Catena'),
  ('Fabre Montmayor', 'Fabre Montmayor'),
  ('Trumpeter Malbec', 'Trumpeter'),
  ('Killka Corte Tintas', 'Killka'),
  ('Monteagrelo', 'Monteagrelo'),
  ('Las Perdices Reserva', 'Las Perdices'),
  ('Las Perdices Red Blend', 'Las Perdices'),
  ('Las Perdices Malbec', 'Las Perdices'),
  ('Patridge', 'Patridge'),
  ('Colomé Malbec', 'Colomé'),
  ('Luigi Bosca Malbec', 'Luigi Bosca'),
  ('Santa Julia Syrah', 'Santa Julia'),
  ('Hippie Blue Pinot', 'Hippie'),
  ('Padrillo Pinot', 'Padrillo'),
  ('Saint Felicien Pinot', 'Saint Felicien'),
  ('Salentein Reserva Pinot', 'Salentein'),
  ('Don David Pinot', 'Don David')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, v.tipo, v.volumen, 'ml', v.unidades
from (values
  ('Alambrado Caja', 'Alambrado Caja 3L', 'VINO-ALAMBRADO-CAJA-3000', 'unidad', 3000, 1),
  ('Fausto x2', 'Fausto x2 (750cc)', 'VINO-FAUSTO-X2', 'pack', 750, 2),
  ('Sinergia 3L', 'Sinergia 3L', 'VINO-SINERGIA-3000', 'unidad', 3000, 1),
  ('Las Perdices Red Blend 3L', 'Las Perdices Red Blend 3L', 'VINO-PERDICES-REDBLEND-3000', 'unidad', 3000, 1),
  ('Don David Caja', 'Don David Caja 3L', 'VINO-DONDAVID-CAJA-3000', 'unidad', 3000, 1),
  ('San Felipe Caja', 'San Felipe Caja 3L', 'VINO-SANFELIPE-CAJA-3000', 'unidad', 3000, 1),
  ('Las Perdices Caja', 'Las Perdices Caja 3L', 'VINO-PERDICES-CAJA-3000', 'unidad', 3000, 1),
  ('Finca Gabriel Dulce', 'Finca Gabriel Dulce 750cc', 'VINO-FINCAGABRIEL-DULCE-750', 'unidad', 750, 1),
  ('Cosecha Tardía Dulce', 'Cosecha Tardía Dulce 750cc', 'VINO-COSECHATARDIA-DULCE-750', 'unidad', 750, 1),
  ('Finca Gabriel Dulce Natural', 'Finca Gabriel Dulce Natural 750cc', 'VINO-FINCAGABRIEL-DULCENATURAL-750', 'unidad', 750, 1),
  ('Mosquita Muerta 3L', 'Mosquita Muerta 3L', 'VINO-MOSQUITAMUERTA-3000', 'unidad', 3000, 1),
  ('Privado', 'Privado 750cc', 'VINO-PRIVADO-750', 'unidad', 750, 1),
  ('Callia Malbec', 'Callia Malbec 750cc', 'VINO-CALLIA-MALBEC-750', 'unidad', 750, 1),
  ('Uva Sweet', 'Uva Sweet 750cc', 'VINO-UVASWEET-750', 'unidad', 750, 1),
  ('Alambrado Cabernet Franc', 'Alambrado Cabernet Franc 750cc', 'VINO-ALAMBRADO-CFRANC-750', 'unidad', 750, 1),
  ('Saint Felicien Malbec', 'Saint Felicien Malbec 750cc', 'VINO-SAINTFELICIEN-MALBEC-750', 'unidad', 750, 1),
  ('Santa Julia Cabernet Sauvignon', 'Santa Julia Cabernet Sauvignon 750cc', 'VINO-SANTAJULIA-CABSAUV-750', 'unidad', 750, 1),
  ('Tonel 14 Cabernet Sauvignon', 'Tonel 14 Cabernet Sauvignon 750cc', 'VINO-TONEL14-CABSAUV-750', 'unidad', 750, 1),
  ('Santa Julia Malbec', 'Santa Julia Malbec 750cc', 'VINO-SANTAJULIA-MALBEC-750', 'unidad', 750, 1),
  ('Altos Las Hormigas', 'Altos Las Hormigas 750cc', 'VINO-ALTOSLASHORMIGAS-750', 'unidad', 750, 1),
  ('Ampakama Cabernet Sauvignon', 'Ampakama Cabernet Sauvignon 750cc', 'VINO-AMPAKAMA-CABSAUV-750', 'unidad', 750, 1),
  ('Aristides', 'Aristides 750cc', 'VINO-ARISTIDES-750', 'unidad', 750, 1),
  ('Alzamora Malbec', 'Alzamora Malbec 750cc', 'VINO-ALZAMORA-MALBEC-750', 'unidad', 750, 1),
  ('Casa Agostina Malbec', 'Casa Agostina Malbec 750cc', 'VINO-CASAAGOSTINA-MALBEC-750', 'unidad', 750, 1),
  ('Contraviento Blend Tintas', 'Contraviento Blend Tintas 750cc', 'VINO-CONTRAVIENTO-BLENDTINTAS-750', 'unidad', 750, 1),
  ('Latitud 33 Malbec', 'Latitud 33 Malbec 750cc', 'VINO-LATITUD33-MALBEC-750', 'unidad', 750, 1),
  ('Cocoliche Cabernet Sauvignon', 'Cocoliche Cabernet Sauvignon 750cc', 'VINO-COCOLICHE-CABSAUV-750', 'unidad', 750, 1),
  ('Dada Malbec', 'Dada Malbec 750cc', 'VINO-DADA-MALBEC-750', 'unidad', 750, 1),
  ('La Máquina Malbec', 'La Máquina Malbec 750cc', 'VINO-LAMAQUINA-MALBEC-750', 'unidad', 750, 1),
  ('Tucumán Cabernet Sauvignon', 'Tucumán Cabernet Sauvignon 750cc', 'VINO-TUCUMAN-CABSAUV-750', 'unidad', 750, 1),
  ('Cafayate Malbec', 'Cafayate Malbec 750cc', 'VINO-CAFAYATE-MALBEC-750', 'unidad', 750, 1),
  ('Killka Malbec', 'Killka Malbec 750cc', 'VINO-KILLKA-MALBEC-750', 'unidad', 750, 1),
  ('Santa Julia Dulce', 'Santa Julia Dulce 750cc', 'VINO-SANTAJULIA-DULCE-750', 'unidad', 750, 1),
  ('Animal Malbec', 'Animal Malbec 750cc', 'VINO-ANIMAL-MALBEC-750', 'unidad', 750, 1),
  ('Amalaya Malbec', 'Amalaya Malbec 750cc', 'VINO-AMALAYA-MALBEC-750', 'unidad', 750, 1),
  ('Perro Callejero', 'Perro Callejero 750cc', 'VINO-PERROCALLEJERO-750', 'unidad', 750, 1),
  ('Hitos Malbec', 'Hitos Malbec 750cc', 'VINO-HITOS-MALBEC-750', 'unidad', 750, 1),
  ('Emilia Cabernet', 'Emilia Cabernet 750cc', 'VINO-EMILIA-CABERNET-750', 'unidad', 750, 1),
  ('Portillo Tinto', 'Portillo Tinto 750cc', 'VINO-PORTILLO-TINTO-750', 'unidad', 750, 1),
  ('Finca Gabriel Cabernet', 'Finca Gabriel Cabernet 750cc', 'VINO-FINCAGABRIEL-CABERNET-750', 'unidad', 750, 1),
  ('Aguijón de Abeja Obrera', 'Aguijón de Abeja Obrera 750cc', 'VINO-AGUIJONABEJA-OBRERA-750', 'unidad', 750, 1),
  ('Aguijón de Abeja Reina', 'Aguijón de Abeja Reina 750cc', 'VINO-AGUIJONABEJA-REINA-750', 'unidad', 750, 1),
  ('Cordero Malbec', 'Cordero Malbec 750cc', 'VINO-CORDERO-MALBEC-750', 'unidad', 750, 1),
  ('Hormiga Negra', 'Hormiga Negra 750cc', 'VINO-HORMIGANEGRA-750', 'unidad', 750, 1),
  ('Padrillo Malbec', 'Padrillo Malbec 750cc', 'VINO-PADRILLO-MALBEC-750', 'unidad', 750, 1),
  ('Finca Las Moras Malbec', 'Finca Las Moras Malbec 750cc', 'VINO-FINCALASMORAS-MALBEC-750', 'unidad', 750, 1),
  ('Civit 757', 'Civit 757 750cc', 'VINO-CIVIT757-750', 'unidad', 750, 1),
  ('El Bautismo', 'El Bautismo 750cc', 'VINO-ELBAUTISMO-750', 'unidad', 750, 1),
  ('Alma Mora Tinto', 'Alma Mora Tinto 750cc', 'VINO-ALMAMORA-TINTO-750', 'unidad', 750, 1),
  ('Abrasado Cabernet', 'Abrasado Cabernet 750cc', 'VINO-ABRASADO-CABERNET-750', 'unidad', 750, 1),
  ('Fuego Negro', 'Fuego Negro 750cc', 'VINO-FUEGO-NEGRO-750', 'unidad', 750, 1),
  ('Trumpeter Reserva', 'Trumpeter Reserva 750cc', 'VINO-TRUMPETER-RESERVA-750', 'unidad', 750, 1),
  ('Alma Negra', 'Alma Negra 750cc', 'VINO-ALMANEGRA-750', 'unidad', 750, 1),
  ('DV Catena Malbec', 'DV Catena Malbec 750cc', 'VINO-DVCATENA-MALBEC-750', 'unidad', 750, 1),
  ('Rutini Malbec', 'Rutini Malbec 750cc', 'VINO-RUTINI-MALBEC-750', 'unidad', 750, 1),
  ('Rutini Cabernet Malbec', 'Rutini Cabernet Malbec 750cc', 'VINO-RUTINI-CABMALBEC-750', 'unidad', 750, 1),
  ('Fuego Blanco Syrah Malbec', 'Fuego Blanco Syrah Malbec 750cc', 'VINO-FUEGO-BLANCOSYRAHMALBEC-750', 'unidad', 750, 1),
  ('Pájaros Argentinos', 'Pájaros Argentinos 750cc', 'VINO-PAJAROSARGENTINOS-750', 'unidad', 750, 1),
  ('DV Catena Malbec Cabernet', 'DV Catena Malbec Cabernet 750cc', 'VINO-DVCATENA-MALBECCAB-750', 'unidad', 750, 1),
  ('Fabre Montmayor', 'Fabre Montmayor 750cc', 'VINO-FABREMONTMAYOR-750', 'unidad', 750, 1),
  ('Trumpeter Malbec', 'Trumpeter Malbec 750cc', 'VINO-TRUMPETER-MALBEC-750', 'unidad', 750, 1),
  ('Killka Corte Tintas', 'Killka Corte Tintas 750cc', 'VINO-KILLKA-CORTETINTAS-750', 'unidad', 750, 1),
  ('Monteagrelo', 'Monteagrelo 750cc', 'VINO-MONTEAGRELO-750', 'unidad', 750, 1),
  ('Las Perdices Reserva', 'Las Perdices Reserva 750cc', 'VINO-PERDICES-RESERVA-750', 'unidad', 750, 1),
  ('Las Perdices Red Blend', 'Las Perdices Red Blend 750cc', 'VINO-PERDICES-REDBLEND-750', 'unidad', 750, 1),
  ('Las Perdices Malbec', 'Las Perdices Malbec 750cc', 'VINO-PERDICES-MALBEC-750', 'unidad', 750, 1),
  ('Patridge', 'Patridge 750cc', 'VINO-PATRIDGE-750', 'unidad', 750, 1),
  ('Colomé Malbec', 'Colomé Malbec 750cc', 'VINO-COLOME-MALBEC-750', 'unidad', 750, 1),
  ('Luigi Bosca Malbec', 'Luigi Bosca Malbec 750cc', 'VINO-LUIGIBOSCA-MALBEC-750', 'unidad', 750, 1),
  ('Santa Julia Syrah', 'Santa Julia Syrah 750cc', 'VINO-SANTAJULIA-SYRAH-750', 'unidad', 750, 1),
  ('Hippie Blue Pinot', 'Hippie Blue Pinot 750cc', 'VINO-HIPPIE-BLUEPINOT-750', 'unidad', 750, 1),
  ('Padrillo Pinot', 'Padrillo Pinot 750cc', 'VINO-PADRILLO-PINOT-750', 'unidad', 750, 1),
  ('Saint Felicien Pinot', 'Saint Felicien Pinot 750cc', 'VINO-SAINTFELICIEN-PINOT-750', 'unidad', 750, 1),
  ('Salentein Reserva Pinot', 'Salentein Reserva Pinot 750cc', 'VINO-SALENTEIN-RESERVAPINOT-750', 'unidad', 750, 1),
  ('Don David Pinot', 'Don David Pinot 750cc', 'VINO-DONDAVID-PINOT-750', 'unidad', 750, 1)
) as v(producto, nombre_sku, codigo, tipo, volumen, unidades)
join productos p on p.nombre = v.producto
  and p.categoria_id = (select id from categorias where nombre = 'Vinos');

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('VINO-ALAMBRADO-CAJA-3000', 13000),
  ('VINO-FAUSTO-X2', 54900),
  ('VINO-SINERGIA-3000', 18000),
  ('VINO-PERDICES-REDBLEND-3000', 29300),
  ('VINO-DONDAVID-CAJA-3000', 15000),
  ('VINO-SANFELIPE-CAJA-3000', 11500),
  ('VINO-PERDICES-CAJA-3000', 17000),
  ('VINO-FINCAGABRIEL-DULCE-750', 6100),
  ('VINO-COSECHATARDIA-DULCE-750', 5000),
  ('VINO-FINCAGABRIEL-DULCENATURAL-750', 5000),
  ('VINO-MOSQUITAMUERTA-3000', 75500),
  ('VINO-PRIVADO-750', 11550),
  ('VINO-CALLIA-MALBEC-750', 5300),
  ('VINO-UVASWEET-750', 3250),
  ('VINO-ALAMBRADO-CFRANC-750', 8600),
  ('VINO-SAINTFELICIEN-MALBEC-750', 12000),
  ('VINO-SANTAJULIA-CABSAUV-750', 5250),
  ('VINO-TONEL14-CABSAUV-750', 8150),
  ('VINO-SANTAJULIA-MALBEC-750', 5250),
  ('VINO-ALTOSLASHORMIGAS-750', 10000),
  ('VINO-AMPAKAMA-CABSAUV-750', 6900),
  ('VINO-ARISTIDES-750', 12000),
  ('VINO-ALZAMORA-MALBEC-750', 13200),
  ('VINO-CASAAGOSTINA-MALBEC-750', 4600),
  ('VINO-CONTRAVIENTO-BLENDTINTAS-750', 5000),
  ('VINO-LATITUD33-MALBEC-750', 7350),
  ('VINO-COCOLICHE-CABSAUV-750', 5000),
  ('VINO-DADA-MALBEC-750', 5400),
  ('VINO-LAMAQUINA-MALBEC-750', 7350),
  ('VINO-TUCUMAN-CABSAUV-750', 7000),
  ('VINO-CAFAYATE-MALBEC-750', 7350),
  ('VINO-KILLKA-MALBEC-750', 8250),
  ('VINO-SANTAJULIA-DULCE-750', 8100),
  ('VINO-ANIMAL-MALBEC-750', 14800),
  ('VINO-AMALAYA-MALBEC-750', 9250),
  ('VINO-PERROCALLEJERO-750', 7500),
  ('VINO-HITOS-MALBEC-750', 16100),
  ('VINO-EMILIA-CABERNET-750', 7400),
  ('VINO-PORTILLO-TINTO-750', 5600),
  ('VINO-FINCAGABRIEL-CABERNET-750', 6100),
  ('VINO-AGUIJONABEJA-OBRERA-750', 15450),
  ('VINO-AGUIJONABEJA-REINA-750', 18900),
  ('VINO-CORDERO-MALBEC-750', 5700),
  ('VINO-HORMIGANEGRA-750', 4350),
  ('VINO-PADRILLO-MALBEC-750', 14350),
  ('VINO-FINCALASMORAS-MALBEC-750', 6550),
  ('VINO-CIVIT757-750', 5100),
  ('VINO-ELBAUTISMO-750', 5500),
  ('VINO-ALMAMORA-TINTO-750', 5800),
  ('VINO-ABRASADO-CABERNET-750', 6000),
  ('VINO-FUEGO-NEGRO-750', 5800),
  ('VINO-TRUMPETER-RESERVA-750', 10900),
  ('VINO-ALMANEGRA-750', 25150),
  ('VINO-DVCATENA-MALBEC-750', 19300),
  ('VINO-RUTINI-MALBEC-750', 27600),
  ('VINO-RUTINI-CABMALBEC-750', 16000),
  ('VINO-FUEGO-BLANCOSYRAHMALBEC-750', 11600),
  ('VINO-PAJAROSARGENTINOS-750', 8700),
  ('VINO-DVCATENA-MALBECCAB-750', 13900),
  ('VINO-FABREMONTMAYOR-750', 18000),
  ('VINO-TRUMPETER-MALBEC-750', 8600),
  ('VINO-KILLKA-CORTETINTAS-750', 8250),
  ('VINO-MONTEAGRELO-750', 19850),
  ('VINO-PERDICES-RESERVA-750', 15900),
  ('VINO-PERDICES-REDBLEND-750', 15900),
  ('VINO-PERDICES-MALBEC-750', 9900),
  ('VINO-PATRIDGE-750', 6800),
  ('VINO-COLOME-MALBEC-750', 13800),
  ('VINO-LUIGIBOSCA-MALBEC-750', 14900),
  ('VINO-SANTAJULIA-SYRAH-750', 6400),
  ('VINO-HIPPIE-BLUEPINOT-750', 11100),
  ('VINO-PADRILLO-PINOT-750', 15800),
  ('VINO-SAINTFELICIEN-PINOT-750', 12000),
  ('VINO-SALENTEIN-RESERVAPINOT-750', 12850),
  ('VINO-DONDAVID-PINOT-750', 6900)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
