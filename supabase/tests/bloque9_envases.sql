-- Tests bloque 9: circuito de envases (stock_envases, movimientos_envases,
-- registrar_movimiento_envase()). Mismo formato que bloque3_stock.sql,
-- bloque4_compras.sql, bloque7_pedidos.sql y bloque8_inventarios.sql: SQL
-- plano, cada caso es un DO block que revienta con RAISE EXCEPTION si el
-- assert falla, todo en una transaccion que termina en ROLLBACK.
--
-- Correr con psql contra una base con los bloques 1 a 9 ya migrados (usa el
-- tipo de envase "Litro retornable genérico" del seed del bloque 2):
--
--   psql <conexion> -f supabase/tests/bloque9_envases.sql
--
-- Requiere conexion con privilegios de superusuario/dueño de tablas.

\set ON_ERROR_STOP on

begin;

-- =========================================================
-- Setup: usuario de test (dueño, opera las dos sucursales) + contexto de
-- auth simulado. Mismo patron que bloque7/8.
-- =========================================================

create temporary table _test_ctx (usuario_id uuid, olavarria_id uuid, laprida_id uuid, tipo_envase_id uuid);

do $$
declare
  v_usuario_id uuid := gen_random_uuid();
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_tipo_envase_id uuid;
begin
  select id into v_olavarria_id from sucursales where nombre = 'Olavarría';
  select id into v_laprida_id from sucursales where nombre = 'Laprida';
  select id into v_tipo_envase_id from tipos_envase where nombre = 'Litro retornable genérico';
  if v_olavarria_id is null or v_laprida_id is null or v_tipo_envase_id is null then
    raise exception 'FALLO: falta seed base (¿corriste los bloques 1 y 2?)';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) values (
    '00000000-0000-0000-0000-000000000000', v_usuario_id, 'authenticated', 'authenticated',
    'test-bloque9@bebidasmoe.local', 'test-not-a-real-hash',
    now(), now(), now(),
    '', '', '', '',
    '{}', '{}', false
  );

  insert into usuarios (id, nombre, email, rol, activo)
  values (v_usuario_id, 'Test Bloque 9', 'test-bloque9@bebidasmoe.local', 'dueno', true);

  insert into _test_ctx values (v_usuario_id, v_olavarria_id, v_laprida_id, v_tipo_envase_id);
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
-- Caso 1: ingreso_cliente suma vacios y deja el movimiento bien trazado
-- (cantidad_anterior/cantidad_posterior encadenan).
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_tipo_envase_id uuid;
  v_mov movimientos_envases;
  v_stock integer;
begin
  select olavarria_id, tipo_envase_id into v_olavarria_id, v_tipo_envase_id from _test_ctx;

  v_mov := registrar_movimiento_envase(v_tipo_envase_id, v_olavarria_id, 'ingreso_cliente', 5);

  if v_mov.cantidad_anterior <> 0 or v_mov.cantidad_posterior <> 5 or v_mov.cantidad <> 5 then
    raise exception 'FALLO: primer ingreso mal calculado (anterior=%, cantidad=%, posterior=%)',
      v_mov.cantidad_anterior, v_mov.cantidad, v_mov.cantidad_posterior;
  end if;

  v_mov := registrar_movimiento_envase(v_tipo_envase_id, v_olavarria_id, 'ingreso_cliente', 3);

  if v_mov.cantidad_anterior <> 5 or v_mov.cantidad_posterior <> 8 then
    raise exception 'FALLO: segundo ingreso deberia encadenar desde 5 y dio anterior=%, posterior=%',
      v_mov.cantidad_anterior, v_mov.cantidad_posterior;
  end if;

  select cantidad_vacios into v_stock
  from stock_envases where tipo_envase_id = v_tipo_envase_id and sucursal_id = v_olavarria_id;

  if v_stock <> 8 then
    raise exception 'FALLO: stock_envases deberia quedar en 8 y quedo en %', v_stock;
  end if;

  raise notice 'OK: ingreso_cliente encadena cantidad_anterior/posterior y actualiza stock_envases (0 -> 8)';
end $$;

-- =========================================================
-- Caso 2: devolucion_proveedor resta, y esta bloqueada fuera de la
-- sucursal central (decision de implementacion 3 de la migracion).
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_tipo_envase_id uuid;
  v_mov movimientos_envases;
  v_stock integer;
begin
  select olavarria_id, laprida_id, tipo_envase_id into v_olavarria_id, v_laprida_id, v_tipo_envase_id
  from _test_ctx;

  -- Laprida no es central: rechazado aunque tenga vacios propios.
  perform registrar_movimiento_envase(v_tipo_envase_id, v_laprida_id, 'ingreso_cliente', 10);

  begin
    perform registrar_movimiento_envase(v_tipo_envase_id, v_laprida_id, 'devolucion_proveedor', 1);
    raise exception 'FALLO: se devolvio al proveedor desde una sucursal no central';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: devolucion_proveedor rechazada fuera de la sucursal central (%)', sqlerrm;
  end;

  -- Desde Olavarria (central) si funciona y resta.
  v_mov := registrar_movimiento_envase(v_tipo_envase_id, v_olavarria_id, 'devolucion_proveedor', 3);

  if v_mov.cantidad <> -3 or v_mov.cantidad_anterior <> 8 or v_mov.cantidad_posterior <> 5 then
    raise exception 'FALLO: devolucion_proveedor mal calculada (cantidad=%, anterior=%, posterior=%)',
      v_mov.cantidad, v_mov.cantidad_anterior, v_mov.cantidad_posterior;
  end if;

  select cantidad_vacios into v_stock
  from stock_envases where tipo_envase_id = v_tipo_envase_id and sucursal_id = v_olavarria_id;

  if v_stock <> 5 then
    raise exception 'FALLO: stock_envases de Olavarria deberia quedar en 5 y quedo en %', v_stock;
  end if;

  raise notice 'OK: devolucion_proveedor resta y solo funciona desde la sucursal central (8 -> 5)';
end $$;

-- =========================================================
-- Caso 3: no se puede dejar el stock de envases en negativo (decision de
-- implementacion 5), ni con devolucion_proveedor ni con un ajuste.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_tipo_envase_id uuid;
  v_stock_antes integer;
begin
  select olavarria_id, tipo_envase_id into v_olavarria_id, v_tipo_envase_id from _test_ctx;

  select cantidad_vacios into v_stock_antes
  from stock_envases where tipo_envase_id = v_tipo_envase_id and sucursal_id = v_olavarria_id;

  begin
    perform registrar_movimiento_envase(
      v_tipo_envase_id, v_olavarria_id, 'devolucion_proveedor', v_stock_antes + 1
    );
    raise exception 'FALLO: se devolvieron mas envases al proveedor de los que hay en stock';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: devolucion_proveedor por encima del stock disponible rechazada (%)', sqlerrm;
  end;

  begin
    perform registrar_movimiento_envase(
      v_tipo_envase_id, v_olavarria_id, 'ajuste', -(v_stock_antes + 1), 'test negativo'
    );
    raise exception 'FALLO: se ajusto el stock de envases a un valor negativo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: ajuste que dejaria el stock en negativo rechazado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 4: un ajuste exige motivo (decision de implementacion 4) y, con
-- motivo, suma o resta segun el signo que se le pase.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_tipo_envase_id uuid;
  v_mov movimientos_envases;
  v_stock integer;
begin
  select olavarria_id, tipo_envase_id into v_olavarria_id, v_tipo_envase_id from _test_ctx;

  begin
    perform registrar_movimiento_envase(v_tipo_envase_id, v_olavarria_id, 'ajuste', 2);
    raise exception 'FALLO: se hizo un ajuste de envases sin motivo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: ajuste de envases sin motivo rechazado (%)', sqlerrm;
  end;

  v_mov := registrar_movimiento_envase(
    v_tipo_envase_id, v_olavarria_id, 'ajuste', -2, 'rotura durante el conteo'
  );

  if v_mov.cantidad <> -2 or v_mov.motivo <> 'rotura durante el conteo' then
    raise exception 'FALLO: el ajuste con motivo no quedo bien registrado';
  end if;

  select cantidad_vacios into v_stock
  from stock_envases where tipo_envase_id = v_tipo_envase_id and sucursal_id = v_olavarria_id;

  if v_stock <> 3 then
    raise exception 'FALLO: stock_envases de Olavarria deberia quedar en 3 y quedo en %', v_stock;
  end if;

  raise notice 'OK: ajuste con motivo aplica el delta firmado (5 -> 3)';
end $$;

-- =========================================================
-- Caso 5: p_cantidad se pasa en positivo (magnitud) para ingreso_cliente y
-- devolucion_proveedor -- el signo lo decide el tipo, no quien llama.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_tipo_envase_id uuid;
begin
  select olavarria_id, tipo_envase_id into v_olavarria_id, v_tipo_envase_id from _test_ctx;

  begin
    perform registrar_movimiento_envase(v_tipo_envase_id, v_olavarria_id, 'ingreso_cliente', -1);
    raise exception 'FALLO: se acepto una cantidad negativa para ingreso_cliente';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: cantidad negativa en ingreso_cliente rechazada (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 6: venta_id solo tiene sentido junto a ingreso_cliente.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_tipo_envase_id uuid;
begin
  select olavarria_id, tipo_envase_id into v_olavarria_id, v_tipo_envase_id from _test_ctx;

  begin
    perform registrar_movimiento_envase(
      v_tipo_envase_id, v_olavarria_id, 'devolucion_proveedor', 1, null, gen_random_uuid()
    );
    raise exception 'FALLO: se acepto venta_id en un movimiento que no es ingreso_cliente';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: venta_id fuera de ingreso_cliente rechazado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 7: no se puede modificar stock_envases ni movimientos_envases sin
-- pasar por registrar_movimiento_envase() -- ni como authenticated ni como
-- dueño de las tablas. Los movimientos son inmutables.
-- =========================================================

do $$
begin
  begin
    update stock_envases set cantidad_vacios = 9999;
    raise exception 'FALLO: se pudo hacer UPDATE directo a stock_envases como authenticated';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK (authenticated): UPDATE directo a stock_envases bloqueado (%)', sqlerrm;
  end;
end $$;

reset role;

do $$
begin
  begin
    update stock_envases set cantidad_vacios = 9999;
    raise exception 'FALLO: se pudo hacer UPDATE directo a stock_envases incluso como dueño de la tabla';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK (dueño de tabla): UPDATE directo a stock_envases bloqueado (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update movimientos_envases set motivo = 'intento de edicion';
    raise exception 'FALLO: se pudo editar un movimiento de envase historico';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: UPDATE directo a movimientos_envases bloqueado (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from movimientos_envases;
    raise exception 'FALLO: se pudo borrar movimientos de envase historicos';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: DELETE directo en movimientos_envases bloqueado (%)', sqlerrm;
  end;
end $$;

-- No se hace commit a proposito: el test no deja rastro en la base.
rollback;
