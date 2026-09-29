-- Carga inicial de stock: el arranque del sistema en cada sucursal.
--
-- Pedido del usuario 2026-09-28: va a contar el depósito y el local con el
-- negocio abierto, producto por producto, cargando cantidad, costo y precio
-- desde el celular.
--
-- Por qué una función propia y no los dos caminos que ya existen:
--
--   - cargar_compra_directa() exige proveedor y comprobante, y dejaría todo
--     el stock inicial registrado como una compra que nunca existió: le
--     mentiría al historial de compras y al Balance de IVA (aparecería como
--     compra en negro del mes de arranque).
--   - El inventario físico exige contar TODOS los SKU del alcance antes de
--     poder cerrarlo, pide un motivo de una lista fija por cada diferencia,
--     no deja cargar costo ni precio, y no incluye los productos creados
--     después de abrirlo. Nada de eso sirve para una carga que se hace de a
--     un producto por vez a lo largo de varios días.
--
-- Lo que SÍ se reusa: registrar_movimiento(), o sea que la carga inicial no
-- inventa ninguna forma nueva de mover stock (CLAUDE.md regla 1: si no hay
-- movimiento, no hay cambio de stock).
--
-- Decisión de negocio confirmada con el usuario 2026-09-28: la cantidad que
-- se carga es el TOTAL CONTADO en esa sucursal, no un incremento. Cargar dos
-- veces el mismo SKU corrige, no duplica -- es el error más probable después
-- de dos horas contando ("¿este ya lo cargué?"). El ajuste que se registra
-- es la diferencia contra lo que el sistema tenía en ese momento.

begin;

-- =========================================================
-- cargas_iniciales: el documento al que apuntan los movimientos
-- =========================================================
-- Una por sucursal. movimientos_stock exige que documento_tipo y
-- documento_id vayan juntos (check del bloque 3), así que la carga inicial
-- necesita un documento real al cual referirse -- igual que una recepción o
-- un inventario. De paso queda el dato de cuándo arrancó cada sucursal y
-- quién la cargó.

create table cargas_iniciales (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null unique references sucursales (id),
  iniciada_en timestamptz not null default now(),
  iniciada_por uuid not null references usuarios (id)
);

alter table cargas_iniciales enable row level security;

create policy cargas_iniciales_select on cargas_iniciales for select using (usuario_activo());

-- Sin políticas ni grants de escritura: solo la crea cargar_stock_inicial()
-- (SECURITY DEFINER), igual que el resto de los documentos de stock.

-- =========================================================
-- cargar_stock_inicial()
-- =========================================================
-- Deja el stock de ese SKU en esa sucursal en la cantidad contada, y de paso
-- actualiza el costo si se lo pasan. El precio de venta NO se toca acá: lo
-- guarda la app con guardarPrecioBase() (tabla precios, que ya tiene su
-- propia trazabilidad de quién lo cargó y cuándo desde el bloque 5).
--
-- Quién: ve_costos() -- el dueño incluido, a diferencia de las compras. Acá
-- el dueño no es un espectador: la carga inicial la hace él en las dos
-- sucursales. El encargado de Laprida queda afuera porque la carga incluye
-- el costo, que no ve (CLAUDE.md, matriz de roles).

create or replace function cargar_stock_inicial(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_costo numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga_id uuid;
  v_stock_actual integer;
  v_delta integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para cargar el stock inicial';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para cargar stock en esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad contada no puede ser negativa';
  end if;

  if p_costo is not null and p_costo < 0 then
    raise exception 'El costo no puede ser negativo';
  end if;

  if not exists (select 1 from skus where id = p_sku_id and activo = true) then
    raise exception 'El producto no existe o está dado de baja';
  end if;

  -- El documento de la sucursal se crea la primera vez y se reusa siempre.
  select id into v_carga_id from cargas_iniciales where sucursal_id = p_sucursal_id;
  if v_carga_id is null then
    insert into cargas_iniciales (sucursal_id, iniciada_por)
    values (p_sucursal_id, auth.uid())
    returning id into v_carga_id;
  end if;

  select coalesce(cantidad, 0) into v_stock_actual
  from stock_sucursal
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id;

  v_stock_actual := coalesce(v_stock_actual, 0);
  v_delta := p_cantidad - v_stock_actual;

  -- Sin diferencia no hay movimiento: recargar el mismo número dos veces no
  -- ensucia el historial. El costo sí se actualiza igual (puede ser
  -- justamente lo que vino a corregir).
  if v_delta <> 0 then
    perform registrar_movimiento(
      p_sku_id => p_sku_id,
      p_sucursal_id => p_sucursal_id,
      p_tipo => 'ajuste',
      p_cantidad => v_delta,
      p_motivo => 'Carga inicial de stock',
      p_documento_tipo => 'carga_inicial',
      p_documento_id => v_carga_id
    );
  end if;

  if p_costo is not null then
    update skus set costo_actual = p_costo where id = p_sku_id;
  end if;

  return p_cantidad;
end;
$$;

-- =========================================================
-- Permisos base (CLAUDE.md, notas del entorno)
-- =========================================================
-- cargas_iniciales es tabla nueva: necesita el select explícito. Sin
-- insert/update/delete: solo la escribe cargar_stock_inicial().

grant select on all tables in schema public to authenticated;

commit;
