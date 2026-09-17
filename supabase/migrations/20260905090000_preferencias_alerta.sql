-- Preferencias de alerta por usuario (docs/arquitectura.md 1.12: "qué ver,
-- con qué frecuencia"). Esta migracion cubre solo el "que ver" -- ocultar
-- secciones del panel /alertas que no le interesan a ese usuario.
--
-- "Con que frecuencia" queda afuera a proposito: esa parte del requisito
-- describe el resumen automatico diario/semanal, que todavia no existe
-- (no hay canal de envio -- email/push -- ni scheduler en el proyecto).
-- Agregar un selector de frecuencia ahora seria una configuracion sin
-- ningun consumidor real. Se retoma cuando se construya el resumen.
--
-- Categorias = las mismas secciones que ya arma app/(app)/alertas/page.tsx
-- (stock, pedidos_transferencias, ventas_sin_stock, costos, inmovilizado,
-- rentabilidad, envases). Es autoservicio: cada usuario configura las
-- suyas, no el dueño sobre terceros -- 1.12 no menciona supervision.
-- Ausencia de fila = visible (default), asi que ocultar algo es la unica
-- accion que deja rastro, igual que los overrides de precios/recargos.

create table preferencias_alerta (
  usuario_id uuid not null references usuarios (id) on delete cascade,
  categoria text not null check (categoria in (
    'stock', 'pedidos_transferencias', 'ventas_sin_stock', 'costos',
    'inmovilizado', 'rentabilidad', 'envases'
  )),
  visible boolean not null default true,
  primary key (usuario_id, categoria)
);

alter table preferencias_alerta enable row level security;

-- Autoservicio estricto: un usuario solo lee/escribe sus propias filas.
create policy preferencias_alerta_select on preferencias_alerta
  for select using (usuario_id = auth.uid());
create policy preferencias_alerta_insert on preferencias_alerta
  for insert with check (usuario_id = auth.uid());
create policy preferencias_alerta_update on preferencias_alerta
  for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy preferencias_alerta_delete on preferencias_alerta
  for delete using (usuario_id = auth.uid());

-- La app escribe esta tabla directo via RLS (no hay funcion SECURITY
-- DEFINER de por medio: es una preferencia personal, no algo que necesite
-- trazabilidad transaccional), asi que necesita los grants explicitos.
grant select, insert, update, delete on preferencias_alerta to authenticated;
