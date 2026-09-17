-- Agrega 'un' (unidad) y 'g' (gramo) a las unidades de volumen válidas de
-- skus. Hoy solo existían 'ml'/'l', pensados para líquidos -- productos
-- que se venden por unidad o por peso (tabaco, aceites/aceitunas
-- gourmet, regalería) usaban 'ml' como relleno sin significado real
-- (ver supabase/seeds/*tabaco*.sql). Esto habilita cargarlos con una
-- unidad que sí signifique algo.
--
-- Se busca el nombre real de la constraint en vez de asumirlo (incluso si
-- Postgres suele nombrarla skus_unidad_volumen_check) para no romper si
-- en algún momento se renombró.

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'skus'
    and con.contype = 'c'
    and att.attname = 'unidad_volumen';

  if v_constraint_name is not null then
    execute format('alter table skus drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table skus add constraint skus_unidad_volumen_check
  check (unidad_volumen in ('ml', 'l', 'un', 'g'));
