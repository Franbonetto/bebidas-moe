-- Tests bloque 3: stock_sucursal, movimientos_stock, registrar_movimiento()
-- y desarmar_sku(). SQL plano, sin pgTAP: cada caso es un DO block que
-- revienta con RAISE EXCEPTION si el assert falla.
--
-- Correr con psql contra una base con los bloques 1, 2 y 3 ya migrados
-- (usa el seed de Quilmes Clasica del bloque 2, que trae la cascada de
-- desarme x24->x6->unidad):
--
--   psql <conexion> -f supabase/tests/bloque3_stock.sql
--
-- Requiere una conexion con privilegios de superusuario/dueño de tablas
-- (la misma que corre las migraciones) porque el caso 1 compara el
-- bloqueo entre el rol authenticated y ese rol. Todo corre en una sola
-- transaccion que termina en ROLLBACK: no deja datos de test en la base,
-- se puede re-correr las veces que haga falta.
--
-- Simula un usuario logueado seteando request.jwt.claim.sub -- la forma en
-- que auth.uid() lee el JWT en Supabase -- en vez de autenticar de verdad.

\set ON_ERROR_STOP on

begin;

-- =========================================================
-- Setup: usuario de test + contexto de auth simulado
-- =========================================================

create temporary table _test_ctx (usuario_id uuid, olavarria_id uuid);

do $$
declare
  v_usuario_id uuid := gen_random_uuid();
  v_olavarria_id uuid;
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
    'test-bloque3@bebidasmoe.local', 'test-not-a-real-hash',
    now(), now(), now(),
    '', '', '', '',
    '{}', '{}', false
  );

  insert into usuarios (id, nombre, email, rol, activo)
  values (v_usuario_id, 'Test Bloque 3', 'test-bloque3@bebidasmoe.local', 'dueno', true);

  insert into _test_ctx values (v_usuario_id, v_olavarria_id);
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
-- Caso 1: no se puede modificar stock (ni movimientos) sin pasar por
-- las funciones -- ni como authenticated ni como dueño de las tablas.
-- =========================================================

-- crea una fila real via el camino legitimo, para tener algo que intentar
-- pisar directo despues (un UPDATE sobre una tabla sin filas no dispara
-- el trigger BEFORE UPDATE FOR EACH ROW, y el test daria falso positivo).
do $$
declare
  v_sku_id uuid;
  v_sucursal_id uuid;
begin
  select id into v_sku_id from skus where codigo_interno = 'QUI-CLAS-UN';
  select olavarria_id into v_sucursal_id from _test_ctx;
  perform registrar_movimiento(v_sku_id, v_sucursal_id, 'compra', 1, 'seed para test de bloqueo');
end $$;

do $$
begin
  begin
    update stock_sucursal set cantidad = 9999;
    raise exception 'FALLO: se pudo hacer UPDATE directo a stock_sucursal como authenticated';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK (authenticated): UPDATE directo a stock_sucursal bloqueado (%)', sqlerrm;
  end;
end $$;

reset role;

do $$
begin
  begin
    update stock_sucursal set cantidad = 9999;
    raise exception 'FALLO: se pudo hacer UPDATE directo a stock_sucursal incluso como dueño de la tabla';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK (dueño de tabla): UPDATE directo a stock_sucursal bloqueado (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update movimientos_stock set motivo = 'intento de edicion';
    raise exception 'FALLO: se pudo editar un movimiento historico';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: UPDATE directo a movimientos_stock bloqueado (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from movimientos_stock;
    raise exception 'FALLO: se pudo borrar movimientos historicos';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: DELETE directo en movimientos_stock bloqueado (%)', sqlerrm;
  end;
end $$;

-- de aca en adelante seguimos como dueño de tabla (reset role de arriba);
-- request.jwt.claim.sub sigue seteado porque set_config con is_local=true
-- dura toda la transaccion, no el rol.

-- =========================================================
-- Caso 2: el stock queda consistente despues de N movimientos
-- =========================================================

do $$
declare
  v_sku_id uuid;
  v_sucursal_id uuid;
  v_stock_antes integer;
  v_stock_despues integer;
  v_count_antes integer;
  v_count_despues integer;
  v_mov movimientos_stock;
begin
  select id into v_sku_id from skus where codigo_interno = 'BRANCA-750';
  select olavarria_id into v_sucursal_id from _test_ctx;

  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id), 0
  ) into v_stock_antes;
  select count(*) into v_count_antes
  from movimientos_stock where sku_id = v_sku_id and sucursal_id = v_sucursal_id;

  v_mov := registrar_movimiento(v_sku_id, v_sucursal_id, 'compra', 50, 'test caso 2');
  if v_mov.stock_anterior <> v_stock_antes or v_mov.stock_posterior <> v_stock_antes + 50 then
    raise exception 'FALLO: compra mal calculada (anterior=%, posterior=%)', v_mov.stock_anterior, v_mov.stock_posterior;
  end if;

  perform registrar_movimiento(v_sku_id, v_sucursal_id, 'venta', 10);
  perform registrar_movimiento(v_sku_id, v_sucursal_id, 'venta', 5);
  perform registrar_movimiento(v_sku_id, v_sucursal_id, 'ajuste', -2, 'diferencia de conteo');

  select cantidad into v_stock_despues
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id;
  select count(*) into v_count_despues
  from movimientos_stock where sku_id = v_sku_id and sucursal_id = v_sucursal_id;

  if v_stock_despues <> v_stock_antes + 50 - 10 - 5 - 2 then
    raise exception 'FALLO: stock final deberia ser % y es %', v_stock_antes + 33, v_stock_despues;
  end if;

  if v_count_despues <> v_count_antes + 4 then
    raise exception 'FALLO: deberian sumarse 4 movimientos y se sumaron %', v_count_despues - v_count_antes;
  end if;

  -- cadena: el stock_anterior de cada movimiento coincide con el
  -- stock_posterior del inmediato anterior.
  if exists (
    select 1 from (
      select stock_anterior, lag(stock_posterior) over (order by fecha, id) as posterior_previo
      from movimientos_stock
      where sku_id = v_sku_id and sucursal_id = v_sucursal_id
    ) t
    where posterior_previo is not null and posterior_previo <> stock_anterior
  ) then
    raise exception 'FALLO: la cadena de movimientos quedo inconsistente';
  end if;

  raise notice 'OK: stock consistente tras 4 movimientos (% -> %)', v_stock_antes, v_stock_despues;
end $$;

-- =========================================================
-- Caso 3: el desarme en cascada calcula bien las cantidades
-- =========================================================

do $$
declare
  v_sku_x6 uuid;
  v_sku_un uuid;
  v_sucursal_id uuid;
  v_x6_antes integer;
  v_un_antes integer;
  v_x6_despues integer;
  v_un_despues integer;
  v_docs integer;
begin
  select id into v_sku_x6 from skus where codigo_interno = 'QUI-CLAS-X6';
  select id into v_sku_un from skus where codigo_interno = 'QUI-CLAS-UN';
  select olavarria_id into v_sucursal_id from _test_ctx;

  perform registrar_movimiento(v_sku_x6, v_sucursal_id, 'compra', 10, 'test caso 3');

  select cantidad into v_x6_antes
  from stock_sucursal where sku_id = v_sku_x6 and sucursal_id = v_sucursal_id;
  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_un and sucursal_id = v_sucursal_id), 0
  ) into v_un_antes;

  perform desarmar_sku(v_sku_x6, v_sucursal_id, 3, 'test de cascada');

  select cantidad into v_x6_despues
  from stock_sucursal where sku_id = v_sku_x6 and sucursal_id = v_sucursal_id;
  select cantidad into v_un_despues
  from stock_sucursal where sku_id = v_sku_un and sucursal_id = v_sucursal_id;

  if v_x6_despues <> v_x6_antes - 3 then
    raise exception 'FALLO: stock de pack x6 deberia bajar 3 (% -> %) y quedo en %',
      v_x6_antes, v_x6_antes - 3, v_x6_despues;
  end if;

  if v_un_despues <> v_un_antes + 3 * 6 then
    raise exception 'FALLO: stock de unidad deberia subir 18 (% -> %) y quedo en %',
      v_un_antes, v_un_antes + 18, v_un_despues;
  end if;

  select count(distinct documento_id) into v_docs
  from movimientos_stock
  where tipo in ('desarme_salida', 'desarme_entrada') and sucursal_id = v_sucursal_id;

  if v_docs <> 1 then
    raise exception 'FALLO: el desarme deberia compartir un unico documento_id y hay %', v_docs;
  end if;

  raise notice 'OK: cascada de desarme calculada bien (x6 % -> %, unidad % -> %)',
    v_x6_antes, v_x6_despues, v_un_antes, v_un_despues;
end $$;

-- =========================================================
-- Caso 4: una transaccion fallida no deja stock ni movimientos
-- inconsistentes
-- =========================================================

do $$
declare
  v_sku_id uuid;
  v_sucursal_id uuid;
  v_stock_antes integer;
  v_stock_despues integer;
  v_count_antes integer;
  v_count_despues integer;
begin
  select id into v_sku_id from skus where codigo_interno = 'GORDONS-PINK-700';
  select olavarria_id into v_sucursal_id from _test_ctx;

  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id), 0
  ) into v_stock_antes;
  select count(*) into v_count_antes
  from movimientos_stock where sku_id = v_sku_id and sucursal_id = v_sucursal_id;

  begin
    savepoint sp_transaccion_fallida;

    -- primer movimiento, valido -> debe revertirse junto con el segundo.
    perform registrar_movimiento(v_sku_id, v_sucursal_id, 'compra', 20, 'debe revertirse');
    -- segundo movimiento, tipo invalido a proposito -> registrar_movimiento
    -- lo rechaza antes de escribir nada.
    perform registrar_movimiento(v_sku_id, v_sucursal_id, 'tipo_que_no_existe', 5);

    raise exception 'FALLO: registrar_movimiento acepto un tipo invalido';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      rollback to savepoint sp_transaccion_fallida;
  end;

  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_sucursal_id), 0
  ) into v_stock_despues;
  select count(*) into v_count_despues
  from movimientos_stock where sku_id = v_sku_id and sucursal_id = v_sucursal_id;

  if v_stock_despues <> v_stock_antes then
    raise exception 'FALLO: el stock cambio (% -> %) pese a que la transaccion fallo', v_stock_antes, v_stock_despues;
  end if;

  if v_count_despues <> v_count_antes then
    raise exception 'FALLO: quedaron movimientos huerfanos de una transaccion fallida (% -> %)', v_count_antes, v_count_despues;
  end if;

  raise notice 'OK: una transaccion fallida no deja stock ni movimientos inconsistentes (se mantuvo en %)', v_stock_antes;
end $$;

-- No se hace commit a proposito: el test no deja rastro en la base y se
-- puede re-correr sin limpiar nada a mano.
rollback;
