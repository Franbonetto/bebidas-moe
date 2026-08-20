-- Grants faltantes de los bloques 1, 2 y 3.
--
-- Estos grants se venian corriendo a mano contra el proyecto de Supabase
-- despues de cada migracion (siguiendo la nota de entorno de CLAUDE.md)
-- pero nunca quedaron versionados. Un paso manual que no esta en el codigo
-- es exactamente lo que rompe cuando se levanta el proyecto en otro lado
-- (supabase db reset, un ambiente nuevo) y nadie se acuerda por que falla
-- 403 con las politicas de RLS bien escritas.
--
-- Mismo criterio que en el bloque 4: grant de una operacion solo si la
-- tabla tiene una politica de RLS para esa operacion para authenticated.
-- select ya queda cubierto por el "grant select on all tables in schema
-- public" del bloque 4, pero se repite aca para que esta migracion sea
-- autocontenida y no dependa del orden en que se corran las demas.

-- Bloque 1: usuarios, sucursales, usuario_sucursal.
-- Las tres tienen politicas de insert/update/delete restringidas a
-- es_dueno() (20260820120000_bloque1_usuarios_sucursales_permisos.sql).

grant select, insert, update, delete on sucursales to authenticated;
grant select, insert, update, delete on usuarios to authenticated;
grant select, insert, update, delete on usuario_sucursal to authenticated;

-- Bloque 2: catalogo.
-- Las cinco tienen politicas de insert/update/delete restringidas a
-- ve_costos() (20260820130000_bloque2_catalogo.sql).

grant select, insert, update, delete on marcas to authenticated;
grant select, insert, update, delete on categorias to authenticated;
grant select, insert, update, delete on productos to authenticated;
grant select, insert, update, delete on tipos_envase to authenticated;
grant select, insert, update, delete on skus to authenticated;

-- Bloque 3: nucleo de stock.
-- stock_sucursal y movimientos_stock NO tienen politica de insert/update/
-- delete para authenticated: la unica escritura es via
-- registrar_movimiento() / desarmar_sku(), SECURITY DEFINER, que corre
-- como dueño de la tabla y no necesita estos grants. Solo select.

grant select on stock_sucursal to authenticated;
grant select on movimientos_stock to authenticated;
