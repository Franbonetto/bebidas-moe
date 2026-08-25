-- Tests bloque 8: inventarios fisicos (general, por categoria, puntual).
-- Mismo formato que bloque3_stock.sql, bloque4_compras.sql y
-- bloque7_pedidos.sql: SQL plano, cada caso es un DO block que revienta con
-- RAISE EXCEPTION si el assert falla, todo en una transaccion que termina
-- en ROLLBACK.
--
-- Correr con psql contra una base con los bloques 1 a 8 ya migrados:
--
--   psql <conexion> -f supabase/tests/bloque8_inventarios.sql
--
-- Requiere conexion con privilegios de superusuario/dueño de tablas.
--
-- El caso 1 es el que mas importa: circuito completo (iniciar -> contar con
-- una diferencia -> confirmar rechazado sin motivo -> confirmar con motivo)
-- y que el inventario cerrado quede inmutable.

\set ON_ERROR_STOP on

begin;

-- =========================================================
-- Setup: usuario de test (dueño, opera las dos sucursales) + contexto de
-- auth simulado. Mismo patron que bloque7_pedidos.sql.
-- =========================================================

create temporary table _test_ctx (usuario_id uuid, olavarria_id uuid, laprida_id uuid);

do $$
declare
  v_usuario_id uuid := gen_random_uuid();
  v_olavarria_id uuid;
  v_laprida_id uuid;
begin
  select id into v_olavarria_id from sucursales where nombre = 'Olavarría';
  select id into v_laprida_id from sucursales where nombre = 'Laprida';
  if v_olavarria_id is null or v_laprida_id is null then
    raise exception 'FALLO: no se encontraron las sucursales (¿corriste el bloque 1?)';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) values (
    '00000000-0000-0000-0000-000000000000', v_usuario_id, 'authenticated', 'authenticated',
    'test-bloque8@bebidasmoe.local', 'test-not-a-real-hash',
    now(), now(), now(),
    '', '', '', '',
    '{}', '{}', false
  );

  insert into usuarios (id, nombre, email, rol, activo)
  values (v_usuario_id, 'Test Bloque 8', 'test-bloque8@bebidasmoe.local', 'dueno', true);

  insert into _test_ctx values (v_usuario_id, v_olavarria_id, v_laprida_id);
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
-- Caso 1: circuito completo de un inventario general -- foto al iniciar,
-- conteo con una diferencia, confirmar rechazado sin conteo completo,
-- rechazado sin motivo, aceptado con motivo, y verificacion de que el
-- ajuste y el stock quedan bien. Despues, inmutabilidad: nada se puede
-- tocar una vez cerrado.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_usuario_id uuid;
  v_branca_id uuid;
  v_inventario inventarios;
  v_total_items integer;
  v_payload jsonb;
  v_stock_branca_antes integer;
  v_stock_branca_despues integer;
  v_movimiento_id uuid;
  v_estado text;
begin
  select olavarria_id, usuario_id into v_olavarria_id, v_usuario_id from _test_ctx;
  select id into v_branca_id from skus where codigo_interno = 'BRANCA-750';

  -- Stock base de Fernet Branca en Olavarria: 20 unidades via ajuste.
  perform registrar_movimiento(v_branca_id, v_olavarria_id, 'ajuste', 20, 'carga inicial de test');

  select cantidad into v_stock_branca_antes
  from stock_sucursal where sku_id = v_branca_id and sucursal_id = v_olavarria_id;

  -- Iniciar: foto del stock actual para todos los SKU activos.
  select * into v_inventario from iniciar_inventario(v_olavarria_id, 'general');

  if v_inventario.estado <> 'abierto' then
    raise exception 'FALLO: el inventario deberia nacer abierto y nacio en %', v_inventario.estado;
  end if;

  select count(*) into v_total_items
  from inventario_items where inventario_id = v_inventario.id;

  if v_total_items <> (select count(*) from skus where activo = true) then
    raise exception
      'FALLO: el inventario general deberia tener una fila por SKU activo (%) y tiene %',
      (select count(*) from skus where activo = true), v_total_items;
  end if;

  if (
    select stock_sistema from inventario_items
    where inventario_id = v_inventario.id and sku_id = v_branca_id
  ) <> 20 then
    raise exception 'FALLO: la foto de stock_sistema de Fernet Branca deberia ser 20';
  end if;

  -- Confirmar sin haber cargado ningun conteo -> rechazado.
  begin
    perform confirmar_inventario(v_inventario.id);
    raise exception 'FALLO: se confirmo un inventario sin ningun conteo cargado';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: confirmar sin conteo cargado rechazado (%)', sqlerrm;
  end;

  -- Cargar el conteo: todo coincide con el sistema, salvo Fernet Branca que
  -- da 2 menos (rotura). Se arma el payload a partir de la propia foto para
  -- no tener que hardcodear el catalogo completo en el test.
  select jsonb_agg(jsonb_build_object(
    'sku_id', sku_id,
    'stock_contado', case when sku_id = v_branca_id then stock_sistema - 2 else stock_sistema end,
    'motivo', null
  ))
  into v_payload
  from inventario_items where inventario_id = v_inventario.id;

  perform guardar_conteo(v_inventario.id, v_payload);

  -- Confirmar con una diferencia sin motivo -> rechazado.
  begin
    perform confirmar_inventario(v_inventario.id);
    raise exception 'FALLO: se confirmo un inventario con una diferencia sin motivo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: confirmar con diferencia sin motivo rechazado (%)', sqlerrm;
  end;

  -- Completar el motivo de Fernet Branca (guardar_conteo se puede llamar de
  -- nuevo, mismo patron que guardar_avance_preparacion en el bloque 7).
  perform guardar_conteo(
    v_inventario.id,
    jsonb_build_array(jsonb_build_object(
      'sku_id', v_branca_id, 'stock_contado', 18, 'motivo', 'rotura'
    ))
  );

  perform confirmar_inventario(v_inventario.id);

  select cantidad into v_stock_branca_despues
  from stock_sucursal where sku_id = v_branca_id and sucursal_id = v_olavarria_id;

  if v_stock_branca_despues <> 18 then
    raise exception
      'FALLO: Fernet Branca deberia quedar en 18 tras el ajuste y quedo en %', v_stock_branca_despues;
  end if;

  select movimiento_ajuste_id into v_movimiento_id
  from inventario_items where inventario_id = v_inventario.id and sku_id = v_branca_id;

  if v_movimiento_id is null then
    raise exception 'FALLO: la fila de Fernet Branca deberia tener movimiento_ajuste_id cargado';
  end if;

  if not exists (
    select 1 from movimientos_stock
    where id = v_movimiento_id
      and tipo = 'ajuste' and cantidad = -2 and motivo = 'rotura'
      and documento_tipo = 'inventario' and documento_id = v_inventario.id
  ) then
    raise exception 'FALLO: el movimiento de ajuste no tiene los datos esperados';
  end if;

  if exists (
    select 1 from inventario_items
    where inventario_id = v_inventario.id and diferencia <> 0 and movimiento_ajuste_id is null
  ) then
    raise exception 'FALLO: quedo una diferencia sin su movimiento de ajuste';
  end if;

  select estado into v_estado from inventarios where id = v_inventario.id;
  if v_estado <> 'cerrado' then
    raise exception 'FALLO: el inventario deberia quedar cerrado y quedo en %', v_estado;
  end if;

  if (select fecha_fin from inventarios where id = v_inventario.id) is null then
    raise exception 'FALLO: un inventario cerrado deberia tener fecha_fin';
  end if;

  raise notice 'OK: circuito completo de inventario general (20 -> 18 en Fernet Branca, ajuste trazado)';

  -- Inmutabilidad: nada se puede tocar en un inventario cerrado.
  begin
    perform guardar_conteo(
      v_inventario.id,
      jsonb_build_array(jsonb_build_object('sku_id', v_branca_id, 'stock_contado', 5, 'motivo', 'robo'))
    );
    raise exception 'FALLO: se pudo cargar conteo en un inventario cerrado';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: conteo sobre inventario cerrado rechazado (%)', sqlerrm;
  end;

  begin
    perform confirmar_inventario(v_inventario.id);
    raise exception 'FALLO: se pudo volver a confirmar un inventario ya cerrado';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: reconfirmar un inventario cerrado rechazado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 2: inventario por categoria -- solo trae los SKU de esa categoria,
-- no el catalogo entero.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_fernet_id uuid;
  v_inventario inventarios;
  v_total_items integer;
  v_esperados integer;
  v_payload jsonb;
begin
  select olavarria_id into v_olavarria_id from _test_ctx;
  select id into v_fernet_id from categorias where nombre = 'Fernet';

  select count(*) into v_esperados
  from skus s join productos p on p.id = s.producto_id
  where s.activo = true and p.categoria_id = v_fernet_id;

  select * into v_inventario
  from iniciar_inventario(v_olavarria_id, 'categoria', v_fernet_id);

  select count(*) into v_total_items
  from inventario_items where inventario_id = v_inventario.id;

  if v_total_items <> v_esperados then
    raise exception
      'FALLO: el inventario por categoria Fernet deberia traer % SKU y trajo %',
      v_esperados, v_total_items;
  end if;

  if exists (
    select 1 from inventario_items ii
    join skus s on s.id = ii.sku_id
    where ii.inventario_id = v_inventario.id and s.codigo_interno = 'GORDONS-LD-750'
  ) then
    raise exception 'FALLO: un inventario de la categoria Fernet no deberia traer un gin';
  end if;

  raise notice 'OK: el inventario por categoria trae solo los SKU de esa categoria (%)', v_esperados;

  -- Se cierra limpio (sin diferencias) para no dejar un inventario abierto
  -- en Olavarria y no interferir con los casos siguientes.
  select jsonb_agg(jsonb_build_object('sku_id', sku_id, 'stock_contado', stock_sistema, 'motivo', null))
  into v_payload
  from inventario_items where inventario_id = v_inventario.id;

  perform guardar_conteo(v_inventario.id, v_payload);
  perform confirmar_inventario(v_inventario.id);
end $$;

-- =========================================================
-- Caso 3: validaciones de iniciar_inventario() -- tipo/categoria/sku_ids
-- mal combinados, y "no hay productos" con una lista de SKU invalida.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_fernet_id uuid;
begin
  select olavarria_id into v_olavarria_id from _test_ctx;
  select id into v_fernet_id from categorias where nombre = 'Fernet';

  begin
    perform iniciar_inventario(v_olavarria_id, 'categoria', null);
    raise exception 'FALLO: se inicio un inventario por categoria sin categoria_id';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: inventario por categoria sin categoria_id rechazado (%)', sqlerrm;
  end;

  begin
    perform iniciar_inventario(v_olavarria_id, 'general', v_fernet_id);
    raise exception 'FALLO: se inicio un inventario general con categoria_id';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: inventario general con categoria_id rechazado (%)', sqlerrm;
  end;

  begin
    perform iniciar_inventario(v_olavarria_id, 'puntual', null, null);
    raise exception 'FALLO: se inicio un inventario puntual sin ningun SKU elegido';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: inventario puntual sin SKU rechazado (%)', sqlerrm;
  end;

  begin
    perform iniciar_inventario(v_olavarria_id, 'puntual', null, array[gen_random_uuid()]);
    raise exception 'FALLO: se inicio un inventario puntual con un SKU que no existe';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: inventario puntual con SKU inexistente rechazado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 4: inventario puntual -- lista explicita de SKU, un solo inventario
-- abierto por sucursal a la vez, y vocabulario de motivo cerrado.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_gordons_ld_id uuid;
  v_gordons_pink_id uuid;
  v_inventario inventarios;
  v_total_items integer;
  v_payload jsonb;
begin
  select olavarria_id into v_olavarria_id from _test_ctx;
  select id into v_gordons_ld_id from skus where codigo_interno = 'GORDONS-LD-750';
  select id into v_gordons_pink_id from skus where codigo_interno = 'GORDONS-PINK-700';

  select * into v_inventario from iniciar_inventario(
    v_olavarria_id, 'puntual', null, array[v_gordons_ld_id, v_gordons_pink_id]
  );

  select count(*) into v_total_items
  from inventario_items where inventario_id = v_inventario.id;

  if v_total_items <> 2 then
    raise exception 'FALLO: el inventario puntual deberia tener 2 SKU y tiene %', v_total_items;
  end if;

  -- Un solo inventario abierto por sucursal a la vez.
  begin
    perform iniciar_inventario(v_olavarria_id, 'puntual', null, array[v_gordons_ld_id]);
    raise exception 'FALLO: se pudo abrir un segundo inventario en Olavarria con uno ya abierto';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: no se puede abrir un segundo inventario abierto en la misma sucursal (%)', sqlerrm;
  end;

  -- Vocabulario de motivo cerrado (arquitectura.md 1.9): un texto libre no
  -- vale como motivo.
  begin
    perform guardar_conteo(
      v_inventario.id,
      jsonb_build_array(jsonb_build_object(
        'sku_id', v_gordons_ld_id, 'stock_contado', 0, 'motivo', 'se lo llevo un cliente'
      ))
    );
    raise exception 'FALLO: se acepto un motivo fuera del vocabulario cerrado';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: motivo fuera del vocabulario cerrado rechazado (%)', sqlerrm;
  end;

  -- Se cierra limpio para no dejar Olavarria con un inventario abierto.
  select jsonb_agg(jsonb_build_object('sku_id', sku_id, 'stock_contado', stock_sistema, 'motivo', null))
  into v_payload
  from inventario_items where inventario_id = v_inventario.id;

  perform guardar_conteo(v_inventario.id, v_payload);
  perform confirmar_inventario(v_inventario.id);

  raise notice 'OK: inventario puntual con lista explicita de SKU';
end $$;

-- =========================================================
-- Caso 5: sugerir_conteo_puntual() -- se deriva de una venta con stock en
-- cero (movimientos_stock, sin flag aparte -- ver nota de diseño en la
-- migracion) y deja de sugerirse una vez que un inventario cerrado
-- recontó ese SKU.
-- =========================================================

do $$
declare
  v_laprida_id uuid;
  v_quilmes_id uuid;
  v_sugerido_antes integer;
  v_inventario inventarios;
begin
  select laprida_id into v_laprida_id from _test_ctx;
  select id into v_quilmes_id from skus where codigo_interno = 'QUI-CLAS-UN';

  -- Nadie toco este SKU en Laprida todavia: stock arranca en 0 (no hay
  -- fila), asi que la venta que sigue sale "con stock en cero".
  if exists (select 1 from sugerir_conteo_puntual(v_laprida_id) where sku_id = v_quilmes_id) then
    raise exception 'FALLO: antes de la venta este SKU no deberia estar sugerido todavia';
  end if;

  perform registrar_movimiento(v_quilmes_id, v_laprida_id, 'venta', 3, 'venta con stock en cero (test)');

  select stock_actual into v_sugerido_antes
  from sugerir_conteo_puntual(v_laprida_id) where sku_id = v_quilmes_id;

  if v_sugerido_antes is null then
    raise exception 'FALLO: tras vender con stock en cero, el SKU deberia aparecer en la sugerencia';
  end if;

  if v_sugerido_antes <> -3 then
    raise exception 'FALLO: el stock actual sugerido deberia ser -3 y es %', v_sugerido_antes;
  end if;

  raise notice 'OK: la venta con stock en cero alimenta la sugerencia de conteo puntual (stock %)', v_sugerido_antes;

  -- Se cuenta puntualmente ese SKU y se cierra el inventario: la sugerencia
  -- tiene que desaparecer despues.
  select * into v_inventario
  from iniciar_inventario(v_laprida_id, 'puntual', null, array[v_quilmes_id]);

  perform guardar_conteo(
    v_inventario.id,
    jsonb_build_array(jsonb_build_object(
      'sku_id', v_quilmes_id, 'stock_contado', 0, 'motivo', 'error_conteo_previo'
    ))
  );
  perform confirmar_inventario(v_inventario.id);

  if exists (
    select 1 from sugerir_conteo_puntual(v_laprida_id) where sku_id = v_quilmes_id
  ) then
    raise exception 'FALLO: tras contarlo y cerrar el inventario, el SKU no deberia seguir sugerido';
  end if;

  raise notice 'OK: un SKU recontado en un inventario cerrado deja de sugerirse';
end $$;

-- No se hace commit a proposito: el test no deja rastro en la base.
rollback;
