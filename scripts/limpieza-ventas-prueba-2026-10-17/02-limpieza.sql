-- =====================================================================
-- LIMPIEZA DE TODAS LAS VENTAS DE PRUEBA — UN SOLO USO
-- =====================================================================
--
-- Pedido del usuario 2026-10-17: borrar las 18 ventas de prueba que hay
-- en el sistema (08, 12, 14 y 16/10) y dejarlo listo para operar hoy.
--
-- ESTO NO ES UNA MIGRACIÓN. No va en supabase/migrations/ a propósito: es
-- el último reseteo antes de la puesta en marcha, se corre una vez y no se
-- vuelve a correr. A partir de hoy, borrar movimientos deja de ser
-- aceptable (CLAUDE.md regla 2: los movimientos son inmutables; para
-- corregir stock se genera un ajuste, no un DELETE).
--
-- OJO: el reseteo del 15/10 (scripts/limpieza-ventas-cajas/) NUNCA se
-- aplicó. Su README dice que el informe cerró, pero las 14 ventas del 08
-- al 14/10 siguen en la base: el `commit;` final no se llegó a escribir.
-- Por eso este script las incluye.
--
-- ---------------------------------------------------------------------
-- EL STOCK: NO SE REPONE TODO
-- ---------------------------------------------------------------------
-- Decisión del usuario 2026-10-17: "si tienen fecha de antes de anteayer
-- esas no reponen stock, solo las de ayer y anteayer reponen porque ya
-- estaba contado".
--
-- La razón técnica es exactamente esa, y está en
-- 20260929090000_carga_inicial_stock.sql: cargar_stock_inicial() no suma,
-- FIJA (`v_delta := p_cantidad - v_stock_actual`). Si un SKU quedó en -9
-- por una venta de prueba del 08/10 y después alguien contó 52 en la
-- góndola, la carga inicial escribió +61 para llegar a 52. El conteo YA
-- absorbió la venta falsa: reponer esos 9 dejaría 61 donde hay 52.
--
-- Pero el script NO decide por fecha, decide POR PRODUCTO: para cada
-- movimiento de venta se compara su fecha con la del último conteo de ese
-- SKU en esa sucursal.
--
--   ABSORBIDO  (la venta es anterior al conteo)
--              El stock de hoy ya es el número contado y no se toca. Lo
--              que se corrige es el movimiento de la carga inicial, que
--              deja de decir "+61" y pasa a decir "+52": exactamente lo
--              que se contó, como si la venta falsa nunca hubiera pasado.
--
--   PENDIENTE  (la venta es posterior al conteo, o el SKU nunca se contó)
--              La venta falsa todavía está restando del stock de hoy, así
--              que se devuelven las unidades.
--
-- En la práctica eso da lo que pidió el usuario —las viejas no reponen,
-- las de ayer sí— pero lo decide el dato y no el almanaque. Si entre las
-- viejas aparece un SKU que nunca se contó, se repone igual (si no, su
-- stock quedaría negativo sin ningún movimiento que lo explique), y si
-- alguno de ayer se contó después, no se repone. El informe del PASO 13
-- dice qué se hizo con cada uno.
--
-- POR QUÉ SE CORRIGE EL MOVIMIENTO DE LA CARGA INICIAL, y no se deja un
-- ajuste nuevo: un ajuste de -9 con motivo "corrección de prueba" dejaría
-- el primer día de operación real con un conteo de +61 que nadie contó
-- nunca. Corrigiendo el movimiento, el historial queda diciendo la
-- verdad: se contaron 52. Es editar historia, sí -- igual que borrar las
-- ventas. Es el último momento en que eso es aceptable.
--
-- ---------------------------------------------------------------------
-- LO QUE SE BORRA                      LO QUE NO SE TOCA
-- ---------------------------------------------------------------------
-- Las 18 ventas, sus items y pagos     Los 63 ajustes de la venta en
-- Devoluciones de esas ventas            papel del 15/10: esa mercadería
-- Los 3 comprobantes fiscales            salió de verdad del mostrador
--   (homologación)                     El conteo de la carga inicial:
-- Las 9 cajas, todas abiertas            7.398 unidades contadas a mano
-- Los movimientos de stock de esas     Catálogo, precios, promociones
--   ventas                             Compras y recepciones
-- ---------------------------------------------------------------------
--
-- El alcance es "todo lo anterior a HOY", no una lista de fechas: si
-- entre el diagnóstico y esto se hace una venta real, queda afuera sola.
--
-- ANTES DE CORRER: backup en Supabase (Database > Backups).
--
-- Todo corre en una transacción y termina con un informe, SIN commit. Si
-- el informe cierra, escribir `commit;`. Si no, `rollback;`.
-- =====================================================================

begin;

-- =====================================================================
-- PASO 1 — Alcance
-- =====================================================================

create temporary table _ventas on commit drop as
  select v.id
    from ventas v
   where (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date
         < (now() at time zone 'America/Argentina/Buenos_Aires')::date;

create temporary table _devoluciones on commit drop as
  select d.id from devoluciones d where d.venta_id in (select id from _ventas);

-- Los movimientos de stock que nacieron de esas ventas. Por documento y
-- no por tipo: la venta en papel del 15/10 son ajustes sin documento y no
-- pueden entrar acá ni por error.
create temporary table _movimientos on commit drop as
  select m.id, m.sku_id, m.sucursal_id, m.cantidad, m.fecha
    from movimientos_stock m
   where (m.documento_tipo = 'venta' and m.documento_id in (select id from _ventas))
      or (m.documento_tipo = 'devolucion' and m.documento_id in (select id from _devoluciones));

-- El último conteo de cada SKU: es el que fijó el stock que hay hoy.
create temporary table _conteos on commit drop as
  select distinct on (m.sku_id, m.sucursal_id)
         m.sku_id, m.sucursal_id, m.id as conteo_id, m.fecha as ultimo_conteo
    from movimientos_stock m
   where m.documento_tipo = 'carga_inicial'
   order by m.sku_id, m.sucursal_id, m.fecha desc;

-- Qué hacer con cada SKU: cuánto ya absorbió el conteo y cuánto sigue
-- restando del stock de hoy.
create temporary table _ajuste on commit drop as
  select
    mo.sku_id,
    mo.sucursal_id,
    c.conteo_id,
    sum(case when c.ultimo_conteo is not null and mo.fecha < c.ultimo_conteo
             then mo.cantidad else 0 end)                              as absorbido,
    sum(case when c.ultimo_conteo is null or mo.fecha >= c.ultimo_conteo
             then mo.cantidad else 0 end)                              as pendiente
  from _movimientos mo
  left join _conteos c on c.sku_id = mo.sku_id and c.sucursal_id = mo.sucursal_id
  -- conteo_id y ultimo_conteo dependen de (sku, sucursal): _conteos tiene
  -- una sola fila por par, asi que agrupar por ellos no cambia nada. Van
  -- al group by y no a un min(), que para uuid no existe en Postgres.
  group by mo.sku_id, mo.sucursal_id, c.conteo_id, c.ultimo_conteo;

create temporary table _envases on commit drop as
  select tipo_envase_id, sucursal_id, sum(cantidad) as neto
    from movimientos_envases
   where venta_id in (select id from _ventas)
   group by tipo_envase_id, sucursal_id;

-- Foto del antes, para que el informe se compare solo.
create temporary table _antes on commit drop as
  select
    (select count(*) from movimientos_stock
      where tipo = 'ajuste' and motivo like 'Venta en papel%')      as papel_movimientos,
    (select coalesce(sum(cantidad), 0) from movimientos_stock
      where tipo = 'ajuste' and motivo like 'Venta en papel%')      as papel_unidades,
    (select count(*) from movimientos_stock
      where documento_tipo = 'carga_inicial')                       as carga_inicial,
    (select coalesce(sum(cantidad), 0) from movimientos_stock
      where documento_tipo = 'carga_inicial')                       as carga_inicial_unidades,
    (select count(*) from stock_sucursal where cantidad < 0)        as negativos,
    (select coalesce(sum(cantidad), 0) from stock_sucursal)         as unidades,
    (select count(*) from skus where activo)                        as skus,
    (select count(*) from ventas)                                   as ventas,
    (select count(*) from _ventas)                                  as ventas_a_borrar,
    (select coalesce(sum(pendiente), 0) from _ajuste)               as pendiente_total,
    (select coalesce(sum(absorbido), 0) from _ajuste)               as absorbido_total;

-- =====================================================================
-- PASO 2 — Tripwire de facturación
-- =====================================================================
-- El diagnóstico del 2026-10-17 mostró 3 comprobantes, uno de ellos
-- Factura A nro 6, CAE 86421002366466, $10.000, AUTORIZADO. El
-- .env.local del proyecto tiene ARCA_ENTORNO=homologacion, así que ese
-- CAE no tiene valor fiscal y se borra sin consecuencias.
--
-- Borrar la fila local de una factura REAL no la anula en ARCA: para eso
-- va una nota de crédito. Por eso, si aparece algún comprobante
-- autorizado, hay que confirmarlo a mano acá abajo.
--
-- >>> Si confirmás que los comprobantes son de homologación, cambiá
-- >>> `false` por `true` en la línea siguiente. <<<

create temporary table _confirmo_homologacion on commit drop as select false as ok;

do $$
declare
  v_autorizados integer;
begin
  select count(*) into v_autorizados
    from comprobantes_fiscales cf
   where cf.venta_id in (select id from _ventas)
     and cf.estado = 'autorizado';

  if v_autorizados > 0 and not (select ok from _confirmo_homologacion) then
    raise exception
      'Hay % comprobante(s) AUTORIZADO(s) entre las ventas a borrar. Si son de homologacion, poné `select true as ok` en _confirmo_homologacion (PASO 2) y volvé a correr. Si alguno salio en produccion, no sigas: borrar la fila no anula la factura en ARCA.',
      v_autorizados;
  end if;
end $$;

-- =====================================================================
-- PASO 3 — Guardas antes de tocar nada
-- =====================================================================

do $$
declare
  v_faltan integer;
begin
  -- Si falta la fila de stock de algo que hay que reponer, el UPDATE del
  -- paso 8 no haría nada y el stock quedaría mal en silencio.
  select count(*) into v_faltan
    from _ajuste a
   where a.pendiente <> 0
     and not exists (
       select 1 from stock_sucursal ss
        where ss.sku_id = a.sku_id and ss.sucursal_id = a.sucursal_id
     );
  if v_faltan > 0 then
    raise exception 'Falta(n) % fila(s) de stock_sucursal para SKU a reponer. Rollback.', v_faltan;
  end if;

  -- No puede haber nada "absorbido" sin un conteo que lo haya absorbido.
  select count(*) into v_faltan from _ajuste where absorbido <> 0 and conteo_id is null;
  if v_faltan > 0 then
    raise exception 'Hay % SKU marcados como absorbidos sin movimiento de conteo. Rollback.', v_faltan;
  end if;
end $$;

-- =====================================================================
-- PASO 4 — Desactivar los bloqueos de escritura directa
-- =====================================================================
-- Solo las tablas que toca este script. Las claves foráneas siguen
-- activas a propósito: si el orden de borrado está mal, que explote en
-- vez de dejar huérfanos (por eso NO se usa session_replication_role).

alter table ventas                      disable trigger user;
alter table venta_items                 disable trigger user;
alter table venta_pagos                 disable trigger user;
alter table cajas                       disable trigger user;
alter table movimientos_caja            disable trigger user;
alter table devoluciones                disable trigger user;
alter table devolucion_items            disable trigger user;
alter table devolucion_cambio_items     disable trigger user;
alter table comprobantes_fiscales       disable trigger user;
alter table comprobantes_fiscales_items disable trigger user;
alter table movimientos_stock           disable trigger user;
alter table stock_sucursal              disable trigger user;
alter table movimientos_envases         disable trigger user;
alter table stock_envases               disable trigger user;

-- =====================================================================
-- PASO 5 — Comprobantes fiscales
-- =====================================================================

delete from comprobantes_fiscales_items
 where comprobante_id in (
   select id from comprobantes_fiscales where venta_id in (select id from _ventas)
 );

delete from comprobantes_fiscales where venta_id in (select id from _ventas);

-- El token de ARCA (arca_ta_cache) no se toca: no es un dato de negocio,
-- se renueva solo cada 12 horas.

-- =====================================================================
-- PASO 6 — Devoluciones
-- =====================================================================

delete from devolucion_cambio_items where devolucion_id in (select id from _devoluciones);
delete from devolucion_items        where devolucion_id in (select id from _devoluciones);
delete from devoluciones            where id in (select id from _devoluciones);

-- =====================================================================
-- PASO 7 — Las ventas
-- =====================================================================

delete from venta_pagos where venta_id in (select id from _ventas);
delete from venta_items where venta_id in (select id from _ventas);
delete from ventas      where id in (select id from _ventas);

-- =====================================================================
-- PASO 8 — Movimientos de stock, y el stock como corresponda
-- =====================================================================

delete from movimientos_stock where id in (select id from _movimientos);

-- 8a. PENDIENTE: la venta falsa todavía restaba. Se devuelven las
--     unidades (el neto es negativo, por eso se resta).
update stock_sucursal ss
   set cantidad = ss.cantidad - a.pendiente
  from _ajuste a
 where a.sku_id = ss.sku_id
   and a.sucursal_id = ss.sucursal_id
   and a.pendiente <> 0;

-- 8b. ABSORBIDO, caso borde primero: si corregir el conteo lo dejaría en
--     cero, ese SKU se contó exactamente lo que la venta falsa había
--     restado. El movimiento deja de tener sentido y hay que BORRARLO, no
--     actualizarlo: movimientos_stock tiene check (cantidad <> 0) y un
--     update a cero reventaría antes de llegar a ningún lado (los checks
--     no se desactivan con `disable trigger user`).
--
--     Para la invariante da lo mismo borrarlo que dejarlo en cero: en los
--     dos casos ese movimiento deja de sumar.
delete from movimientos_stock m
 using _ajuste a
 where m.id = a.conteo_id
   and a.absorbido <> 0
   and m.cantidad + a.absorbido = 0;

-- 8c. ABSORBIDO, caso normal: el conteo posterior ya había tapado la
--     venta falsa. El stock no se toca; se corrige el movimiento del
--     conteo para que diga lo que de verdad se contó. stock_posterior
--     queda igual, así que el check (stock_posterior = stock_anterior +
--     cantidad) sigue valiendo.
update movimientos_stock m
   set cantidad       = m.cantidad + a.absorbido,
       stock_anterior = m.stock_anterior - a.absorbido
  from _ajuste a
 where m.id = a.conteo_id
   and a.absorbido <> 0
   and m.cantidad + a.absorbido <> 0;

-- =====================================================================
-- PASO 9 — Envases vacíos que hubieran entrado por esas ventas
-- =====================================================================

delete from movimientos_envases where venta_id in (select id from _ventas);

update stock_envases se
   set cantidad_vacios = se.cantidad_vacios - e.neto
  from _envases e
 where e.tipo_envase_id = se.tipo_envase_id
   and e.sucursal_id = se.sucursal_id
   and e.neto <> 0;

-- =====================================================================
-- PASO 10 — Cajas
-- =====================================================================
-- Todas las anteriores a hoy, que son las 9 de prueba y están todas
-- abiertas. La de hoy, si llegara a existir, no se toca. Si alguna quedó
-- con ventas colgando después del paso 7, el alcance no era el que
-- creíamos y el script aborta.

do $$
declare
  v_con_ventas integer;
begin
  select count(*) into v_con_ventas
    from cajas c
   where c.fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date
     and exists (select 1 from ventas v where v.caja_id = c.id);

  if v_con_ventas > 0 then
    raise exception 'Quedaron % caja(s) viejas con ventas que no se borraron. Rollback.', v_con_ventas;
  end if;
end $$;

delete from movimientos_caja
 where caja_id in (
   select id from cajas
    where fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date
 );

delete from cajas
 where fecha < (now() at time zone 'America/Argentina/Buenos_Aires')::date;

-- =====================================================================
-- PASO 11 — Volver a prender los bloqueos
-- =====================================================================

alter table ventas                      enable trigger user;
alter table venta_items                 enable trigger user;
alter table venta_pagos                 enable trigger user;
alter table cajas                       enable trigger user;
alter table movimientos_caja            enable trigger user;
alter table devoluciones                enable trigger user;
alter table devolucion_items            enable trigger user;
alter table devolucion_cambio_items     enable trigger user;
alter table comprobantes_fiscales       enable trigger user;
alter table comprobantes_fiscales_items enable trigger user;
alter table movimientos_stock           enable trigger user;
alter table stock_sucursal              enable trigger user;
alter table movimientos_envases         enable trigger user;
alter table stock_envases               enable trigger user;

-- =====================================================================
-- PASO 12 — Auto-verificación: si algo no cierra, aborta
-- =====================================================================

do $$
declare
  a record;
  v_descuadrados integer;
  v_detalle text;
  v_negativos integer;
  v_quedan integer;
  v_papel integer;
  v_unidades bigint;
begin
  select * into a from _antes;

  -- 1. La invariante de la casa: el stock de cada SKU tiene que ser
  --    exactamente la suma de sus movimientos. Es lo que se puede romper
  --    al borrar y corregir historia, así que si no cierra, no se
  --    confirma nada.
  select count(*), string_agg(ss.sku_id::text || ' ' || ss.cantidad::text, ', ')
    into v_descuadrados, v_detalle
    from stock_sucursal ss
   where ss.cantidad <> coalesce((
           select sum(m.cantidad) from movimientos_stock m
            where m.sku_id = ss.sku_id and m.sucursal_id = ss.sucursal_id
         ), 0);

  if v_descuadrados > 0 then
    raise exception
      'Hay % fila(s) donde el stock no coincide con la suma de sus movimientos: %. Rollback.',
      v_descuadrados, left(v_detalle, 500);
  end if;

  -- 2. La venta en papel del 15/10, intacta: esa mercadería salió de
  --    verdad del mostrador.
  select count(*) into v_papel
    from movimientos_stock
   where tipo = 'ajuste' and motivo like 'Venta en papel%';

  if v_papel <> a.papel_movimientos then
    raise exception
      'Los ajustes de la venta en papel pasaron de % a %. No se tenían que tocar. Rollback.',
      a.papel_movimientos, v_papel;
  end if;

  -- 3. El stock total tiene que moverse EXACTAMENTE lo pendiente, ni una
  --    unidad más. Si se repuso de más, cae acá.
  select coalesce(sum(cantidad), 0) into v_unidades from stock_sucursal;
  if v_unidades <> a.unidades - a.pendiente_total then
    raise exception
      'El stock total quedó en % y tenía que quedar en % (antes % menos pendiente %). Rollback.',
      v_unidades, a.unidades - a.pendiente_total, a.unidades, a.pendiente_total;
  end if;

  -- 4. No puede quedar ninguna venta vieja.
  select count(*) into v_quedan
    from ventas v
   where (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date
         < (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  if v_quedan > 0 then
    raise exception 'Quedaron % venta(s) viejas sin borrar. Rollback.', v_quedan;
  end if;

  -- 5. Reponer solo suma: el stock negativo no puede haber crecido.
  select count(*) into v_negativos from stock_sucursal where cantidad < 0;
  if v_negativos > a.negativos then
    raise exception 'El stock negativo pasó de % a % filas. Rollback.', a.negativos, v_negativos;
  end if;

  raise notice 'Verificación OK: stock = suma de movimientos, venta en papel intacta, total exacto, sin ventas viejas, sin negativos nuevos.';
end $$;

-- =====================================================================
-- PASO 13 — Informe antes de confirmar
-- =====================================================================
-- Una sola consulta: el SQL Editor muestra solo el último resultado.
-- Arriba los totales, abajo el detalle de qué se hizo con cada SKU.

select * from (
            select 10 as orden, 'ventas borradas' as concepto,
                   (select ventas_a_borrar::text from _antes) as antes,
                   (select count(*)::text from ventas) as ahora,
                   'quedan solo las de hoy' as esperado
  union all select 11, 'cajas', '9',
                   (select count(*)::text from cajas), '0 (o la de hoy)'
  union all select 12, 'comprobantes fiscales', '3',
                   (select count(*)::text from comprobantes_fiscales), '0'
  union all select 13, 'movimientos de venta', '—',
                   (select count(*)::text from movimientos_stock where documento_tipo = 'venta'), '0'

  union all select 20, 'UNIDADES EN STOCK',
                   (select unidades::text from _antes),
                   (select coalesce(sum(cantidad), 0)::text from stock_sucursal),
                   (select (unidades - pendiente_total)::text from _antes)
  union all select 21, 'unidades repuestas (pendiente)', '—',
                   (select (-pendiente_total)::text from _antes), 'se sumaron al stock'
  union all select 22, 'unidades que ya absorbió el conteo', '—',
                   (select (-absorbido_total)::text from _antes), 'NO se repusieron'
  union all select 23, 'filas con stock negativo',
                   (select negativos::text from _antes),
                   (select count(*)::text from stock_sucursal where cantidad < 0),
                   'igual o menos'
  union all select 24, 'stock <> suma de movimientos', '—',
                   (select count(*)::text from stock_sucursal ss
                     where ss.cantidad <> coalesce((
                       select sum(m.cantidad) from movimientos_stock m
                        where m.sku_id = ss.sku_id and m.sucursal_id = ss.sucursal_id), 0)),
                   '0'

  union all select 30, 'ajustes de la venta en papel',
                   (select papel_movimientos::text from _antes),
                   (select count(*)::text from movimientos_stock
                     where tipo = 'ajuste' and motivo like 'Venta en papel%'),
                   'igual que antes'
  union all select 31, 'movimientos de carga inicial',
                   (select carga_inicial::text from _antes),
                   (select count(*)::text from movimientos_stock where documento_tipo = 'carga_inicial'),
                   'igual, salvo los que quedaron en cero'
  union all select 32, 'unidades de la carga inicial',
                   (select carga_inicial_unidades::text from _antes),
                   (select coalesce(sum(cantidad), 0)::text from movimientos_stock
                     where documento_tipo = 'carga_inicial'),
                   (select (carga_inicial_unidades + absorbido_total)::text from _antes)
  union all select 33, 'SKU activos',
                   (select skus::text from _antes),
                   (select count(*)::text from skus where activo),
                   'igual que antes'

  -- Detalle: qué se hizo con cada producto tocado.
  union all
  select 40,
         'DETALLE · ' || sk.codigo_interno || ' · ' || s.nombre,
         case when a.pendiente <> 0 then 'repuesto +' || (-a.pendiente)::text else '' end
           || case when a.pendiente <> 0 and a.absorbido <> 0 then ' · ' else '' end
           || case when a.absorbido <> 0 then 'absorbido ' || (-a.absorbido)::text else '' end,
         coalesce(ss.cantidad, 0)::text,
         case when a.absorbido <> 0 then 'conteo corregido' else 'stock devuelto' end
    from _ajuste a
    join skus sk      on sk.id = a.sku_id
    join sucursales s on s.id = a.sucursal_id
    left join stock_sucursal ss on ss.sku_id = a.sku_id and ss.sucursal_id = a.sucursal_id
) t order by orden, concepto;

-- =====================================================================
-- Si el informe cierra:   commit;
-- Si algo no cierra:      rollback;
--
-- Nada queda aplicado hasta que escribas uno de los dos.
-- =====================================================================
