-- Pedido de compra de Olavarría: proveedor y nota por línea (pedido del
-- usuario 2026-11-10).
--
-- La empleada que arma el pedido semanal elige, producto por producto, a qué
-- proveedor se le pide y puede dejar una nota ("en promo", "el de la botella
-- chica"). Así el dueño ve el pedido ya agrupado por proveedor, que es como
-- después compra. Antes el proveedor no se guardaba: el detalle lo deducía
-- de proveedor_skus y un SKU con varios proveedores aparecía repetido en
-- todos.
--
-- Las dos columnas son opcionales: los pedidos viejos quedan como estaban y
-- el detalle sigue deduciendo el proveedor para ellos.
--
-- No crea tablas: los permisos de pedidos_compra_items (select/insert/
-- update/delete para authenticated, con RLS por ve_costos()) ya cubren las
-- columnas nuevas.

alter table pedidos_compra_items
  add column proveedor_id uuid references proveedores (id),
  add column nota text;

comment on column pedidos_compra_items.proveedor_id is
  'Proveedor al que se le pide esta línea, elegido por quien armó el pedido. NULL = no se eligió (pedidos viejos o sin proveedor).';
comment on column pedidos_compra_items.nota is
  'Nota libre de quien armó el pedido sobre esta línea.';

create index pedidos_compra_items_proveedor_id_idx on pedidos_compra_items (proveedor_id);
