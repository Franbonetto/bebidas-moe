-- Verificación después del commit de 02-limpieza.sql.
--
-- SOLO LECTURA. Correr bloque por bloque. Los cuatro primeros tienen que
-- dar cero filas o decir OK; si alguno da algo distinto, avisame antes de
-- seguir cargando productos.

-- =========================================================
-- 1) No quedó ningún trigger apagado
-- =========================================================
-- Es la verificación más importante. La limpieza apaga 24 triggers (los
-- *_bloquear_escritura_directa, que garantizan que nadie toque el stock
-- sin dejar movimiento, y los *_validar_edicion de pedido_items,
-- compra_items y recepcion_items) y los vuelve a prender al final.
--
-- Esta consulta tiene que dar CERO FILAS. Si aparece algo, ese trigger
-- quedó apagado y hay que prenderlo:
--     alter table <tabla> enable trigger user;

select
  c.relname as tabla,
  t.tgname  as trigger_apagado
from pg_trigger t
join pg_class c     on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and t.tgenabled <> 'O'
order by c.relname, t.tgname;

-- Contraprueba: cuántos triggers propios hay prendidos en las tablas que
-- toca la limpieza. Tienen que ser 24 en 23 tablas.

select count(*) as triggers_prendidos, count(distinct c.relname) as tablas
from pg_trigger t
join pg_class c     on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and t.tgenabled = 'O'
  and (t.tgname like '%_bloquear_escritura_directa'
       or t.tgname in ('pedido_items_validar_edicion',
                       'compra_items_validar_edicion',
                       'recepcion_items_validar_edicion'));

-- =========================================================
-- 2) El stock coincide con la suma de los movimientos
-- =========================================================
-- Tiene que dar 0 filas. Si aparece algo, el stock quedó diciendo una
-- cantidad que ningún movimiento respalda.

select
  s.codigo_interno,
  p.nombre as producto,
  su.nombre as sucursal,
  ss.cantidad as dice_el_stock,
  coalesce(m.suma, 0) as suman_los_movimientos
from stock_sucursal ss
join skus s       on s.id = ss.sku_id
join productos p  on p.id = s.producto_id
join sucursales su on su.id = ss.sucursal_id
left join (
  select sku_id, sucursal_id, sum(cantidad) as suma
    from movimientos_stock
   group by sku_id, sucursal_id
) m on m.sku_id = ss.sku_id and m.sucursal_id = ss.sucursal_id
where ss.cantidad <> coalesce(m.suma, 0);

-- =========================================================
-- 3) No quedaron huérfanos
-- =========================================================
-- Tiene que dar 0 filas en todas las categorías.

select 'venta_items sin venta' as problema, count(*) as filas
  from venta_items vi where not exists (select 1 from ventas v where v.id = vi.venta_id)
union all
select 'movimientos de venta sin venta', count(*)
  from movimientos_stock m
 where m.documento_tipo = 'venta'
   and not exists (select 1 from ventas v where v.id = m.documento_id)
union all
select 'movimientos de recepción sin recepción', count(*)
  from movimientos_stock m
 where m.documento_tipo = 'recepcion_compra'
   and not exists (select 1 from recepciones_compra r where r.id = m.documento_id)
union all
select 'movimientos de inventario sin inventario', count(*)
  from movimientos_stock m
 where m.documento_tipo = 'inventario'
   and not exists (select 1 from inventarios i where i.id = m.documento_id)
union all
select 'movimientos de carga inicial sin carga', count(*)
  from movimientos_stock m
 where m.documento_tipo = 'carga_inicial'
   and not exists (select 1 from cargas_iniciales ci where ci.id = m.documento_id)
union all
select 'precios de SKU inexistente', count(*)
  from precios pr where not exists (select 1 from skus s where s.id = pr.sku_id)
union all
-- Stock colgado de un SKU que ya no está en el catálogo: mercadería que
-- existe para el sistema pero que nadie puede ver ni vender.
select 'stock <> 0 en un SKU dado de baja', count(*)
  from stock_sucursal ss
  join skus s on s.id = ss.sku_id
 where not s.activo and ss.cantidad <> 0;

-- Nota: que un SKU activo no tenga fila en stock_sucursal NO es un
-- problema. La fila la crea el primer movimiento (registrar_movimiento,
-- bloque 3), así que un SKU recién codificado y todavía sin contar no
-- tiene fila. Es lo esperable en este momento.

-- =========================================================
-- 4) SKU que siguen dados de baja y por qué
-- =========================================================
-- Si quedó alguno, es porque una compra real lo referencia. No es un
-- error: está fuera del catálogo y del punto de venta igual.

select
  s.codigo_interno,
  p.nombre as producto,
  s.nombre as sku,
  (select count(*) from compra_items ci where ci.sku_id = s.id)    as en_compras,
  (select count(*) from recepcion_items ri where ri.sku_id = s.id) as en_recepciones,
  (select count(*) from historial_costos h where h.sku_id = s.id)  as en_costos,
  (select count(*) from movimientos_stock m where m.sku_id = s.id) as movimientos
from skus s
join productos p on p.id = s.producto_id
where not s.activo
order by p.nombre, s.nombre;

-- =========================================================
-- 5) Cómo quedó el catálogo para seguir cargando
-- =========================================================
-- El avance real por categoría: cuántos SKU tenés codificados, cuántos con
-- código de barras y cuántos con precio.

select
  coalesce(cp.nombre || ' > ', '') || c.nombre as categoria,
  count(*)                             as skus,
  count(s.codigo_barras)               as con_codigo_barras,
  count(pr.sku_id)                     as con_precio_base,
  count(s.costo_actual)                as con_costo,
  sum(case when s.stock_objetivo > 0 then 1 else 0 end) as con_stock_objetivo
from skus s
join productos p   on p.id = s.producto_id
join categorias c  on c.id = p.categoria_id
left join categorias cp on cp.id = c.categoria_padre_id
left join precios pr    on pr.sku_id = s.id
where s.activo
group by 1
order by 1;
