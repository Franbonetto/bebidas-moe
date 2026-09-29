-- Mermas: registrar en el momento lo que se rompe, se vence o se consume
-- adentro del local.
--
-- Pedido del usuario 2026-09-28, antes de arrancar la carga inicial: hoy el
-- tipo de movimiento 'merma' existe desde el bloque 3, pero el único camino
-- que lo usa es la devolución de cliente (destino 'merma'). Una botella que
-- se cae en el depósito no tiene dónde anotarse.
--
-- Por qué importa: sin esto, la rotura aparece recién en el próximo
-- inventario como una diferencia sin explicación, indistinguible de un
-- faltante por robo. Con la merma registrada al momento, lo que sobra en el
-- conteo es fuga real y se puede medir. Es la diferencia entre "creo que me
-- roban" y un número.
--
-- Quién: cualquier usuario activo sobre la sucursal que opera
-- (opera_sucursal()). A diferencia de compras o carga inicial, acá NO se
-- pide ve_costos(): el encargado de Laprida es justamente quien ve romperse
-- las botellas de Laprida, y la merma no revela ningún costo.
--
-- Control detectivo, igual que los ajustes de inventario y los precios
-- (arquitectura.md 1.11): se registra sin aprobación previa, pero queda
-- quién, cuándo, cuánto y por qué, y el movimiento es inmutable.

begin;

create table mermas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales (id),
  sku_id uuid not null references skus (id),
  cantidad integer not null check (cantidad > 0),
  -- Lista cerrada a propósito: si el motivo es texto libre, dentro de seis
  -- meses no se puede responder "cuánto perdí por rotura" sin leer a mano.
  motivo text not null check (motivo in ('rotura', 'vencido', 'consumo_interno', 'otro')),
  -- Obligatorio cuando el motivo es 'otro' (si no, 'otro' se vuelve el
  -- cajón donde entra todo y no explica nada).
  detalle text,
  check (motivo <> 'otro' or (detalle is not null and length(trim(detalle)) > 0)),
  usuario_id uuid not null references usuarios (id),
  fecha timestamptz not null default now()
);

create index mermas_sucursal_id_idx on mermas (sucursal_id);
create index mermas_sku_id_idx on mermas (sku_id);
create index mermas_fecha_idx on mermas (fecha);

-- Inmutable, como el resto de los documentos de stock: una merma mal
-- cargada se corrige con un ajuste de inventario, nunca borrando el
-- registro (CLAUDE.md regla 2).

create or replace function bloquear_escritura_directa_mermas()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception
      'Una merma registrada no se edita ni se borra: si se cargó mal, se corrige con un ajuste de inventario';
  end if;

  if coalesce(current_setting('bebidas_moe.merma_en_curso', true), 'off') <> 'on' then
    raise exception 'Las mermas se registran con registrar_merma()';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger mermas_bloquear_escritura_directa
  before insert or update or delete on mermas
  for each row
  execute function bloquear_escritura_directa_mermas();

alter table mermas enable row level security;

-- Lectura: cada uno ve las mermas de las sucursales que opera (el dueño,
-- todas -- opera_sucursal() ya lo resuelve).
create policy mermas_select on mermas for select using (opera_sucursal(sucursal_id));

-- Sin políticas ni grants de escritura: solo la escribe registrar_merma().

-- =========================================================
-- registrar_merma()
-- =========================================================
-- El movimiento de stock y el registro de la merma, en la misma transacción
-- (CLAUDE.md regla 1). No bloquea que el stock quede negativo: el POS ya
-- permite vender sin stock, y si romper una botella deja el stock en -1, ese
-- -1 es información real (el conteo estaba mal) que hay que ver, no
-- esconder.

create or replace function registrar_merma(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_motivo text,
  p_detalle text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merma_id uuid;
  v_detalle text;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para registrar mermas en esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor a cero';
  end if;

  if p_motivo is null or p_motivo not in ('rotura', 'vencido', 'consumo_interno', 'otro') then
    raise exception 'Motivo de merma invalido: %', coalesce(p_motivo, '(vacio)');
  end if;

  v_detalle := nullif(trim(coalesce(p_detalle, '')), '');

  if p_motivo = 'otro' and v_detalle is null then
    raise exception 'Si el motivo es "otro", hay que explicar qué pasó';
  end if;

  if not exists (select 1 from skus where id = p_sku_id and activo = true) then
    raise exception 'El producto no existe o está dado de baja';
  end if;

  perform set_config('bebidas_moe.merma_en_curso', 'on', true);

  insert into mermas (sucursal_id, sku_id, cantidad, motivo, detalle, usuario_id)
  values (p_sucursal_id, p_sku_id, p_cantidad, p_motivo, v_detalle, auth.uid())
  returning id into v_merma_id;

  perform set_config('bebidas_moe.merma_en_curso', 'off', true);

  -- La cantidad va en positivo: el signo lo pone registrar_movimiento()
  -- según el tipo (bloque 3).
  perform registrar_movimiento(
    p_sku_id => p_sku_id,
    p_sucursal_id => p_sucursal_id,
    p_tipo => 'merma',
    p_cantidad => p_cantidad,
    p_motivo => case p_motivo
      when 'rotura' then 'Rotura'
      when 'vencido' then 'Vencido'
      when 'consumo_interno' then 'Consumo interno'
      else 'Otro'
    end || coalesce(': ' || v_detalle, ''),
    p_documento_tipo => 'merma',
    p_documento_id => v_merma_id
  );

  return v_merma_id;
end;
$$;

-- =========================================================
-- Permisos base (CLAUDE.md, notas del entorno)
-- =========================================================
-- mermas es tabla nueva: necesita el select explícito. Sin
-- insert/update/delete: solo la escribe registrar_merma().

grant select on all tables in schema public to authenticated;

commit;
