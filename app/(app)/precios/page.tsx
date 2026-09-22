import { createClient } from "@/lib/supabase/server";
import { veCostos, esDueno } from "@/lib/permisos";
import { calcularPrecioVenta, type SkuParaPrecio, type SucursalParaPrecio } from "@/lib/precios";
import { PreciosTable, type PrecioSkuRow, type Sucursal, type Categoria } from "./_components/precios-table";
import { RecargosCategoriaPanel } from "./_components/recargos-categoria-panel";
import { RecargosSkuPanel } from "./_components/recargos-sku-panel";
import { DescuentosEfectivoPanel } from "./_components/descuentos-efectivo-panel";
import { PromocionesPanel, type PromocionRow } from "./_components/promociones-panel";
import type { PromocionSkuOpcion } from "./_components/promocion-form";
import { PreciosTabs } from "./_components/precios-tabs";

type SkuFila = {
  id: string;
  nombre: string;
  codigo_interno: string;
  codigo_barras: string | null;
  tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
  cascada_cerveza_lata: boolean;
  costo_actual: number | null;
  producto: {
    id: string;
    nombre: string;
    categoria_id: string;
    marca: { nombre: string } | null;
    categoria: { nombre: string } | null;
  } | null;
};

export default async function PreciosPage() {
  const supabase = await createClient();
  const puedeVerCostos = await veCostos(supabase);
  // Cargar precios (precios/precios_sucursal) es ve_costos() (dueño +
  // encargado Olavarría) desde la correccion del bloque 5 -- control
  // detectivo, mismo criterio que los ajustes de inventario (CLAUDE.md,
  // docs/arquitectura.md 1.11). Los paneles de politica de precios
  // (recargos por categoria/SKU, descuento por efectivo) siguen exclusivos
  // del dueño: son decisiones de politica, no la carga operativa de un
  // precio puntual.
  const puedeEditarPrecios = puedeVerCostos;
  const puedeEditarPoliticas = await esDueno(supabase);

  const [{ data: sucursales }, { data: categorias }, { data: skusRaw }, { data: precios }, { data: preciosSucursal }] =
    await Promise.all([
      supabase.from("sucursales").select("id, nombre, es_central").eq("activo", true).order("es_central", { ascending: false }),
      supabase.from("categorias").select("id, nombre, categoria_padre_id").eq("activo", true),
      supabase
        .from("skus")
        .select(
          `id, nombre, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           cascada_cerveza_lata, costo_actual,
           producto:productos ( id, nombre, categoria_id, marca:marcas ( nombre ), categoria:categorias ( nombre ) )`,
        )
        .eq("activo", true),
      supabase.from("precios").select("sku_id, precio_base, actualizado_en"),
      supabase.from("precios_sucursal").select("sucursal_id, sku_id, precio_override, actualizado_en"),
    ]);

  const [{ data: recargosSucursal }, { data: recargosSku }, { data: descuentosEfectivo }, { data: promocionesRaw }] =
    puedeVerCostos
      ? await Promise.all([
          supabase.from("recargos_sucursal").select("sucursal_id, categoria_id, monto_fijo, actualizado_en"),
          supabase.from("recargos_sku").select("sucursal_id, sku_id, monto_fijo, actualizado_en"),
          supabase.from("descuentos_efectivo").select("sucursal_id, categoria_id, porcentaje, actualizado_en"),
          supabase
            .from("promociones")
            .select(
              "id, nombre, tipo, sucursal_id, vigente_desde, vigente_hasta, activo, promocion_items ( sku_id, cantidad_requerida, precio_promocional )",
            )
            .order("nombre"),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const sucursalesList = (sucursales ?? []) as Sucursal[];
  const categoriasList = (categorias ?? []) as Categoria[];
  const skusList = (skusRaw ?? []) as unknown as SkuFila[];

  const precioBasePorSku = new Map<string, number>();
  for (const p of precios ?? []) precioBasePorSku.set(p.sku_id, p.precio_base);

  const overridePorClave = new Map<string, number>();
  for (const p of preciosSucursal ?? []) overridePorClave.set(`${p.sucursal_id}:${p.sku_id}`, p.precio_override);

  const recargoCategoriaPorClave = new Map<string, number>();
  for (const r of recargosSucursal ?? []) recargoCategoriaPorClave.set(`${r.sucursal_id}:${r.categoria_id}`, r.monto_fijo);

  const recargoSkuPorClave = new Map<string, number>();
  for (const r of recargosSku ?? []) recargoSkuPorClave.set(`${r.sucursal_id}:${r.sku_id}`, r.monto_fijo);

  const descuentoPorClave = new Map<string, number>();
  for (const d of descuentosEfectivo ?? []) descuentoPorClave.set(`${d.sucursal_id}:${d.categoria_id}`, d.porcentaje);

  // Costo del x24 por familia (producto_id): solo para el aviso de "por
  // debajo de costo" -- la base real de la cascada es el precio de venta
  // cargado a mano (2026-09-22, ver lib/precios.ts).
  const costoX24PorProducto = new Map<string, number | null>();
  const precioVentaX24PorProducto = new Map<string, number | null>();
  for (const s of skusList) {
    if (s.cascada_cerveza_lata && s.unidades_contenidas === 24 && s.producto) {
      costoX24PorProducto.set(s.producto.id, s.costo_actual);
      precioVentaX24PorProducto.set(s.producto.id, precioBasePorSku.get(s.id) ?? null);
    }
  }

  function calcularParaSucursal(sku: SkuFila, sucursal: Sucursal) {
    const categoriaId = sku.producto?.categoria_id ?? "";
    const skuParaPrecio: SkuParaPrecio = {
      id: sku.id,
      categoriaId,
      unidadesContenidas: sku.unidades_contenidas,
      cascadaCervezaLata: sku.cascada_cerveza_lata,
    };
    const sucursalParaPrecio: SucursalParaPrecio = { id: sucursal.id, esCentral: sucursal.es_central };

    return calcularPrecioVenta(skuParaPrecio, sucursalParaPrecio, {
      costoActualPropio: sku.costo_actual,
      costoActualX24Familia: sku.producto ? (costoX24PorProducto.get(sku.producto.id) ?? null) : null,
      precioVentaX24Familia: sku.producto ? (precioVentaX24PorProducto.get(sku.producto.id) ?? null) : null,
      overridePrecio: overridePorClave.get(`${sucursal.id}:${sku.id}`) ?? null,
      precioBaseManual: precioBasePorSku.get(sku.id) ?? null,
      recargoSkuMonto: recargoSkuPorClave.get(`${sucursal.id}:${sku.id}`) ?? null,
      recargoCategoriaMonto: recargoCategoriaPorClave.get(`${sucursal.id}:${categoriaId}`) ?? null,
      descuentoEfectivoPct: descuentoPorClave.get(`${sucursal.id}:${categoriaId}`) ?? null,
    });
  }

  const filas: PrecioSkuRow[] = skusList.map((sku) => {
    const porSucursal: PrecioSkuRow["porSucursal"] = {};
    for (const sucursal of sucursalesList) {
      porSucursal[sucursal.id] = calcularParaSucursal(sku, sucursal);
    }

    return {
      id: sku.id,
      nombre: sku.producto?.nombre ?? sku.nombre,
      codigoInterno: sku.codigo_interno,
      presentacion: {
        tipo_presentacion: sku.tipo_presentacion,
        volumen: sku.volumen,
        unidad_volumen: sku.unidad_volumen,
        unidades_contenidas: sku.unidades_contenidas,
      },
      marcaNombre: sku.producto?.marca?.nombre ?? null,
      categoriaId: sku.producto?.categoria_id ?? "",
      categoriaNombre: sku.producto?.categoria?.nombre ?? null,
      cascadaCervezaLata: sku.cascada_cerveza_lata,
      precioBaseManual: precioBasePorSku.get(sku.id) ?? null,
      costoActual: puedeVerCostos ? sku.costo_actual : null,
      porSucursal,
    };
  });

  filas.sort((a, b) => {
    const marcaA = a.marcaNombre ?? "";
    const marcaB = b.marcaNombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");
    if (a.nombre !== b.nombre) return a.nombre.localeCompare(b.nombre, "es");
    return a.presentacion.unidades_contenidas - b.presentacion.unidades_contenidas;
  });

  const sucursalCentral = sucursalesList.find((s) => s.es_central) ?? null;

  const skusParaPromo: PromocionSkuOpcion[] = skusList.map((s) => ({
    id: s.id,
    codigo_interno: s.codigo_interno,
    codigo_barras: s.codigo_barras,
    tipo_presentacion: s.tipo_presentacion,
    volumen: s.volumen,
    unidad_volumen: s.unidad_volumen,
    unidades_contenidas: s.unidades_contenidas,
    costo_actual: s.costo_actual,
    producto: s.producto ? { nombre: s.producto.nombre, marca: s.producto.marca } : null,
  }));

  const promocionesList: PromocionRow[] = (promocionesRaw ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    tipo: p.tipo as "combo" | "cantidad",
    sucursal_id: p.sucursal_id,
    vigente_desde: p.vigente_desde,
    vigente_hasta: p.vigente_hasta,
    activo: p.activo,
    items: (p.promocion_items ?? []) as PromocionRow["items"],
  }));

  const tabPrecios = (
    <>
      <PreciosTable
        sucursales={sucursalesList}
        filas={filas}
        puedeEditar={puedeEditarPrecios}
        puedeVerCostos={puedeVerCostos}
      />

      {puedeVerCostos && sucursalCentral && (
        <>
          <RecargosCategoriaPanel
            sucursalLaprida={sucursalesList.find((s) => !s.es_central) ?? sucursalesList[0]}
            categorias={categoriasList}
            recargos={(recargosSucursal ?? []) as {
              sucursal_id: string;
              categoria_id: string;
              monto_fijo: number;
              actualizado_en: string;
            }[]}
            puedeEditar={puedeEditarPoliticas}
          />

          <RecargosSkuPanel
            sucursalLaprida={sucursalesList.find((s) => !s.es_central) ?? sucursalesList[0]}
            skus={skusList
              .filter((s) => !s.cascada_cerveza_lata)
              .map((s) => ({
                id: s.id,
                nombre: s.producto?.nombre ?? s.nombre,
                presentacion: {
                  tipo_presentacion: s.tipo_presentacion,
                  volumen: s.volumen,
                  unidad_volumen: s.unidad_volumen,
                  unidades_contenidas: s.unidades_contenidas,
                },
              }))}
            recargos={(recargosSku ?? []) as {
              sucursal_id: string;
              sku_id: string;
              monto_fijo: number;
              actualizado_en: string;
            }[]}
            puedeEditar={puedeEditarPoliticas}
          />

          <DescuentosEfectivoPanel
            sucursalCentral={sucursalCentral}
            categorias={categoriasList}
            descuentos={(descuentosEfectivo ?? []) as {
              sucursal_id: string;
              categoria_id: string;
              porcentaje: number;
              actualizado_en: string;
            }[]}
            puedeEditar={puedeEditarPoliticas}
          />
        </>
      )}
    </>
  );

  // Cargar promociones (combo/cantidad) es ve_costos(), igual que el resto
  // de la carga de precios (mismo criterio que el alta de producto) --
  // Laprida no ve la pestaña, aunque sí ve las promos ya aplicadas en el POS.
  const tabPromociones = puedeEditarPrecios ? (
    <PromocionesPanel sucursales={sucursalesList} skus={skusParaPromo} promociones={promocionesList} />
  ) : null;

  return <PreciosTabs tabPrecios={tabPrecios} tabPromociones={tabPromociones} />;
}
