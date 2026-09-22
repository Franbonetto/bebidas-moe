-- El dueño solo visualiza los pedidos de compra y su historial -- los arma
-- la encargada de Olavarría, el dueño no crea/edita/borra ninguno (pedido
-- del usuario 2026-09-22: "no quiero que pueda hacer un pedido de compra...
-- solo tiene que recibir lo que le manda la encargada"). Hasta ahora
-- ve_costos() (dueño + encargado de Olavarría) podía escribir esta tabla
-- por igual; se restringe insert/update/delete a "ve_costos() y no dueño".
-- select queda igual (el dueño sigue viendo todo).

begin;

drop policy if exists pedidos_compra_insert on pedidos_compra;
drop policy if exists pedidos_compra_update on pedidos_compra;
drop policy if exists pedidos_compra_delete on pedidos_compra;

create policy pedidos_compra_insert on pedidos_compra
  for insert with check (ve_costos() and not es_dueno());
create policy pedidos_compra_update on pedidos_compra
  for update using (ve_costos() and not es_dueno()) with check (ve_costos() and not es_dueno());
create policy pedidos_compra_delete on pedidos_compra
  for delete using (ve_costos() and not es_dueno());

drop policy if exists pedidos_compra_items_insert on pedidos_compra_items;
drop policy if exists pedidos_compra_items_update on pedidos_compra_items;
drop policy if exists pedidos_compra_items_delete on pedidos_compra_items;

create policy pedidos_compra_items_insert on pedidos_compra_items
  for insert with check (ve_costos() and not es_dueno());
create policy pedidos_compra_items_update on pedidos_compra_items
  for update using (ve_costos() and not es_dueno()) with check (ve_costos() and not es_dueno());
create policy pedidos_compra_items_delete on pedidos_compra_items
  for delete using (ve_costos() and not es_dueno());

commit;
