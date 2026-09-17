-- Carga real de precios de Laprida — categoría FERNET (primera tanda de
-- la lista de precios de Laprida, 12/09/26).
--
-- Decisión confirmada con el usuario: para categorías que ya existen en
-- Olavarría, cada precio de esta lista se carga como excepción manual
-- (precios_sucursal.precio_override) en vez de calcular un recargo por
-- categoría — el override gana siempre sobre precio base/recargo/cascada
-- (lib/precios.ts), así que funciona igual si Olavarría todavía no tiene
-- precio cargado para ese SKU (ej. Fernet Branca 450cc).
--
-- Nota: usa upsert (on conflict) porque al menos un SKU (Fernet 1882) ya
-- tenía una excepción manual cargada de antes en Laprida (parece un valor
-- de prueba de una encargada) -- esta lista real la pisa.
--
-- Pendiente / no cargado en esta tanda (para no adivinar):
--   1. "Fernet Buhero 700 ml — $8.850": el SKU existente es "Fernet Buhero
--      Negro 750cc" (750, no 700). No sé si es el mismo producto con un
--      error de transcripción en la lista, o si Laprida vende una
--      presentación de 700cc que no existe en el catálogo. Necesito que
--      me confirmes antes de cargarlo.
--   2. "Cestari — $15.000": marca/producto nuevo, no existe en Olavarría
--      y la lista no aclara la presentación (¿750cc? ¿litro?). Necesito
--      el dato antes de darlo de alta.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('FERNET-BRANCA-1000', 23850),
  ('FERNET-BRANCA-750', 18850),
  ('FERNET-BRANCA-450', 11900),
  ('FERNET-1882-750', 9050),
  ('FERNET-777-750', 9800)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
