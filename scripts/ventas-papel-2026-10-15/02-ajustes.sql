-- =====================================================================
-- Ventas en papel del 2026-10-15 (Olavarría) — PASO 2: APLICAR
-- =====================================================================
-- Descuenta del stock de Olavarría las 64 líneas que se vendieron en
-- mostrador y se anotaron en papel: un movimiento de ajuste por línea,
-- 166 unidades en total.
--
-- Se pega entero en el SQL Editor y se corre de una. Resuelve los nombres
-- solo, se verifica solo y commitea solo. Al final imprime un informe de
-- las 64 líneas con el stock antes y después de cada una.
--
-- Si preferís mirar antes de aplicar: corré `01-diagnostico.sql`, que es
-- solo lectura y muestra qué SKU va a elegir para cada nombre.
--
-- Cómo trabaja:
--   * El stock se toca solo con registrar_movimiento() (regla 1). No se
--     desactiva ningún trigger ni se escribe stock_sucursal a mano.
--   * Tipo `ajuste` con motivo "Venta en papel del 2026-10-15", que es lo
--     que la regla 2 define para corregir stock. No crea ventas, ni caja,
--     ni comprobantes: el pedido era descontar stock, nada más.
--   * Todo en una transacción. Cualquier guarda que no cierre aborta el
--     script entero y no escribe nada.
--   * Si una línea no se puede resolver, las demás se aplican igual y el
--     informe la marca como NO ENCONTRADO. Nada queda a medias sin que se
--     vea.
--
-- Para deshacer una línea mal descontada, un ajuste al revés — nunca
-- borrando el movimiento (regla 2).
--
-- Por qué impersona al dueño: registrar_movimiento() exige
-- usuario_activo() y guarda auth.uid() en el movimiento. Desde el SQL
-- Editor no hay sesión, así que se fija el claim igual que en los seeds
-- del catálogo (supabase/seeds/21_laprida_vinos_tintos.sql). Los
-- movimientos quedan atribuidos a una persona real, no a nadie.
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
-- 1. La lista del papel
-- ---------------------------------------------------------------------
create temp table papel (orden int primary key, nombre text not null, cantidad int not null);

insert into papel (orden, nombre, cantidad) values
  ( 1, '1890 lata 473ml',                      10),
  ( 2, 'Alma Mora Malbec',                      6),
  ( 3, 'Andes IPA',                             6),
  ( 4, 'Andes Roja lata 473ml',                 4),
  ( 5, 'Brahma lata 473ml',                    12),
  ( 6, 'Budweiser 1 litro',                     1),
  ( 7, 'Campari 750ml',                         1),
  ( 8, 'Cepita 1 litro',                        2),
  ( 9, 'Chateau Subsónico Malbec Cabernet',     1),
  (10, 'Coca Cola 3 litros',                    3),
  (11, 'Cordero Malbec',                        1),
  (12, 'Corona 330ml',                          6),
  (13, 'Cynar 70',                              1),
  (14, 'Cynar clásico',                         1),
  (15, 'DV Catena Pinot-Pinot',                 1),
  (16, 'Esperado Syrah Malbec',                 1),
  (17, 'Etchart Privado Torrontés',             1),
  (18, 'Fausto Malbec',                         3),
  (19, 'Fernet Branca 750ml',                   1),
  (20, 'Fernet Branca 1 litro',                 2),
  (21, 'Fernet Branca Menta 450ml',             1),
  (22, 'Fuego Negro Petit Verdot',              1),
  (23, 'Gancia 1 litro',                        2),
  (24, 'Gold Label 200 Years',                  1),
  (25, 'Gold Label Reserve',                    1),
  (26, 'Grant''s Whisky 1 litro',               1),
  (27, 'Heineken lata 473ml',                   4),
  (28, 'Heineken pack x6 473ml',                2),
  (29, 'Heineken 710ml',                        1),
  (30, 'Heineken 1 litro',                      8),
  (31, 'Hijos Red Wine',                        1),
  (32, 'Imperial IPA 1 litro',                  1),
  (33, 'Imperial Lager 1 litro',                1),
  (34, 'Johnnie Walker Black Label 750ml',      2),
  (35, 'La Scala licor de dulce de leche',      1),
  (36, 'Las Perdices Malbec',                   2),
  (37, 'Los Bocheros Malbec',                   1),
  (38, 'Los Bocheros Red Blend',                1),
  (39, 'Monster Peachy Keen',                   1),
  (40, 'Monster Ultra',                         1),
  (41, 'Mula IPA botella',                      1),
  (42, 'New Age',                               1),
  (43, 'Pájaros Argentinos Malbec',             1),
  (44, 'Peroni',                                1),
  (45, 'Perro Callejero Pinot Noir',            2),
  (46, 'Portillo Malbec',                       3),
  (47, 'Privado Reserva Cabernet Franc',        1),
  (48, 'Privado Reserva Cabernet Sauvignon',    1),
  (49, 'Privado Reserva Tempranillo',           2),
  (50, 'Salentein Extra Brut',                  2),
  (51, 'Santa Julia Chenin Dulce',              2),
  (52, 'Santa Julia Tintillo',                  1),
  (53, 'Schneider 473ml pack x6',               1),
  (54, 'Schneider 710ml',                       2),
  (55, 'Schweppes clásica 1.5 litros',          1),
  (56, 'Schweppes Tónica 1.5 litros',           1),
  (57, 'Smirnoff clásico',                      2),
  (58, 'Speed 473ml',                           6),
  (59, 'Stella Artois lata 473ml',             12),
  (60, 'Stella Artois porrón 330ml',            8),
  (61, 'Trumpeter Chardonnay',                  1),
  (62, 'Trumpeter Malbec',                     12),
  (63, 'Trumpeter Reserva Malbec',              3),
  (64, 'Whyte & Mackay Whisky 700ml',           1);

-- ---------------------------------------------------------------------
-- 2. Elecciones manuales (opcional)
-- ---------------------------------------------------------------------
-- Si el informe mostró que una línea eligió el SKU equivocado, se fuerza
-- acá con su código interno y se vuelve a correr. Lo que esté en esta
-- tabla le gana al match automático. Vacía está bien: el script resuelve
-- las 64 líneas por su cuenta.

create temp table elecciones (orden int primary key, codigo_interno text not null);

-- insert into elecciones (orden, codigo_interno) values
--   (62, 'VINO-TRUMPETER-MALBEC-750');

-- ---------------------------------------------------------------------
-- 3. Resolución nombre en papel -> SKU
-- ---------------------------------------------------------------------
-- La lista está escrita en el idioma del mostrador ("Fernet Branca 1
-- litro") y el catálogo en el del sistema ("Fernet Branca 1000cc"), así
-- que el match es por palabras: se normalizan los dos lados, se cuentan
-- las palabras del papel que aparecen en marca + producto + nombre del
-- SKU, y suman un punto el volumen coincidente y la presentación
-- coincidente. Gana el de más puntaje.
--
-- Si dos empatan en puntaje, el desempate es, en orden:
--   1. Si el papel no dice "pack" ni "x6", gana la unidad suelta. Una
--      línea de mostrador sin aclaración es una unidad, no un pack.
--   2. Gana el que tiene stock contado en Olavarría. Lo que se vendió
--      estaba en la góndola.
--   3. Gana el nombre más corto, o sea el que no agrega palabras que el
--      papel no tiene: "Trumpeter Malbec" es Trumpeter Malbec, no
--      Trumpeter Reserva Malbec.
--   4. Por código interno, para que el resultado sea siempre el mismo.
-- El informe final marca cada línea que se decidió por desempate.

create temp table resueltos (
  orden int primary key,
  sku_id uuid not null,
  cantidad int not null,
  origen text not null
);

with norm as (
  select
    p.orden,
    p.nombre,
    p.cantidad,
    btrim(regexp_replace(regexp_replace(
      regexp_replace(
        translate(lower(p.nombre), 'áéíóúàèìòùäëïöüñç', 'aeiouaeiouaeiounc'),
        '[^a-z0-9.]+', ' ', 'g'
      ),
      '([0-9])([a-z])', '\1 \2', 'g'),
      '([a-z])([0-9])', '\1 \2', 'g'
    )) as n
  from papel p
),

vol as (
  select
    n.orden,
    coalesce(
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:ml|cc)(?: |$)'))::numeric,
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:l|lt|litro|litros)(?: |$)'))::numeric * 1000
    ) as vol_ml,
    coalesce(
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:ml|cc)(?: |$)'))::numeric,
      (substring(n.n from '([0-9]+(?:\.[0-9]+)?) ?(?:l|lt|litro|litros)(?: |$)'))::numeric
    ) as vol_escrito
  from norm n
),

pres as (
  select
    n.orden,
    case
      when n.n ~ '(pack|x [0-9])'              then 'pack'
      when n.n ~ '(lata|latas|porron|botella)' then 'unidad'
      else null
    end as pres_papel
  from norm n
),

tokens as (
  select n.orden, t.tok
  from norm n
  left join vol v on v.orden = n.orden
  cross join lateral unnest(string_to_array(n.n, ' ')) as t(tok)
  where t.tok <> ''
    -- Se va solo el número del volumen. Los demás números son nombre
    -- (1890, Cynar 70, Gold Label 200) o cantidad de pack (x6 -> 6).
    and not coalesce(
      t.tok ~ '^[0-9]+(\.[0-9]+)?$' and t.tok::numeric = v.vol_escrito,
      false
    )
    and t.tok not in (
      'l', 'lt', 'litro', 'litros', 'ml', 'cc',
      'lata', 'latas', 'pack', 'packs', 'porron', 'porrones',
      'botella', 'botellas', 'x', 'de', 'del', 'la', 'el', 'y',
      'whisky', 'licor', 'vino'
    )
),

tok_tot as (
  select orden, count(*) as total from tokens group by orden
),

cand as (
  select
    s.id,
    s.codigo_interno,
    s.tipo_presentacion,
    case when s.unidad_volumen = 'l' then s.volumen * 1000 else s.volumen end as vol_ml_sku,
    btrim(regexp_replace(regexp_replace(
      regexp_replace(
        translate(lower(m.nombre || ' ' || p.nombre || ' ' || s.nombre),
                  'áéíóúàèìòùäëïöüñç', 'aeiouaeiouaeiounc'),
        '[^a-z0-9.]+', ' ', 'g'
      ),
      '([0-9])([a-z])', '\1 \2', 'g'),
      '([a-z])([0-9])', '\1 \2', 'g'
    )) as h
  from skus s
  join productos p on p.id = s.producto_id
  join marcas m on m.id = p.marca_id
),

puntajes as (
  select t.orden, c.id, count(*) as score
  from tokens t
  join cand c on position(t.tok in c.h) > 0
  group by t.orden, c.id
),

-- Se exige al menos la mitad de las palabras del papel.
rankeados as (
  select
    pj.orden,
    pj.id,
    pj.score
      + case when v.vol_ml is not null and c.vol_ml_sku = v.vol_ml then 1 else 0 end
      + case when pr.pres_papel is not null and c.tipo_presentacion = pr.pres_papel then 1 else 0 end
      as puntaje,
    pr.pres_papel,
    c.tipo_presentacion,
    c.codigo_interno,
    length(c.h) as largo,
    (ss.cantidad is not null) as tiene_stock
  from puntajes pj
  join tok_tot tt on tt.orden = pj.orden
  join cand c on c.id = pj.id
  left join vol v on v.orden = pj.orden
  left join pres pr on pr.orden = pj.orden
  left join stock_sucursal ss
    on ss.sku_id = c.id
   and ss.sucursal_id = (select id from sucursales where es_central limit 1)
  where pj.score >= greatest(1, ceil(tt.total / 2.0))
),

con_rank as (
  select
    rk.*,
    dense_rank() over (partition by rk.orden order by rk.puntaje desc) as posicion
  from rankeados rk
),

-- Entre los de mayor puntaje, el desempate documentado arriba.
elegido as (
  select
    cr.orden,
    cr.id,
    count(*) over (partition by cr.orden) as empatados,
    row_number() over (
      partition by cr.orden
      order by
        case when cr.pres_papel is null and cr.tipo_presentacion = 'unidad' then 0 else 1 end,
        case when cr.tiene_stock then 0 else 1 end,
        cr.largo,
        cr.codigo_interno
    ) as rn
  from con_rank cr
  where cr.posicion = 1
)

insert into resueltos (orden, sku_id, cantidad, origen)
select
  p.orden,
  coalesce(se.id, el.id),
  p.cantidad,
  case
    when se.id is not null     then 'eleccion manual'
    when el.empatados > 1      then 'desempate entre ' || el.empatados || ' candidatos'
    else                            'match unico'
  end
from papel p
left join elecciones e on e.orden = p.orden
left join skus se on se.codigo_interno = e.codigo_interno
left join elegido el on el.orden = p.orden and el.rn = 1
where coalesce(se.id, el.id) is not null;

-- ---------------------------------------------------------------------
-- 4. Guardas previas a escribir
-- ---------------------------------------------------------------------
do $$
declare
  v_detalle text;
begin
  -- 4.1 Un código interno escrito en ELECCIONES que no existe: es un
  --     error de tipeo, y aplicar "casi todo" sería peor que no aplicar.
  select string_agg(format('linea %s -> %s', e.orden, e.codigo_interno), E'\n' order by e.orden)
  into v_detalle
  from elecciones e
  left join skus s on s.codigo_interno = e.codigo_interno
  where s.id is null;

  if v_detalle is not null then
    raise exception E'Codigo interno inexistente en ELECCIONES:\n%', v_detalle;
  end if;

  -- 4.2 Nada que aplicar: no tiene sentido seguir.
  if (select count(*) from resueltos) = 0 then
    raise exception 'No se resolvio ninguna linea: revisa que el catalogo este cargado';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Los movimientos
-- ---------------------------------------------------------------------
-- Un ajuste negativo por línea. La cantidad va firmada porque 'ajuste' es
-- el único tipo de movimiento donde el signo lo decide quien llama.
create temp table aplicados (orden int primary key, movimiento_id uuid not null);

do $$
declare
  v_sucursal uuid;
  v_fila record;
  v_mov movimientos_stock;
begin
  select id into v_sucursal from sucursales where es_central limit 1;

  if v_sucursal is null then
    raise exception 'No encontre la sucursal central';
  end if;

  for v_fila in select orden, sku_id, cantidad from resueltos order by orden loop
    v_mov := registrar_movimiento(
      p_sku_id         => v_fila.sku_id,
      p_sucursal_id    => v_sucursal,
      p_tipo           => 'ajuste',
      p_cantidad       => -v_fila.cantidad,
      p_motivo         => 'Venta en papel del 2026-10-15',
      p_documento_tipo => null,
      p_documento_id   => null
    );

    insert into aplicados (orden, movimiento_id) values (v_fila.orden, v_mov.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Autoverificación
-- ---------------------------------------------------------------------
do $$
declare
  v_detalle text;
begin
  -- 6.1 Un movimiento por línea resuelta, ni uno más ni uno menos.
  if (select count(*) from aplicados) <> (select count(*) from resueltos) then
    raise exception 'Se resolvieron % lineas y se escribieron % movimientos',
      (select count(*) from resueltos), (select count(*) from aplicados);
  end if;

  -- 6.2 Los movimientos descuentan exactamente las unidades de la lista.
  if (select coalesce(sum(m.cantidad), 0) from movimientos_stock m
      join aplicados a on a.movimiento_id = m.id)
     <> -(select sum(cantidad) from resueltos) then
    raise exception 'Los movimientos no descuentan las unidades esperadas (% vs %)',
      (select coalesce(sum(m.cantidad), 0) from movimientos_stock m
       join aplicados a on a.movimiento_id = m.id),
      -(select sum(cantidad) from resueltos);
  end if;

  -- 6.3 El stock de cada SKU tocado sigue siendo igual a la suma de todos
  --     sus movimientos. Es la invariante de la casa: si esto no cierra,
  --     algo escribió stock por fuera de registrar_movimiento().
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
    where ss.sku_id in (select sku_id from resueltos)
      and ss.sucursal_id = (select id from sucursales where es_central limit 1)
  ) x
  where x.stock <> x.suma;

  if v_detalle is not null then
    raise exception E'El stock no coincide con la suma de sus movimientos:\n%', v_detalle;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- 7. Informe
-- ---------------------------------------------------------------------
-- Una fila por línea del papel.
--   ESTADO:     DESCONTADO, o NO ENCONTRADO si no hubo SKU que le
--               corresponda (esa línea no se tocó, el resto sí).
--   COMO:       match unico / desempate entre N candidatos / eleccion
--               manual. Las de desempate son las que conviene mirar.
--   AVISO:      QUEDA EN NEGATIVO, cuando el SKU nunca se contó y el
--               descuento lo dejó bajo cero. Es real: la mercadería
--               salió. Se corrige contándolo, no borrando el movimiento.
--   REPETIDO:   dos líneas del papel cayeron en el mismo SKU, así que ese
--               SKU se descontó dos veces. Puede estar bien (el mismo
--               producto anotado dos veces) o ser un match equivocado.
with informe as (
  select
    p.orden,
    p.nombre,
    p.cantidad,
    r.origen,
    r.sku_id,
    a.orden as aplicada,
    m.stock_anterior,
    m.stock_posterior,
    m.usuario_id
  from papel p
  left join resueltos r on r.orden = p.orden
  left join aplicados a on a.orden = p.orden
  left join movimientos_stock m on m.id = a.movimiento_id
)
select
  i.orden,
  i.nombre                                   as nombre_en_papel,
  case when i.aplicada is null then 'NO ENCONTRADO' else 'DESCONTADO' end as estado,
  i.origen                                   as como,
  s.codigo_interno,
  s.nombre                                   as sku,
  i.cantidad                                 as unidades,
  i.stock_anterior,
  i.stock_posterior,
  case when i.stock_posterior < 0 then 'QUEDA EN NEGATIVO' else '' end as aviso,
  case
    when i.sku_id is not null
     and count(*) over (partition by i.sku_id) > 1
    then 'REPETIDO - mirar'
    else ''
  end                                        as repetido,
  u.nombre                                   as registrado_por
from informe i
left join skus s on s.id = i.sku_id
left join usuarios u on u.id = i.usuario_id
order by
  case when i.aplicada is null then 0 else 1 end,
  case when i.origen like 'desempate%' then 0 else 1 end,
  i.orden;
