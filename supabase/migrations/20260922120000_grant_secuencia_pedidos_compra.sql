-- Fix: a pedidos_compra (bloque 9, 20260909090000) le faltó el grant de la
-- secuencia que usa generar_numero_pedido_compra() para armar el número
-- PC-XXXX -- su hermano pedidos_numero_seq (bloque 7) sí lo tiene. Sin este
-- grant, cualquier insert en pedidos_compra falla con "permission denied
-- for sequence pedidos_compra_numero_seq" (encontrado 2026-09-22 al probar
-- "Nuevo pedido de compra" como encargada: la función nunca llegó a
-- funcionar desde que se creó).
--
-- generar_numero_pedido_compra() no es SECURITY DEFINER (no necesita
-- saltarse RLS, solo generar el número), así que corre con los permisos
-- de quien hace el insert -- por eso hace falta el grant explícito acá,
-- mismo criterio que pedidos_numero_seq.

grant usage on sequence pedidos_compra_numero_seq to authenticated;
