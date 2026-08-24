-- Tests bloque 7: pedidos, transferencias, stock_transito, sugerencia
-- automatica. Mismo formato que bloque3_stock.sql y bloque4_compras.sql:
-- SQL plano, cada caso es un DO block que revienta con RAISE EXCEPTION si
-- el assert falla, todo en una transaccion que termina en ROLLBACK.
--
-- Correr con psql contra una base con los bloques 1 a 7 ya migrados:
--
--   psql <conexion> -f supabase/tests/bloque7_pedidos.sql
--
-- Requiere conexion con privilegios de superusuario/dueño de tablas.
--
-- El caso 3 es el que mas importa: verifica que el stock quede consistente
-- en el circuito completo (despachar N, recibir M < N por rotura) y que no
-- se "pierda" ni se "duplique" mercaderia en ningun paso.

\set ON_ERROR_STOP on

begin;

-- =========================================================
-- Setup: usuario de test (dueño, opera las dos sucursales sin distinguir
-- lados) + contexto de auth simulado
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
    'test-bloque7@bebidasmoe.local', 'test-not-a-real-hash',
    now(), now(), now(),
    '', '', '', '',
    '{}', '{}', false
  );

  insert into usuarios (id, nombre, email, rol, activo)
  values (v_usuario_id, 'Test Bloque 7', 'test-bloque7@bebidasmoe.local', 'dueno', true);

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
-- Caso 1: un pedido no puede tener origen no-central ni destino central
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_usuario_id uuid;
begin
  select olavarria_id, laprida_id, usuario_id into v_olavarria_id, v_laprida_id, v_usuario_id
  from _test_ctx;

  begin
    insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
    values (v_laprida_id, v_olavarria_id, v_usuario_id);
    raise exception 'FALLO: se creo un pedido con origen no central';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: origen no central rechazado (%)', sqlerrm;
  end;

  begin
    insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
    values (v_olavarria_id, v_olavarria_id, v_usuario_id);
    raise exception 'FALLO: se creo un pedido con destino central';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: destino central rechazado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 2: transferencias/transferencia_items/stock_transito no se escriben
-- directo (defensa en profundidad, mismo mecanismo que stock_sucursal)
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_usuario_id uuid;
  v_pedido_id uuid;
begin
  select olavarria_id, laprida_id, usuario_id into v_olavarria_id, v_laprida_id, v_usuario_id
  from _test_ctx;

  insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
  values (v_olavarria_id, v_laprida_id, v_usuario_id)
  returning id into v_pedido_id;

  begin
    insert into transferencias (pedido_id, sucursal_origen_id, sucursal_destino_id, usuario_despacho_id)
    values (v_pedido_id, v_olavarria_id, v_laprida_id, v_usuario_id);
    raise exception 'FALLO: se pudo insertar una transferencia directo, sin pasar por despachar_pedido()';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: insert directo a transferencias bloqueado (%)', sqlerrm;
  end;
end $$;

-- =========================================================
-- Caso 3: circuito completo con verificacion de stock en cada paso --
-- despachar N, verificar Olavarria -N y stock_transito +N; recibir M < N
-- por rotura (sin motivo rechazado, con motivo aceptado), verificar
-- Laprida +M (no +N) y stock_transito de vuelta a cero. Cierre automatico
-- del pedido al no quedar nada pendiente de despachar.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_usuario_id uuid;
  v_sku_id uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
  v_transferencia_id uuid;
  v_stock_olavarria_antes integer;
  v_stock_olavarria_despues_despacho integer;
  v_stock_transito integer;
  v_stock_laprida_antes integer;
  v_stock_laprida_despues integer;
  v_estado text;
  v_diferencia integer;
begin
  select olavarria_id, laprida_id, usuario_id into v_olavarria_id, v_laprida_id, v_usuario_id
  from _test_ctx;
  select id into v_sku_id from skus where codigo_interno = 'BRANCA-750';

  -- Stock base en Olavarria: 50 unidades via ajuste.
  perform registrar_movimiento(v_sku_id, v_olavarria_id, 'ajuste', 50, 'carga inicial de test');

  select cantidad into v_stock_olavarria_antes
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_olavarria_id;

  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_laprida_id), 0
  ) into v_stock_laprida_antes;

  -- Armar y enviar el pedido: Laprida pide 10.
  insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
  values (v_olavarria_id, v_laprida_id, v_usuario_id)
  returning id into v_pedido_id;

  insert into pedido_items (pedido_id, sku_id, cantidad_solicitada)
  values (v_pedido_id, v_sku_id, 10)
  returning id into v_pedido_item_id;

  update pedidos set estado = 'enviado' where id = v_pedido_id;

  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'enviado' then
    raise exception 'FALLO: el pedido deberia estar enviado y quedo en %', v_estado;
  end if;

  -- Primer guardado de avance: pasa solo a en_preparacion (decision confirmada).
  perform guardar_avance_preparacion(
    v_pedido_id,
    jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 10))
  );

  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'en_preparacion' then
    raise exception 'FALLO: el primer guardado de avance deberia pasar el pedido a en_preparacion y quedo en %', v_estado;
  end if;

  -- Confirmar preparacion: se preparo todo lo pedido -> sin diferencia de preparacion.
  perform confirmar_preparacion(v_pedido_id);

  if (select cantidad_pendiente from pedido_items where id = v_pedido_item_id) <> 0 then
    raise exception 'FALLO: no deberia haber diferencia de preparacion (se pidieron y prepararon 10)';
  end if;

  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'preparado' then
    raise exception 'FALLO: el pedido deberia estar preparado y quedo en %', v_estado;
  end if;

  -- Despachar las 10 unidades preparadas (N = 10).
  select (despachar_pedido(
    v_pedido_id,
    jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 10))
  )).id into v_transferencia_id;

  select cantidad into v_stock_olavarria_despues_despacho
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_olavarria_id;

  if v_stock_olavarria_despues_despacho <> v_stock_olavarria_antes - 10 then
    raise exception 'FALLO: Olavarria deberia bajar 10 (% -> %) y quedo en %',
      v_stock_olavarria_antes, v_stock_olavarria_antes - 10, v_stock_olavarria_despues_despacho;
  end if;

  select cantidad into v_stock_transito
  from stock_transito where sku_id = v_sku_id and transferencia_id = v_transferencia_id;

  if v_stock_transito <> 10 then
    raise exception 'FALLO: stock_transito deberia tener 10 unidades y tiene %', v_stock_transito;
  end if;

  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'despachado' then
    raise exception 'FALLO: el pedido deberia estar despachado y quedo en %', v_estado;
  end if;

  -- Recepcion con rotura (M = 8 < N = 10) sin motivo -> debe rechazarse.
  begin
    perform confirmar_recepcion_transferencia(
      v_transferencia_id,
      jsonb_build_array(jsonb_build_object(
        'transferencia_item_id', (select id from transferencia_items where transferencia_id = v_transferencia_id),
        'cantidad_recibida', 8,
        'motivo_diferencia', null
      ))
    );
    raise exception 'FALLO: se acepto una diferencia de recepcion sin motivo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: diferencia de recepcion sin motivo rechazada (%)', sqlerrm;
  end;

  -- Mismo intento, ahora con motivo -> debe aceptarse.
  perform confirmar_recepcion_transferencia(
    v_transferencia_id,
    jsonb_build_array(jsonb_build_object(
      'transferencia_item_id', (select id from transferencia_items where transferencia_id = v_transferencia_id),
      'cantidad_recibida', 8,
      'motivo_diferencia', 'se rompieron 2 en el viaje'
    ))
  );

  select diferencia into v_diferencia
  from transferencia_items where transferencia_id = v_transferencia_id;
  if v_diferencia <> -2 then
    raise exception 'FALLO: la diferencia de recepcion deberia ser -2 y quedo en %', v_diferencia;
  end if;

  select cantidad into v_stock_laprida_despues
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_laprida_id;

  if v_stock_laprida_despues <> v_stock_laprida_antes + 8 then
    raise exception 'FALLO: Laprida deberia subir 8 (lo recibido, no lo despachado) y quedo en % (antes %)',
      v_stock_laprida_despues, v_stock_laprida_antes;
  end if;

  if exists (
    select 1 from stock_transito where sku_id = v_sku_id and transferencia_id = v_transferencia_id
  ) then
    raise exception 'FALLO: stock_transito deberia volver a cero (fila borrada) tras la recepcion';
  end if;

  select estado into v_estado from transferencias where id = v_transferencia_id;
  if v_estado <> 'recibida' then
    raise exception 'FALLO: la transferencia deberia quedar recibida y quedo en %', v_estado;
  end if;

  -- Cierre automatico: no quedo nada preparado sin despachar.
  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'cerrado' then
    raise exception 'FALLO: el pedido deberia cerrarse solo al no quedar nada por despachar y quedo en %', v_estado;
  end if;

  -- La diferencia de preparacion (0) es independiente de la de recepcion (-2).
  if (select cantidad_pendiente from pedido_items where id = v_pedido_item_id) <> 0 then
    raise exception 'FALLO: la diferencia de preparacion no deberia verse afectada por la rotura en el viaje';
  end if;

  raise notice 'OK: circuito completo consistente (despachar 10 -> Olavarria -10/transito +10; recibir 8 -> Laprida +8/transito 0)';
end $$;

-- =========================================================
-- Caso 4: cierre manual -- exige motivo, no se puede con transferencias en
-- transito, y suma lo no despachado a cantidad_pendiente.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_usuario_id uuid;
  v_sku_id uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
  v_transferencia_id uuid;
  v_estado text;
  v_pendiente integer;
begin
  select olavarria_id, laprida_id, usuario_id into v_olavarria_id, v_laprida_id, v_usuario_id
  from _test_ctx;
  select id into v_sku_id from skus where codigo_interno = 'GORDONS-PINK-700';

  perform registrar_movimiento(v_sku_id, v_olavarria_id, 'ajuste', 20, 'carga inicial de test');

  insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
  values (v_olavarria_id, v_laprida_id, v_usuario_id)
  returning id into v_pedido_id;

  insert into pedido_items (pedido_id, sku_id, cantidad_solicitada)
  values (v_pedido_id, v_sku_id, 10)
  returning id into v_pedido_item_id;

  update pedidos set estado = 'enviado' where id = v_pedido_id;

  perform guardar_avance_preparacion(
    v_pedido_id,
    jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 10))
  );
  perform confirmar_preparacion(v_pedido_id);

  -- Solo se despachan 6 de las 10 preparadas (deja 4 sin despachar).
  select (despachar_pedido(
    v_pedido_id,
    jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 6))
  )).id into v_transferencia_id;

  begin
    perform cerrar_pedido_manual(v_pedido_id, null);
    raise exception 'FALLO: se cerro un pedido manualmente sin motivo';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: cierre manual sin motivo rechazado (%)', sqlerrm;
  end;

  begin
    perform cerrar_pedido_manual(v_pedido_id, 'el camion no volvio a salir esta semana');
    raise exception 'FALLO: se cerro un pedido con una transferencia todavia en transito';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: cierre manual con transferencia en transito rechazado (%)', sqlerrm;
  end;

  perform confirmar_recepcion_transferencia(
    v_transferencia_id,
    jsonb_build_array(jsonb_build_object(
      'transferencia_item_id', (select id from transferencia_items where transferencia_id = v_transferencia_id),
      'cantidad_recibida', 6,
      'motivo_diferencia', null
    ))
  );

  -- Todavia no cierra solo: quedaron 4 preparadas sin despachar.
  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'despachado' then
    raise exception 'FALLO: el pedido no deberia cerrarse solo con 4 unidades preparadas sin despachar (quedo en %)', v_estado;
  end if;

  perform cerrar_pedido_manual(v_pedido_id, 'el camion no volvio a salir esta semana');

  select estado into v_estado from pedidos where id = v_pedido_id;
  if v_estado <> 'cerrado' then
    raise exception 'FALLO: el pedido deberia quedar cerrado tras el cierre manual y quedo en %', v_estado;
  end if;

  select cantidad_pendiente into v_pendiente from pedido_items where id = v_pedido_item_id;
  if v_pendiente <> 4 then
    raise exception 'FALLO: el cierre manual deberia sumar las 4 no despachadas al pendiente y quedo en %', v_pendiente;
  end if;

  raise notice 'OK: cierre manual exige motivo, respeta transferencias en transito y acumula el pendiente';
end $$;

-- =========================================================
-- Caso 5: arrastre en sugerir_pedido() -- solo el pendiente del ULTIMO
-- pedido cerrado por sku, no acumulado (decision de negocio confirmada).
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_usuario_id uuid;
  v_sku_id uuid;
  v_pedido_a_id uuid;
  v_pedido_b_id uuid;
  v_item_a_id uuid;
  v_item_b_id uuid;
  v_transferencia_id uuid;
  v_arrastre integer;
begin
  select olavarria_id, laprida_id, usuario_id into v_olavarria_id, v_laprida_id, v_usuario_id
  from _test_ctx;
  select id into v_sku_id from skus where codigo_interno = 'GORDONS-LD-750';

  perform registrar_movimiento(v_sku_id, v_olavarria_id, 'ajuste', 20, 'carga inicial de test');

  -- Pedido A: se piden 10, solo se preparan 4 -> queda un pendiente de 6.
  insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
  values (v_olavarria_id, v_laprida_id, v_usuario_id)
  returning id into v_pedido_a_id;

  insert into pedido_items (pedido_id, sku_id, cantidad_solicitada)
  values (v_pedido_a_id, v_sku_id, 10)
  returning id into v_item_a_id;

  update pedidos set estado = 'enviado' where id = v_pedido_a_id;
  perform guardar_avance_preparacion(
    v_pedido_a_id, jsonb_build_array(jsonb_build_object('pedido_item_id', v_item_a_id, 'cantidad', 4))
  );
  perform confirmar_preparacion(v_pedido_a_id);

  select (despachar_pedido(
    v_pedido_a_id, jsonb_build_array(jsonb_build_object('pedido_item_id', v_item_a_id, 'cantidad', 4))
  )).id into v_transferencia_id;

  perform confirmar_recepcion_transferencia(
    v_transferencia_id,
    jsonb_build_array(jsonb_build_object(
      'transferencia_item_id', (select id from transferencia_items where transferencia_id = v_transferencia_id),
      'cantidad_recibida', 4,
      'motivo_diferencia', null
    ))
  );

  if (select estado from pedidos where id = v_pedido_a_id) <> 'cerrado' then
    raise exception 'FALLO: el pedido A deberia haberse cerrado solo';
  end if;
  if (select cantidad_pendiente from pedido_items where id = v_item_a_id) <> 6 then
    raise exception 'FALLO: el pendiente del pedido A deberia ser 6';
  end if;

  select arrastre into v_arrastre
  from sugerir_pedido(v_laprida_id)
  where sku_id = v_sku_id;

  if v_arrastre <> 6 then
    raise exception 'FALLO: la sugerencia deberia arrastrar 6 (pendiente del pedido A) y arrastro %', v_arrastre;
  end if;
  raise notice 'OK: la sugerencia arrastra el pendiente del pedido A (6)';

  -- Pedido B: ahora se piden y preparan 6 completos -> pendiente 0.
  insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
  values (v_olavarria_id, v_laprida_id, v_usuario_id)
  returning id into v_pedido_b_id;

  insert into pedido_items (pedido_id, sku_id, cantidad_solicitada)
  values (v_pedido_b_id, v_sku_id, 6)
  returning id into v_item_b_id;

  update pedidos set estado = 'enviado' where id = v_pedido_b_id;
  perform guardar_avance_preparacion(
    v_pedido_b_id, jsonb_build_array(jsonb_build_object('pedido_item_id', v_item_b_id, 'cantidad', 6))
  );
  perform confirmar_preparacion(v_pedido_b_id);

  select (despachar_pedido(
    v_pedido_b_id, jsonb_build_array(jsonb_build_object('pedido_item_id', v_item_b_id, 'cantidad', 6))
  )).id into v_transferencia_id;

  perform confirmar_recepcion_transferencia(
    v_transferencia_id,
    jsonb_build_array(jsonb_build_object(
      'transferencia_item_id', (select id from transferencia_items where transferencia_id = v_transferencia_id),
      'cantidad_recibida', 6,
      'motivo_diferencia', null
    ))
  );

  if (select cantidad_pendiente from pedido_items where id = v_item_b_id) <> 0 then
    raise exception 'FALLO: el pendiente del pedido B deberia ser 0';
  end if;

  select arrastre into v_arrastre
  from sugerir_pedido(v_laprida_id)
  where sku_id = v_sku_id;

  if v_arrastre <> 0 then
    raise exception
      'FALLO: la sugerencia deberia arrastrar 0 (solo el ultimo pedido cerrado, no el acumulado historico) y arrastro %',
      v_arrastre;
  end if;

  raise notice 'OK: el arrastre toma solo el ultimo pedido cerrado (6 -> 0), no se acumula';
end $$;

-- =========================================================
-- Caso 6: no se puede despachar mas de lo que hay fisicamente en stock en
-- origen, aunque este "preparado" en el pedido. Distinto del POS (venta sin
-- stock se permite a proposito): una transferencia interna no tiene razon
-- de mandar mercaderia que no existe. Bug real: se pudo despachar 6
-- Fernet y 5 Gordon's con stock 0, quedo en -6 y -5.
-- =========================================================

do $$
declare
  v_olavarria_id uuid;
  v_laprida_id uuid;
  v_usuario_id uuid;
  v_sku_id uuid;
  v_pedido_id uuid;
  v_pedido_item_id uuid;
  v_transferencia_id uuid;
  v_stock_olavarria integer;
begin
  select olavarria_id, laprida_id, usuario_id into v_olavarria_id, v_laprida_id, v_usuario_id
  from _test_ctx;
  select id into v_sku_id from skus where codigo_interno = 'BRANCA-MENTA-750';

  -- Sin carga inicial: el stock en Olavarria arranca en 0 (ni fila en
  -- stock_sucursal) para este sku en el test.

  insert into pedidos (sucursal_origen_id, sucursal_destino_id, usuario_creador_id)
  values (v_olavarria_id, v_laprida_id, v_usuario_id)
  returning id into v_pedido_id;

  insert into pedido_items (pedido_id, sku_id, cantidad_solicitada)
  values (v_pedido_id, v_sku_id, 6)
  returning id into v_pedido_item_id;

  update pedidos set estado = 'enviado' where id = v_pedido_id;

  -- Se "prepara" igual (el encargado carga la cantidad a mano, sin mirar
  -- stock real): esto es justamente lo que dejaba pasar el bug.
  perform guardar_avance_preparacion(
    v_pedido_id,
    jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 6))
  );
  perform confirmar_preparacion(v_pedido_id);

  begin
    perform despachar_pedido(
      v_pedido_id,
      jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 6))
    );
    raise exception 'FALLO: se pudo despachar 6 unidades sin stock en origen';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: despacho sin stock en origen rechazado (%)', sqlerrm;
  end;

  select coalesce(
    (select cantidad from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_olavarria_id), 0
  ) into v_stock_olavarria;

  if v_stock_olavarria <> 0 then
    raise exception 'FALLO: el stock de Olavarria no deberia haberse tocado y quedo en %', v_stock_olavarria;
  end if;

  if exists (select 1 from transferencias where pedido_id = v_pedido_id) then
    raise exception 'FALLO: no deberia haber quedado ninguna transferencia creada tras el rechazo';
  end if;

  -- Con stock parcial (4) tampoco se puede despachar mas de lo disponible,
  -- aunque lo "preparado" alcance para mas (6).
  perform registrar_movimiento(v_sku_id, v_olavarria_id, 'ajuste', 4, 'carga parcial de test');

  begin
    perform despachar_pedido(
      v_pedido_id,
      jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 6))
    );
    raise exception 'FALLO: se pudo despachar 6 unidades con solo 4 en stock';
  exception
    when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      raise notice 'OK: despacho por encima del stock parcial disponible rechazado (%)', sqlerrm;
  end;

  -- Despachar exactamente lo disponible (4) si funciona.
  select (despachar_pedido(
    v_pedido_id,
    jsonb_build_array(jsonb_build_object('pedido_item_id', v_pedido_item_id, 'cantidad', 4))
  )).id into v_transferencia_id;

  select cantidad into v_stock_olavarria
  from stock_sucursal where sku_id = v_sku_id and sucursal_id = v_olavarria_id;

  if v_stock_olavarria <> 0 then
    raise exception 'FALLO: tras despachar las 4 disponibles Olavarria deberia quedar en 0 y quedo en %', v_stock_olavarria;
  end if;

  raise notice 'OK: se puede despachar exactamente el stock disponible (4), ni una unidad mas';
end $$;

-- No se hace commit a proposito: el test no deja rastro en la base.
rollback;
