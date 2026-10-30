-- Pago de boletas de entrada de mercadería y cuenta con el proveedor.
-- Pedido del usuario 2026-10-30, resuelto en el chat antes de escribir esto:
--
--   - El dueño, desde "entrada de mercadería", ve qué boleta cargó la
--     encargada que todavía no abrió ("nueva"), y puede registrarle uno o
--     varios pagos (efectivo o transferencia) hasta cubrirla.
--   - El estado de pago (pagada / parcial / impaga) es SOLO para el dueño:
--     Olavarría no lo ve, aunque vea el resto de la compra.
--   - Si el dueño paga de más en una boleta puntual, el excedente no se
--     pierde: se descuenta solo de la cuenta aparte que se lleva con ese
--     proveedor (ver proveedor_ajustes_cuenta más abajo).
--   - Un pago cargado mal se anula con un motivo obligatorio -- nunca se
--     edita ni se borra, mismo criterio que movimientos_stock.
--   - La "cuenta aparte" con el proveedor (deuda que el dueño carga a mano,
--     por ej. un saldo de antes de usar el sistema, y créditos a favor) es
--     otro ledger inmutable, independiente de las boletas puntuales.
--   - Nada de esto pide PIN: son pantallas privadas del dueño (distinto del
--     PIN de "entrada de mercadería", que es para frenar a la encargada en
--     el mostrador -- acá el que opera ya es el dueño).

begin;

-- =========================================================
-- compras: marca de "boleta nueva" para el dueño
-- =========================================================
-- Mismo criterio que pedidos_compra.visto_en
-- (20260922150000_pedidos_compra_visto_dueno.sql): null hasta que el dueño
-- abre el detalle de esa compra.

alter table compras add column visto_dueno_en timestamptz;

create or replace function marcar_compra_vista(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not es_dueno() then
    raise exception 'Solo el dueño marca sus propias compras como vistas';
  end if;

  update compras set visto_dueno_en = now() where id = p_id and visto_dueno_en is null;
end;
$$;

-- =========================================================
-- compra_pagos: ledger inmutable de pagos de una boleta puntual
-- =========================================================
-- tipo 'pago' = un abono. tipo 'reversa' = anula un 'pago' anterior (nunca
-- se edita ni se borra la fila original): queda referenciado por
-- pago_original_id y lleva motivo obligatorio en nota.

create table compra_pagos (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references compras(id),
  tipo text not null default 'pago' check (tipo in ('pago', 'reversa')),
  monto numeric(12, 2) not null check (monto > 0),
  medio_pago text not null check (medio_pago in ('efectivo', 'transferencia')),
  nota text,
  pago_original_id uuid references compra_pagos(id),
  usuario_id uuid not null references usuarios(id) default auth.uid(),
  fecha timestamptz not null default now(),
  check (
    (tipo = 'pago' and pago_original_id is null)
    or
    (tipo = 'reversa' and pago_original_id is not null
     and nota is not null and length(trim(nota)) > 0)
  )
);

comment on table compra_pagos is
  'Pagos de una boleta puntual a un proveedor. Inmutable: para corregir un pago mal cargado se anula con reversar_pago_compra(), nunca se edita ni se borra.';

-- =========================================================
-- proveedor_ajustes_cuenta: ledger inmutable de la cuenta aparte con el proveedor
-- =========================================================
-- aumento_deuda / credito_a_favor: los carga el dueño a mano, con nota
-- obligatoria (qué es y por qué).
-- excedente_pago / reversa_excedente: los genera el sistema solo, cuando un
-- pago de una boleta puntual se paga de más (o esa reversa se anula).

create table proveedor_ajustes_cuenta (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores(id),
  tipo text not null check (tipo in ('aumento_deuda', 'credito_a_favor', 'excedente_pago', 'reversa_excedente')),
  monto numeric(12, 2) not null check (monto > 0),
  nota text not null check (length(trim(nota)) > 0),
  compra_id uuid references compras(id),
  pago_id uuid references compra_pagos(id),
  usuario_id uuid not null references usuarios(id) default auth.uid(),
  fecha timestamptz not null default now()
);

comment on table proveedor_ajustes_cuenta is
  'Cuenta aparte con el proveedor (fuera de boleta por boleta): deuda cargada a mano, créditos a favor, y el excedente cuando se paga de más una boleta puntual. Inmutable.';

-- =========================================================
-- Totales de una compra (internos: solo los usan las funciones de abajo)
-- =========================================================
-- Mismo cálculo que totalPagadoCompra() en
-- app/(app)/compras/_lib/comprobante.ts: productos + pie de la factura (o
-- flete solo si no hay pie) + flete pagado aparte.

create function calcular_total_a_pagar_compra(p_compra_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
           when c.neto_gravado is null or c.iva is null then round(c.total + coalesce(c.flete, 0), 2)
           else round(
             c.neto_gravado + coalesce(c.impuestos_internos, 0) + c.iva
             + coalesce(c.percepcion_iva, 0) + coalesce(c.percepcion_iibb, 0)
             + coalesce(c.flete, 0),
             2
           )
         end
  from compras c
  where c.id = p_compra_id;
$$;

create function calcular_total_abonado_compra(p_compra_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when tipo = 'pago' then monto else -monto end), 0)
  from compra_pagos
  where compra_id = p_compra_id;
$$;

create function calcular_saldo_pendiente_compra(p_compra_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select calcular_total_a_pagar_compra(p_compra_id) - calcular_total_abonado_compra(p_compra_id);
$$;

revoke execute on function calcular_total_a_pagar_compra(uuid) from public;
revoke execute on function calcular_total_abonado_compra(uuid) from public;
revoke execute on function calcular_saldo_pendiente_compra(uuid) from public;

-- =========================================================
-- registrar_pago_compra(): el dueño abona una boleta
-- =========================================================
-- Si el monto supera el saldo pendiente de esta boleta, el excedente no se
-- pierde: se registra solo como excedente_pago en la cuenta del proveedor
-- (resta de lo que se le debe en general), y esta boleta queda cubierta
-- justo con su saldo.

create function registrar_pago_compra(
  p_compra_id uuid,
  p_monto numeric,
  p_medio_pago text,
  p_nota text default null
)
returns compra_pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proveedor_id uuid;
  v_numero_factura text;
  v_saldo numeric;
  v_monto_boleta numeric;
  v_excedente numeric;
  v_pago_id uuid;
  v_resultado compra_pagos;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not es_dueno() then
    raise exception 'Solo el dueño registra pagos de boletas';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor a cero';
  end if;

  if p_medio_pago not in ('efectivo', 'transferencia') then
    raise exception 'El medio de pago tiene que ser efectivo o transferencia';
  end if;

  select proveedor_id, numero_factura into v_proveedor_id, v_numero_factura
  from compras where id = p_compra_id for update;

  if not found then
    raise exception 'La boleta no existe';
  end if;

  v_saldo := calcular_saldo_pendiente_compra(p_compra_id);

  if v_saldo <= 0 then
    raise exception 'Esta boleta ya está pagada';
  end if;

  v_monto_boleta := least(p_monto, v_saldo);
  v_excedente := round(p_monto - v_monto_boleta, 2);

  insert into compra_pagos (compra_id, tipo, monto, medio_pago, nota, usuario_id)
  values (p_compra_id, 'pago', v_monto_boleta, p_medio_pago, nullif(trim(coalesce(p_nota, '')), ''), auth.uid())
  returning id into v_pago_id;

  if v_excedente > 0 then
    insert into proveedor_ajustes_cuenta (proveedor_id, tipo, monto, nota, compra_id, pago_id, usuario_id)
    values (
      v_proveedor_id, 'excedente_pago', v_excedente,
      'Excedente del pago de la boleta ' || coalesce(v_numero_factura, '(sin número)'),
      p_compra_id, v_pago_id, auth.uid()
    );
  end if;

  select * into v_resultado from compra_pagos where id = v_pago_id;
  return v_resultado;
end;
$$;

-- =========================================================
-- reversar_pago_compra(): anular un pago cargado mal
-- =========================================================
-- No edita ni borra el pago original: agrega una fila 'reversa' que lo
-- referencia, con motivo obligatorio. Si ese pago había generado un
-- excedente en la cuenta del proveedor, también se revierte ese excedente.

create function reversar_pago_compra(p_pago_id uuid, p_motivo text)
returns compra_pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago compra_pagos;
  v_ajuste proveedor_ajustes_cuenta;
  v_reversa_id uuid;
  v_resultado compra_pagos;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not es_dueno() then
    raise exception 'Solo el dueño anula pagos de boletas';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Hay que escribir por qué se anula este pago';
  end if;

  select * into v_pago from compra_pagos where id = p_pago_id for update;
  if not found or v_pago.tipo <> 'pago' then
    raise exception 'El pago no existe o ya es una anulación';
  end if;

  if exists (select 1 from compra_pagos where pago_original_id = p_pago_id) then
    raise exception 'Ese pago ya fue anulado';
  end if;

  insert into compra_pagos (compra_id, tipo, monto, medio_pago, nota, pago_original_id, usuario_id)
  values (v_pago.compra_id, 'reversa', v_pago.monto, v_pago.medio_pago, trim(p_motivo), p_pago_id, auth.uid())
  returning id into v_reversa_id;

  select * into v_ajuste from proveedor_ajustes_cuenta
  where pago_id = p_pago_id and tipo = 'excedente_pago'
  limit 1;

  if found then
    insert into proveedor_ajustes_cuenta (proveedor_id, tipo, monto, nota, compra_id, pago_id, usuario_id)
    values (
      v_ajuste.proveedor_id, 'reversa_excedente', v_ajuste.monto,
      'Reversa del excedente por pago anulado: ' || trim(p_motivo),
      v_ajuste.compra_id, p_pago_id, auth.uid()
    );
  end if;

  select * into v_resultado from compra_pagos where id = v_reversa_id;
  return v_resultado;
end;
$$;

-- =========================================================
-- registrar_ajuste_cuenta_proveedor(): deuda a mano o crédito a favor
-- =========================================================
-- Solo estos dos tipos se cargan a mano -- excedente_pago y
-- reversa_excedente los genera el sistema desde las funciones de arriba.

create function registrar_ajuste_cuenta_proveedor(
  p_proveedor_id uuid,
  p_tipo text,
  p_monto numeric,
  p_nota text
)
returns proveedor_ajustes_cuenta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado proveedor_ajustes_cuenta;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not es_dueno() then
    raise exception 'Solo el dueño registra ajustes de cuenta con el proveedor';
  end if;

  if p_tipo not in ('aumento_deuda', 'credito_a_favor') then
    raise exception 'Tipo de ajuste inválido';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor a cero';
  end if;

  if p_nota is null or length(trim(p_nota)) = 0 then
    raise exception 'Hay que escribir una nota: qué es y por qué';
  end if;

  if not exists (select 1 from proveedores where id = p_proveedor_id) then
    raise exception 'El proveedor no existe';
  end if;

  insert into proveedor_ajustes_cuenta (proveedor_id, tipo, monto, nota, usuario_id)
  values (p_proveedor_id, p_tipo, p_monto, trim(p_nota), auth.uid())
  returning * into v_resultado;

  return v_resultado;
end;
$$;

-- =========================================================
-- RLS
-- =========================================================
-- Solo el dueño ve esto (decisión del usuario 2026-10-30: el estado de pago
-- es privado del dueño, Olavarría no lo ve). Sin políticas de insert -- las
-- cuatro funciones de arriba son SECURITY DEFINER y escriben sin pasar por
-- RLS; nadie más tiene otro camino para escribir estas tablas.

alter table compra_pagos enable row level security;
alter table proveedor_ajustes_cuenta enable row level security;

create policy compra_pagos_select on compra_pagos for select using (es_dueno());
create policy proveedor_ajustes_cuenta_select on proveedor_ajustes_cuenta for select using (es_dueno());

-- =========================================================
-- Permisos
-- =========================================================
-- Tablas nuevas: solo select (las escriben las funciones SECURITY DEFINER,
-- que no necesitan grant de insert/update/delete).

grant select on all tables in schema public to authenticated;

commit;
