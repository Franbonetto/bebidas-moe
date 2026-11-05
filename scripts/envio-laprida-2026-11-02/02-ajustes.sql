-- =====================================================================
-- Entrega a Laprida del 02/11 (+ 4 líneas del 03/11) cargada por error
-- como merma de Olavarría — PASO 2: APLICAR
-- =====================================================================
-- Le carga a Laprida, vía un movimiento de AJUSTE por SKU, exactamente
-- lo que salió de Olavarría en esas 51 líneas de merma (50 SKU — uno,
-- Schneider Pack 710 x24, se repite entre el 02/11 y el 03/11 y va
-- sumado: 1 + 2 = 3).
--
-- No se toca ninguna merma de Olavarría: son inmutables (regla 2) y la
-- salida de stock que registraron ya es correcta, la mercadería salió de
-- verdad. Esto es un ajuste nuevo en Laprida, no una transferencia
-- formal -- no hay un pedido/transferencia abierto detrás de este envío
-- y no corresponde inventar uno a posteriori.
--
-- Se pega entero en el SQL Editor y se corre de una. Al final imprime un
-- informe de las 50 líneas con el stock de Laprida antes y después de
-- cada una.
--
-- Por qué impersona al dueño: registrar_movimiento() exige
-- usuario_activo() y guarda auth.uid() en el movimiento. Desde el SQL
-- Editor no hay sesión (mismo patrón que
-- scripts/ventas-papel-2026-10-15/02-ajustes.sql).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Quién firma los movimientos
-- ---------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',
    (select id from usuarios where rol = 'dueno' and activo order by nombre limit 1)::text
  )::text,
  true
);

do $$
begin
  if auth.uid() is null or not usuario_activo() then
    raise exception 'No se pudo identificar al dueño: revisá la tabla usuarios';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Lo que salió de Olavarría para Laprida (02/11 + 03/11)
-- ---------------------------------------------------------------------
create temp table envio_laprida (sku_id uuid primary key, cantidad int not null, mermas text not null);

insert into envio_laprida (sku_id, cantidad, mermas) values
  ('dc9fbb34-eb4b-416b-a7e0-0bebb7b4708e', 12, 'af3809bc-a8fd-4346-9344-3969814b097c'),
  ('71e3da15-950e-400c-86d5-ca311735fda5', 1,  '9eaa4f0f-d184-4d51-8849-dd8a7631716d'),
  ('4232d1c6-3ccc-4598-92e7-22bf6b0911e8', 1,  '63863a7c-660a-44b5-b4b0-45a65b8a64f3'),
  ('cdd8eb43-db1f-43dc-81be-78d6b30b34f6', 1,  '31bb7207-34e1-4bcd-bfb9-c1f740901503'),
  ('3d48e9f7-44b9-4f1f-bf4a-edfdad7e1d67', 1,  'fd94634d-0ed5-4f9d-83fe-c5164c40ea10'),
  ('9b0ec9d3-1573-4121-a9ec-120213a07ac6', 1,  '0041eefc-72ab-43a7-b737-19180dea254a'),
  ('7f1c7b8f-69d0-4995-9c8d-814e176d24c7', 1,  'b7303022-44ed-44ff-af31-cac1bd2e1c33'),
  ('ab18f8a5-5366-46ed-9395-22ef7e87c528', 1,  '14426fe8-1920-4e29-ba7e-3f6a35ab4357'),
  ('4553cba3-66bf-42cc-bf8a-c40d3518b1c4', 1,  'ea3ef184-7a48-4a25-b426-104bf7e1bf04'),
  ('0f60ad88-1387-465d-a3d0-150b0d7bb567', 1,  '8f85a810-0bcd-4347-b52a-67801f76ae9e'),
  ('df21c630-f44c-4dd0-81c1-40239a771c40', 3,  'e6c32a56-5b3b-4df6-bef8-6272905f0746'),
  ('2bdd0ce4-5531-4627-b34f-68f049cc2173', 3,  '0f628e9c-6506-4ed9-953a-3e19bfdb5657'),
  ('0065a1ea-9224-41cb-8674-692062fa34d9', 6,  '14f10692-b700-42e1-b633-da0d99c803cc'),
  ('7600cb5f-f37b-4928-a0eb-b10ce9c1198c', 12, 'dcf6a7ca-312a-433b-b277-bab1681025ac'),
  ('ffa2611f-3d75-4fb2-8faf-7433ada8f8dc', 6,  'ae87249e-dc87-48db-980a-5800b851e8a1'),
  ('cbf16a31-432c-477b-8714-9bc32ed4d673', 12, '139ce5fd-b3a7-4bce-80ed-d6fc3e2ac477'),
  ('b9aa562d-e9ce-435b-9598-1e2a4e697aaa', 12, 'e16fc58b-36b2-4b27-a34c-8fee061ef035'),
  ('fcbb0a94-6a48-4b75-8342-48cfcc739ecb', 2,  '3e6aacc2-c80a-451f-b57a-db6038214ee9'),
  ('b4dcf5d4-1a7d-4cd2-9ca8-f7bca9968a53', 2,  '06b87f02-cdb4-40a7-8b83-c361d46976b5'),
  ('5a908307-3e89-4d3c-80d7-26273e6b3fcc', 3,  '8760a932-0f39-4e99-a753-2dfa21d85a08'),
  ('7246098f-732d-4647-af3e-51de358107f7', 6,  '28d4a717-77ae-48df-89db-a22c4a5906ae'),
  ('a531e8fa-f09e-44c5-ab47-08cdd71738ff', 6,  'f6cd6882-993f-468f-b6df-e209682ffb29'),
  ('e2149840-e2af-4022-8a63-2a5ad6c80cd3', 6,  'b17f1a43-de64-40a1-b868-b8735b11b6cc'),
  ('19f55c1d-c242-4bc5-961f-a63fdee8e463', 6,  'd5c56285-3027-45ef-85a9-a1d3e2155bb0'),
  ('f8dc2d06-a8d9-41df-a422-b68485908d0a', 6,  'be64b03f-25b8-4a2b-9947-4d0450449a11'),
  ('17a675f6-7c0e-4323-8d29-ab89a1d2c690', 18, '284db251-dead-467d-be43-a69fcbfc0880'),
  ('058594ea-3112-4ee0-bdfa-422c045b70af', 18, '25b77e7c-968c-44cb-a556-aea5aee2c7fb'),
  ('048a080f-a647-4ba9-b2e5-6f4a5e54b2d4', 2,  '856c2be0-48f7-40f2-951e-06a716dd8e09'),
  ('2d91b1d1-15e9-487a-bf00-44cf69d8377f', 3,  '60adca05-3de4-4dbb-87a4-fc51d66465c2 + a3d33dce-b038-451f-880b-30786235e28a'),
  ('daa7372a-1c7e-445f-a98b-55a7748de3c9', 1,  'e88f6b08-1db7-4acc-9d1a-ec283062ed21'),
  ('2564c423-8d22-4dce-8600-9e961b347f92', 1,  '0d25f027-e741-489f-9769-e77a1ad88b39'),
  ('b48fb36d-57c8-4341-88e4-91b958a9e942', 3,  '60c4f225-f684-4cd4-ae60-dbb3c33c91de'),
  ('809cfea4-9eb9-4171-894f-5aafa3348055', 10, 'b3bfbf3b-de3c-411e-86f4-4f8fa0bf0f6d'),
  ('9ae5ac1f-49a5-46e5-91cf-b889f66cc29f', 5,  '14f9c9b2-e543-48ac-aee6-81eba8d75bcf'),
  ('aa9cadba-79d3-4ee1-9512-75060784407f', 4,  'e41f852e-72c4-46c8-823d-68fde46eca2f'),
  ('978b5afa-a822-4ae8-ad82-526ad52d804a', 6,  'fbadce83-1d51-4281-a3c1-ae6c4d81cb8e'),
  ('46c2f41e-2c18-4c4a-9514-f76aa24a61c3', 3,  '1388d44e-8102-44a0-877b-30ce08da625b'),
  ('0e7227a9-eae7-4e86-b3fb-286c5ebf1d4c', 6,  'c2458779-fa73-4ffb-95fb-9dcd4dc41fa7'),
  ('1780edc3-02f5-4303-89bf-ddcda7247a95', 2,  '2dfe43c8-9bc8-46f5-8ef7-43a7de68b256'),
  ('8af87439-b216-4b40-a0ea-5d6316573f77', 4,  'e6e17f56-5bdc-4aaf-9e09-1bd850a88ad1'),
  ('1b205562-ffce-49c9-8a0c-7cbcfa52e7ea', 2,  '65d3ea38-e79b-45f9-9e21-671d30f855e4'),
  ('d7ebdf69-906a-41e4-9f55-1999c16deb02', 6,  '1ca53ec9-001a-4b43-bca3-43768bd2df96'),
  ('626f5d52-ea2b-4333-8938-27208abd44c4', 12, '6c55559f-dc9e-4572-9443-5df11d34c2c6'),
  ('cafd138a-b8ec-4c56-9e90-6e79690389b7', 12, 'f4d79b1a-ccdc-4145-a6d6-f7a26136fc49'),
  ('1093ef7b-97ef-4b93-a813-ac896802e0d1', 12, 'c8d72eb5-8908-4e3d-bbd8-cca2feb64f80'),
  ('bbd96cd7-890a-4f8a-a711-e8d6165edadd', 2,  '82281ea2-0914-4dbe-acae-c7741fe79236'),
  ('bac1c1f0-63cf-4b8c-99f3-904dfad194bd', 12, '451eff5c-5d4d-494b-a151-529eb0196bd6'),
  ('dd06dc25-7e50-4ce4-8c29-2a3fa0d8fb2b', 5,  'bdf16109-fa02-4bb5-9ba0-cba5eafb556c'),
  ('7f485124-22a0-4792-b86c-85c34ec4cef5', 3,  'aebff5aa-238b-45d6-9d04-f7052309cce2'),
  ('e19852d6-1b39-43b0-bb0d-cb3d1df3f5b2', 3,  'eaea3d0b-66b2-421e-9793-e3d82c8b7c28');

-- ---------------------------------------------------------------------
-- 2. Guardas previas
-- ---------------------------------------------------------------------
do $$
declare
  v_laprida uuid;
  v_faltantes text;
begin
  select id into v_laprida from sucursales where nombre = 'Laprida';
  if v_laprida is null then
    raise exception 'No encontré la sucursal Laprida';
  end if;

  select string_agg(sku_id::text, ', ') into v_faltantes
  from envio_laprida e
  where not exists (select 1 from skus s where s.id = e.sku_id);

  if v_faltantes is not null then
    raise exception 'SKU inexistente: %', v_faltantes;
  end if;

  if (select count(*) from envio_laprida) <> 50 then
    raise exception 'Se esperaban 50 SKU en la lista y hay %', (select count(*) from envio_laprida);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Los movimientos: un ajuste positivo por SKU en Laprida
-- ---------------------------------------------------------------------
create temp table aplicados (sku_id uuid primary key, movimiento_id uuid not null);

do $$
declare
  v_laprida uuid;
  v_fila record;
  v_mov movimientos_stock;
begin
  select id into v_laprida from sucursales where nombre = 'Laprida';

  for v_fila in select sku_id, cantidad, mermas from envio_laprida loop
    v_mov := registrar_movimiento(
      p_sku_id         => v_fila.sku_id,
      p_sucursal_id    => v_laprida,
      p_tipo           => 'ajuste',
      p_cantidad       => v_fila.cantidad,
      p_motivo         => 'Entrega a Laprida del 02/11 cargada por error como merma en Olavarría (merma ' || v_fila.mermas || ')',
      p_documento_tipo => null,
      p_documento_id   => null
    );

    insert into aplicados (sku_id, movimiento_id) values (v_fila.sku_id, v_mov.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Autoverificación
-- ---------------------------------------------------------------------
do $$
declare
  v_laprida uuid;
  v_detalle text;
begin
  select id into v_laprida from sucursales where nombre = 'Laprida';

  if (select count(*) from aplicados) <> (select count(*) from envio_laprida) then
    raise exception 'Se esperaban % movimientos y se escribieron %',
      (select count(*) from envio_laprida), (select count(*) from aplicados);
  end if;

  if (select coalesce(sum(m.cantidad), 0) from movimientos_stock m
      join aplicados a on a.movimiento_id = m.id)
     <> (select sum(cantidad) from envio_laprida) then
    raise exception 'Los movimientos no suman las unidades esperadas';
  end if;

  -- La invariante de la casa: el stock de cada SKU tocado tiene que ser
  -- igual a la suma de todos sus movimientos en Laprida.
  select string_agg(format('sku %s: stock %s, movimientos %s', x.sku_id, x.stock, x.suma), E'\n')
  into v_detalle
  from (
    select
      ss.sku_id,
      ss.cantidad as stock,
      (select coalesce(sum(m.cantidad), 0)
         from movimientos_stock m
        where m.sku_id = ss.sku_id and m.sucursal_id = ss.sucursal_id) as suma
    from stock_sucursal ss
    where ss.sku_id in (select sku_id from envio_laprida)
      and ss.sucursal_id = v_laprida
  ) x
  where x.stock <> x.suma;

  if v_detalle is not null then
    raise exception E'El stock no coincide con la suma de sus movimientos:\n%', v_detalle;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- 5. Informe
-- ---------------------------------------------------------------------
select
  s.codigo_interno,
  s.nombre,
  e.cantidad as unidades_acreditadas,
  m.stock_anterior,
  m.stock_posterior,
  u.nombre as registrado_por
from envio_laprida e
join aplicados a on a.sku_id = e.sku_id
join movimientos_stock m on m.id = a.movimiento_id
join skus s on s.id = e.sku_id
left join usuarios u on u.id = m.usuario_id
order by s.nombre;
