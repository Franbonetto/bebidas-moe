-- Carga de proveedores reales — solo razón social por ahora. El cliente
-- pide por WhatsApp con relación directa ya establecida, no le interesa
-- cargar CUIT/contacto/condición de pago todavía. El resto de las columnas
-- de proveedores son opcionales (bloque4_compras.sql: solo razon_social
-- es obligatorio) y se pueden completar más adelante sin tocar esto.

begin;

insert into proveedores (razon_social) values
  ('Provanza'),
  ('Districen'),
  ('Blue Marcket/Olalac'),
  ('The Mula'),
  ('Capital'),
  ('Espora'),
  ('Quilmes'),
  ('Cristalería'),
  ('Cagnoli'),
  ('Lays'),
  ('Lube Quesos'),
  ('Laur Aceites'),
  ('Branca'),
  ('Coca-Cola'),
  ('Speed/Marley'),
  ('Mendoza');

commit;
