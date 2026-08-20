# BEBIDAS MOE — IDENTIDAD VISUAL DEL SISTEMA INTERNO

Quiero que todo el sistema interno de **Bebidas Moe** siga estas directrices visuales y de UX/UI.

Este documento debe utilizarse como referencia durante todo el desarrollo.

## 1. PRINCIPIO GENERAL

Este sistema **NO es una página comercial ni está diseñado para captar clientes**.

Es una herramienta de trabajo utilizada diariamente por:

* dueño;
* encargados;
* empleados;
* personal de Olavarría;
* personal de Laprida.

Por lo tanto, priorizar siempre:

**Claridad > estética**

**Velocidad > efectos**

**Legibilidad > identidad de marca**

**Información > decoración**

El branding de Bebidas Moe debe estar presente de manera **sutil**, principalmente mediante su rojo característico, pero nunca debe perjudicar la lectura.

La sensación buscada es:

> **Sistema administrativo moderno, limpio, profesional y extremadamente fácil de utilizar.**

---

# 2. DIRECCIÓN VISUAL

Quiero una interfaz predominantemente:

**BLANCA / CLARA**

No quiero un dashboard oscuro.

No quiero grandes superficies rojas.

No quiero degradados innecesarios.

No quiero elementos extravagantes.

No quiero efectos visuales simplemente para impresionar.

No quiero estética de landing page.

No quiero que parezca una aplicación diseñada para vender Bebidas Moe.

Debe parecer una **herramienta interna profesional creada específicamente para administrar Bebidas Moe**.

Referencias conceptuales:

* software SaaS moderno;
* herramientas administrativas modernas;
* dashboards financieros;
* interfaces B2B;
* sistemas de gestión actuales.

---

# 3. PALETA

## Fondo principal

`#FFFFFF`

Debe dominar visualmente el sistema.

---

## Fondo secundario

Utilizar un gris extremadamente claro aproximadamente:

`#F7F7F8`

o similar.

Puede utilizarse para:

* fondo general;
* separar sidebar;
* secciones;
* encabezados de tablas;
* cards secundarias.

---

## Rojo Bebidas Moe

Color aproximado de identidad:

`#C8201A`

Debe mantenerse como vínculo visual con la marca.

Pero utilizarlo **con moderación**.

Aplicaciones apropiadas:

* botón primario;
* elemento seleccionado del menú;
* pequeños indicadores;
* links importantes;
* foco;
* algunos iconos;
* detalles de identidad.

Nunca utilizarlo como fondo de grandes áreas.

Evitar:

* sidebar completamente rojo;
* dashboard rojo;
* cards rojas sin necesidad;
* tablas rojas;
* grandes encabezados rojos.

El usuario debe percibir el rojo como **acento**, no como protagonista.

---

# 4. COLORES NEUTROS

La mayor parte de la interfaz debe construirse utilizando:

**Blanco**

**Grises claros**

**Grises medios**

**Gris oscuro / casi negro para texto**

Ejemplo conceptual:

Fondo → blanco

Superficie secundaria → gris muy claro

Bordes → gris claro

Texto secundario → gris medio

Texto principal → gris muy oscuro

Rojo Moe → acciones y branding

Esto debe producir una interfaz muy descansada visualmente.

---

# 5. COLORES FUNCIONALES

No utilizar rojo Moe para representar absolutamente todo.

Los estados necesitan colores universales.

### Verde

Correcto / completado / stock saludable / recibido.

### Amarillo

Atención / stock próximo al mínimo.

### Naranja

Situación importante.

### Rojo

Error / sin stock / faltante / diferencia crítica.

### Azul

Información / transferencia / mercadería en tránsito.

Los colores deben ser suaves.

Evitar fondos extremadamente saturados.

Preferir:

fondo muy claro + texto/icono de color.

Ejemplo:

`Stock bajo`

badge amarillo suave.

---

# 6. TIPOGRAFÍA

No es necesario mantener las tipografías comerciales de Bebidas Moe.

Este sistema no busca vender.

Busca **leer información rápidamente durante muchas horas**.

Elegir una tipografía sans-serif moderna y extremadamente legible.

Buenas opciones:

* Inter;
* Geist;
* DM Sans;
* Manrope;
* similares.

Preferencia inicial:

**Inter o Geist.**

Utilizar una sola familia tipográfica para prácticamente todo el sistema.

No utilizar tipografías decorativas.

No utilizar serif en dashboards.

Los números deben tener excelente legibilidad.

---

# 7. DENSIDAD DE INFORMACIÓN

Este sistema manejará potencialmente:

* cientos/miles de productos;
* movimientos;
* precios;
* proveedores;
* compras;
* pedidos;
* transferencias;
* inventarios.

Por lo tanto, no diseñar cada dato como una card gigante.

Necesitamos una interfaz con **densidad de información equilibrada**.

Especialmente para:

* productos;
* stock;
* movimientos;
* proveedores;
* pedidos.

Utilizar tablas modernas cuando sean la herramienta correcta.

---

# 8. ESTRUCTURA PRINCIPAL

En desktop utilizar preferentemente:

```text
┌────────────────────────────────────────────────────┐
│ Sidebar │ Header / búsqueda / usuario              │
│         ├──────────────────────────────────────────│
│         │                                          │
│         │ Contenido                                │
│         │                                          │
│         │                                          │
└────────────────────────────────────────────────────┘
```

La sidebar puede ser:

**blanca o gris extremadamente claro.**

Separada del contenido mediante:

* borde fino;
* diferencia mínima de fondo.

NO hacerla negra.

NO hacerla roja.

---

# 9. SIDEBAR

Debe sentirse extremadamente simple.

Ejemplo:

**Bebidas Moe**

Inicio

Productos

Stock

Pedidos

Transferencias

Compras

Proveedores

Inventarios

Reportes

---

Configuración

Usuario

El elemento activo puede utilizar:

* fondo rojo extremadamente claro;
* texto/icono rojo Moe.

Ejemplo conceptual:

`▌ Stock`

sin necesidad de pintar toda la fila de rojo intenso.

---

# 10. HEADER

Simple.

Puede contener:

**Título de sección**

Búsqueda global

Sucursal seleccionada

Notificaciones

Usuario

Evitar headers gigantes.

Queremos aprovechar el espacio vertical.

---

# 11. DASHBOARD DEL DUEÑO

La pantalla debe responder rápidamente:

> ¿Cómo está Bebidas Moe hoy?

Primera fila:

### Stock valorizado

$XX.XXX.XXX

### Ventas

$X.XXX.XXX

### Stock crítico

24

### Mercadería inmovilizada

$X.XXX.XXX

Cards:

**blancas**

con borde gris claro.

No necesitamos fondos de diferentes colores.

El color puede aparecer solamente en:

* icono;
* porcentaje;
* estado;
* pequeño indicador.

---

# 12. JERARQUÍA

El dato importante debe destacar por:

**tamaño + peso tipográfico**

y no porque tenga un fondo extravagante.

Ejemplo:

### $24,5 M

Stock valorizado

Olavarría $16,2 M · Laprida $8,3 M

Simple.

---

# 13. PANEL OPERATIVO

El empleado debe encontrar inmediatamente lo que necesita hacer.

Ejemplo Laprida:

# Inicio

**Necesita atención**

🔴 8 productos sin stock

🟡 23 productos con stock bajo

🔵 1 transferencia en camino

📦 Pedido semanal pendiente

Después:

### Acciones rápidas

`Hacer pedido semanal`

`Recibir mercadería`

`Buscar producto`

`Realizar inventario`

No llenar la pantalla de métricas que el empleado no necesita.

---

# 14. PEDIDO SEMANAL LAPRIDA

Debe ser uno de los flujos más simples del sistema.

Ejemplo:

# Pedido semanal

Lunes 17 de agosto

> Encontramos 38 productos que podrían necesitar reposición.

---

**Fernet Branca 750 ml**

Stock actual: **3**

Stock objetivo: 15

Venta semanal: 11

**Sugerido: 12**

`−   12   +`

---

El encargado revisa.

No obligarlo a escribir manualmente todos los productos.

Al final:

**38 productos · 146 unidades**

`Confirmar pedido`

El botón primario puede utilizar rojo Moe.

---

# 15. PEDIDOS EN OLAVARRÍA

Olavarría recibe:

# Pedido Laprida #0041

Mostrar claramente:

| Producto | Solicitado | Stock Olavarría | Disponible para enviar | Enviar |
| -------- | ---------: | --------------: | ---------------------: | -----: |

Utilizar indicadores solamente donde haya problemas.

Ejemplo:

Branca 750

Solicitado: 12

Disponible transferible: 6

`Stock insuficiente`

No pintar toda la fila de rojo.

Mostrar un badge/indicador discreto.

---

# 16. PRODUCTOS

La ficha de producto debe priorizar información.

Ejemplo:

# Fernet Branca 750 ml

Fernet · Branca

**Stock total: 28**

Olavarría
18

Laprida
10

---

Costo
$12.400

Precio
$18.900

Margen
34,4%

---

Venta promedio
11 u./semana

---

Proveedor
XXXX

---

Últimos movimientos

...

No agregar imágenes gigantes del producto.

Una miniatura puede existir si realmente ayuda a identificarlo.

---

# 17. TABLAS

Las tablas son importantes en este sistema.

Deben ser:

* limpias;
* compactas sin ser incómodas;
* fácilmente escaneables;
* ordenables;
* filtrables;
* buscables.

Utilizar:

* líneas divisorias muy suaves;
* encabezado gris claro;
* hover discreto;
* columnas alineadas correctamente.

Los números deberían alinearse consistentemente.

Evitar:

* bordes alrededor de cada celda;
* colores excesivos;
* botones grandes dentro de cada fila.

---

# 18. FILTROS

Los filtros deben ser simples.

Ejemplo Productos:

`Buscar...`

`Categoría`

`Marca`

`Sucursal`

`Estado stock`

No mostrar veinte filtros permanentemente.

Los filtros avanzados pueden aparecer bajo:

`Más filtros`

---

# 19. CARDS

Utilizar cards solamente cuando ayudan a agrupar información.

No convertir cada elemento en una card.

Radio:

aproximadamente **8 px**.

Bordes:

gris muy claro.

Sombras:

mínimas o inexistentes.

---

# 20. BOTONES

### Primario

Rojo Moe.

Utilizar solamente para la acción principal.

Ejemplo:

`Confirmar pedido`

### Secundario

Blanco + borde gris.

Ejemplo:

`Guardar borrador`

### Destructivo

Rojo funcional únicamente cuando corresponde.

Ejemplo:

`Cancelar transferencia`

No puede haber cinco botones rojos compitiendo en una misma pantalla.

---

# 21. ESPACIADO

Queremos mucho aire visual, pero sin desperdiciar pantalla.

Evitar:

* cards gigantes;
* márgenes enormes;
* títulos excesivamente grandes.

Es software de trabajo.

La persona necesita visualizar bastante información simultáneamente.

---

# 22. ICONOS

Utilizar una sola librería consistente.

Preferentemente iconos lineales y simples.

No utilizar ilustraciones innecesarias.

No utilizar emojis como lenguaje principal de interfaz.

Los iconos acompañan al texto, no lo reemplazan cuando puede existir ambigüedad.

---

# 23. ANIMACIONES

Mínimas.

Solamente:

* hover;
* dropdown;
* modal;
* sidebar;
* loading;
* cambio de estado.

Aproximadamente:

`150–200 ms`

No utilizar animaciones decorativas.

---

# 24. ESTADOS VACÍOS

Si no existe información:

No mostrar simplemente:

> No data.

Utilizar mensajes útiles.

Ejemplo:

### No hay transferencias pendientes

Todas las transferencias fueron recibidas.

o:

### Todavía no hay proveedores

Agregá el primer proveedor para comenzar a registrar compras.

---

# 25. MENSAJES

Utilizar español natural.

No utilizar terminología técnica si el empleado no necesita conocerla.

❌ `SKU threshold reached`

✅ `Quedan pocas unidades`

❌ `Inventory reconciliation`

✅ `Control de inventario`

❌ `Inter-warehouse transaction`

✅ `Transferencia a Laprida`

---

# 26. DISEÑO SEGÚN ROL

No todos necesitan ver todo.

### Dueño

Priorizar:

**control + análisis + decisiones**

### Olavarría

Priorizar:

**stock + compras + preparación + transferencias**

### Laprida

Priorizar:

**stock + reposición + pedidos + recepción**

### Empleado

Priorizar:

**operaciones simples**

Esto debe influir en la interfaz.

No simplemente ocultar algunos botones del mismo dashboard.

---

# 27. MOBILE

Desktop será importante, pero el sistema debe funcionar correctamente desde celular.

Desde mobile debe ser especialmente fácil:

* buscar un producto;
* consultar stock;
* revisar un pedido;
* confirmar cantidades;
* recibir mercadería;
* ver alertas;
* aprobar operaciones.

Las tablas complejas pueden transformarse en vistas adaptadas.

No intentar comprimir una tabla desktop de diez columnas en una pantalla móvil.

---

# 28. BÚSQUEDA GLOBAL

Considerar una búsqueda superior:

`Buscar producto, proveedor, pedido...`

Debe permitir llegar rápidamente a información sin navegar cinco pantallas.

Ejemplo:

Usuario escribe:

`Branca`

Resultado:

**Fernet Branca 750 ml**

28 unidades

Olavarría 18 · Laprida 10

---

# 29. CONSISTENCIA

Antes de crear componentes nuevos, verificar si ya existe un patrón equivalente.

Mantener consistencia en:

* botones;
* inputs;
* tablas;
* badges;
* modales;
* dropdowns;
* tipografía;
* espaciado;
* estados.

Crear progresivamente un pequeño **design system interno**.

---

# 30. LO QUE QUIERO EVITAR

No utilizar:

* dark mode como interfaz principal;
* sidebar negra;
* sidebar roja;
* degradados llamativos;
* glassmorphism;
* neomorphism;
* efectos 3D;
* exceso de sombras;
* fondos con imágenes;
* tipografías decorativas;
* animaciones innecesarias;
* cards gigantes;
* dashboards llenos de gráficos porque sí;
* exceso de colores;
* exceso de rojo;
* estética de landing page;
* estética de ecommerce;
* elementos diseñados para impresionar clientes.

Este es un **sistema de trabajo**.

---

# 31. REFERENCIA VISUAL CONCEPTUAL

La interfaz debería sentirse más cercana a:

**software SaaS B2B moderno + sistema administrativo premium**

que a:

**web de una licorería.**

Bebidas Moe debe reconocerse principalmente mediante:

**logo + nombre + pequeños acentos en rojo.**

El resto debe estar diseñado para trabajar cómodamente durante horas.

---

# 32. PRINCIPIO DE DISEÑO

Antes de agregar cualquier elemento visual preguntarse:

> **¿Esto ayuda al usuario a entender información o realizar una acción?**

Si la respuesta es no:

**no agregarlo.**

---

# PRINCIPIO FINAL

## SIMPLE PARA OPERAR. CLARO PARA CONTROLAR. RÁPIDO PARA DECIDIR.

Quiero que toda decisión de UX/UI del sistema interno de Bebidas Moe siga ese principio.

No busques hacer una interfaz extravagante.

Buscá construir una interfaz que después de varias horas de trabajo siga siendo **cómoda, clara y rápida**.
