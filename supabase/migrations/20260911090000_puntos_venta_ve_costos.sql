-- Amplía quién puede configurar el punto de venta ARCA: antes solo el
-- dueño (es_dueno(), decisión de implementación #2 de
-- 20260906090000_arca_facturacion.sql), ahora también el encargado de
-- Olavarría (ve_costos()) -- pedido directo del dueño: la encargada tiene
-- que poder cargar/corregir el número de punto de venta ella misma, no
-- depender de que él entre a hacerlo. Mismo criterio que ya usa
-- condicion_iva (ve_costos() desde el principio) y pedidos_compra.
--
-- select ya era ve_costos(), no cambia. Solo insert/update/delete.

alter policy puntos_venta_insert on puntos_venta with check (ve_costos());
alter policy puntos_venta_update on puntos_venta using (ve_costos()) with check (ve_costos());
alter policy puntos_venta_delete on puntos_venta using (ve_costos());
