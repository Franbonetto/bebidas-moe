-- Tests bloque 4: proveedores, compras, recepciones, historial_costos y
-- confirmar_recepcion(). Mismo formato que bloque3_stock.sql: SQL plano,
-- cada caso es un DO block que revienta con RAISE EXCEPTION si el assert
-- falla, todo en una transaccion que termina en ROLLBACK.
--
-- Correr con psql contra una base con los bloques 1 a 4 ya migrados:
--
--   psql <conexion> -f supabase/tests/bloque4_compras.sql
--
-- Requiere conexion con privilegios de superusuario/dueño de tablas (el
-- caso 1 compara el bloqueo entre authenticated y ese rol, igual que en
-- bloque3).

\set ON_ERROR_STOP on

begin;

-- =========================================================
-- Setup: usuario de test + proveedor + contexto de auth simulado
-- =========================================================

create temporary table _test_ctx (usuario_id uuid, olavarria_id uuid, proveedor_id uuid);

do $$
declare
  v_usuario_id uuid := gen_random_uuid();
  v_olavarria_id uuid;
  v_proveedor_id uuid;
begin
  select id into v_olavarria_id from sucursales where nombre = 'Olavarría';
  if v_olavarria_id is null then
    raise exception 'FALLO: no se encontro la sucursal Olavarria (¿corriste el bloque 1?)';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) values (
    '00000000-0000-0000-0000-000000000000', v_usuario_id, 'authenticated', 'authenticated',
    'test-bloque4@bebidasmoe.local', 'test-not-a-real-hash',
    now(), now(), now(),
    '', '', '', '',
    '{}', '{}', false
  );

  insert into usuarios (id, nombre, email, rol, activo)
  values (v_usuario_id, 'Test Bloque 4', 'test-bloque4@bebidasmoe.local', 'dueno', true);

  insert into proveedores (razon_social, nombre_comercial, cuit)
  values ('Distribuidora Test SA', 'Distest', '30-11111111-1')
  returning id into v_proveedor_id;

  insert into _test_ctx values (v_usuario_id, v_olavarria_id, v_proveedor_id);
end $$;

set local role authenticated;

do $$
declare
  v_usuario_id uuid;
begin
  select usuario_id into v_usuario_id from _test_ctx;
  perform set_config('request.jwt.claim.sub', v_usuario_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

-- =========================================================
-- Caso 1: historial_costos es inmutable y no se inserta directo
-- =========================================================

do $$
declare
  v_sku_id uuid;
  v_proveedor_id uuid;
  v_sucursal_id uuid;
  v_usuario_id uuid;
  v_compra_id uuid;
  v_recepcion_id uuid;
begin
  select id into v_sku_id from skus where codigo_interno = 'GORDONS-LD-750';
  select proveedor_id, olavarria_id, usuario_id
    into v_proveedor_id, v_sucursal_id, v_usuario_id
    from _test_ctx;

  -- recepcion real y pendiente, para que el insert de abajo falle por el
  -- trigger de bloqueo y no por una FK a un recepcion_id inventado.
  insert into compras (proveedor_id, sucursal_destino_id, usuario_id)
  values (v_proveedor_id, v_sucursal_id, v_usuario_id)
  returning id into v_compra_id;

  insert into compra_items (compra_id, sku_id, cantidad, costo_unitario)
  values (v_compra_id, v_sku_id, 1, 100);

  update compras set estado = 'confirmada' where id = v_compra_id;

  insert into recepciones_compra (compra_id, usuario_id)
  values (v_compra_id, v_usuario_id)
  returning id into v_recepcion_id;

  begin
    insert into historial_costos (sku_id, proveedor_id, recepcion_id, costo_unitario, cantidad)
    values (v_sku_id, v_proveedor_id, v_recepcion_id, 100, 1);
    raise exception 'FALLO: se pudo insertar historial_costos directo, sin pasar por confirmar_recepcion()';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: insert directo a historial_costos bloqueado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 2: compra_items solo se edita mientras la compra es borrador; una
-- compra sin items no se puede confirmar.
-- =========================================================

do $$
declare
  v_compra_id uuid;
  v_sucursal_id uuid;
  v_usuario_id uuid;
begin
  select olavarria_id, usuario_id into v_sucursal_id, v_usuario_id from _test_ctx;

  insert into compras (proveedor_id, sucursal_destino_id, usuario_id)
  values ((select proveedor_id from _test_ctx), v_sucursal_id, v_usuario_id)
  returning id into v_compra_id;

  begin
    update compras set estado = 'confirmada' where id = v_compra_id;
    raise exception 'FALLO: se pudo confirmar una compra sin items';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: no se puede confirmar una compra vacia (%)', sqlerrm;
  end;

  insert into compra_items (compra_id, sku_id, cantidad, costo_unitario)
  values (v_compra_id, (select id from skus where codigo_interno = 'GORDONS-LD-750'), 10, 1500);

  update compras set estado = 'confirmada' where id = v_compra_id;

  begin
    insert into compra_items (compra_id, sku_id, cantidad, costo_unitario)
    values (v_compra_id, (select id from skus where codigo_interno = 'GORDONS-PINK-700'), 5, 1200);
    raise exception 'FALLO: se pudo agregar un item a una compra ya confirmada';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: compra_items bloqueado tras confirmar (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 3: flujo completo con una sola recepcion -> cierra la compra sola,
-- mueve stock, guarda el lote y actualiza costo_actual.
-- =========================================================

do $$
declare
  v_compra_id uuid;
  v_recepcion_id uuid;
  v_sku_id uuid;
  v_sucursal_id uuid;
  v_usuario_id uuid;
  v_stock_antes integer;
  v_stock_despues integer;
  v_estado_compra text;
  v_costo_actual numeric;
  v_lotes integer;
begin
  select olavarria_id, usuario_id into v_sucursal_id, v_usuario_id from _test_ctx;
  select id into v_sku_id from skus where codigo_interno = 'BRANCA-750';

  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id), 0
  ) into v_stock_antes;

  insert into compras (proveedor_id, sucursal_destino_id, usuario_id)
  values ((select proveedor_id from _test_ctx), v_sucursal_id, v_usuario_id)
  returning id into v_compra_id;

  insert into compra_items (compra_id, sku_id, cantidad, costo_unitario)
  values (v_compra_id, v_sku_id, 24, 3000);

  if (select total from compras where id = v_compra_id) <> 24 * 3000 then
    raise exception 'FALLO: el total de la compra no se recalculo bien (esperado %, quedo %)',
      24 * 3000, (select total from compras where id = v_compra_id);
  end if;

  update compras set estado = 'confirmada' where id = v_compra_id;

  insert into recepciones_compra (compra_id, usuario_id)
  values (v_compra_id, v_usuario_id)
  returning id into v_recepcion_id;

  insert into recepcion_items (recepcion_id, compra_item_id, sku_id, cantidad_recibida)
  values (
    v_recepcion_id,
    (select id from compra_items where compra_id = v_compra_id and sku_id = v_sku_id),
    v_sku_id, 24
  );

  perform confirmar_recepcion(v_recepcion_id);

  select cantidad into v_stock_despues
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id;

  if v_stock_despues <> v_stock_antes + 24 then
    raise exception 'FALLO: stock deberia subir 24 (% -> %) y quedo en %',
      v_stock_antes, v_stock_antes + 24, v_stock_despues;
  end if;

  select estado into v_estado_compra from compras where id = v_compra_id;
  if v_estado_compra <> 'cerrada' then
    raise exception 'FALLO: la compra deberia cerrarse sola al recibirse todo y quedo en %', v_estado_compra;
  end if;

  select costo_actual into v_costo_actual from skus where id = v_sku_id;
  if v_costo_actual <> 3000 then
    raise exception 'FALLO: costo_actual deberia ser 3000 y quedo en %', v_costo_actual;
  end if;

  select count(*) into v_lotes from historial_costos where recepcion_id = v_recepcion_id;
  if v_lotes <> 1 then
    raise exception 'FALLO: deberia haber 1 lote en historial_costos y hay %', v_lotes;
  end if;

  if (select diferencia from recepcion_items where recepcion_id = v_recepcion_id) <> 0 then
    raise exception 'FALLO: no deberia haber diferencia en una recepcion completa';
  end if;

  raise notice 'OK: flujo completo (compra -> recepcion -> cierre automatico) consistente';
end $$;

-- =========================================================
-- Caso 4: recepcion parcial exige motivo si hay diferencia, no cierra la
-- compra hasta que una segunda recepcion cubre el resto.
-- =========================================================

do $$
declare
  v_compra_id uuid;
  v_recepcion1_id uuid;
  v_recepcion2_id uuid;
  v_compra_item_id uuid;
  v_sku_id uuid;
  v_sucursal_id uuid;
  v_usuario_id uuid;
  v_estado_compra text;
  v_stock_despues integer;
begin
  select olavarria_id, usuario_id into v_sucursal_id, v_usuario_id from _test_ctx;
  select id into v_sku_id from skus where codigo_interno = 'GORDONS-PINK-700';

  insert into compras (proveedor_id, sucursal_destino_id, usuario_id)
  values ((select proveedor_id from _test_ctx), v_sucursal_id, v_usuario_id)
  returning id into v_compra_id;

  insert into compra_items (compra_id, sku_id, cantidad, costo_unitario)
  values (v_compra_id, v_sku_id, 10, 2000)
  returning id into v_compra_item_id;

  update compras set estado = 'confirmada' where id = v_compra_id;

  -- primera tanda: llegan 6 de 10, sin motivo -> confirmar_recepcion debe rechazar.
  insert into recepciones_compra (compra_id, usuario_id)
  values (v_compra_id, v_usuario_id)
  returning id into v_recepcion1_id;

  insert into recepcion_items (recepcion_id, compra_item_id, sku_id, cantidad_recibida)
  values (v_recepcion1_id, v_compra_item_id, v_sku_id, 6);

  begin
    perform confirmar_recepcion(v_recepcion1_id);
    raise exception 'FALLO: confirmar_recepcion acepto una diferencia sin motivo_diferencia';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: diferencia sin motivo rechazada (%)', sqlerrm;
  end;

  update recepcion_items set motivo_diferencia = 'entrega parcial del proveedor'
  where recepcion_id = v_recepcion1_id;

  perform confirmar_recepcion(v_recepcion1_id);

  if (select diferencia from recepcion_items where recepcion_id = v_recepcion1_id) <> -4 then
    raise exception 'FALLO: la diferencia deberia ser -4 (faltan 4 de 10) y quedo en %',
      (select diferencia from recepcion_items where recepcion_id = v_recepcion1_id);
  end if;

  select estado into v_estado_compra from compras where id = v_compra_id;
  if v_estado_compra <> 'confirmada' then
    raise exception 'FALLO: la compra no deberia cerrarse con una tanda pendiente y quedo en %', v_estado_compra;
  end if;

  -- segunda tanda: llegan los 4 restantes -> ahora si cierra.
  insert into recepciones_compra (compra_id, usuario_id)
  values (v_compra_id, v_usuario_id)
  returning id into v_recepcion2_id;

  insert into recepcion_items (recepcion_id, compra_item_id, sku_id, cantidad_recibida)
  values (v_recepcion2_id, v_compra_item_id, v_sku_id, 4);

  perform confirmar_recepcion(v_recepcion2_id);

  if (select diferencia from recepcion_items where recepcion_id = v_recepcion2_id) <> 0 then
    raise exception 'FALLO: la segunda tanda completa el pedido, la diferencia deberia ser 0';
  end if;

  select estado into v_estado_compra from compras where id = v_compra_id;
  if v_estado_compra <> 'cerrada' then
    raise exception 'FALLO: la compra deberia cerrarse al completar la segunda tanda y quedo en %', v_estado_compra;
  end if;

  select cantidad into v_stock_despues
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id;
  if v_stock_despues <> 10 then
    raise exception 'FALLO: stock final deberia ser 10 (6 + 4) y quedo en %', v_stock_despues;
  end if;

  raise notice 'OK: recepcion en dos tandas calcula diferencias y cierra al completarse';
end $$;

-- =========================================================
-- Caso 5: no se puede crear una recepcion para una compra en borrador
-- =========================================================

do $$
declare
  v_compra_id uuid;
  v_sucursal_id uuid;
  v_usuario_id uuid;
begin
  select olavarria_id, usuario_id into v_sucursal_id, v_usuario_id from _test_ctx;

  insert into compras (proveedor_id, sucursal_destino_id, usuario_id)
  values ((select proveedor_id from _test_ctx), v_sucursal_id, v_usuario_id)
  returning id into v_compra_id;

  begin
    insert into recepciones_compra (compra_id, usuario_id) values (v_compra_id, v_usuario_id);
    raise exception 'FALLO: se pudo crear una recepcion sobre una compra en borrador';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: recepcion sobre compra en borrador rechazada (%)', sqlerrm;
  end;
end $$;

-- No se hace commit a proposito: el test no deja rastro en la base.
rollback;
