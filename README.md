# Rider Hub

Rider Hub es una web app/PWA mobile-first pensada para trabajo real en la calle: permite abrir direcciones rápido en Google Maps en modo bicicleta, registrar pedidos manualmente y consultar un resumen operativo del día y de la semana.

## Qué hace la app

- Lee una dirección desde el portapapeles cuando el navegador lo permite.
- Limpia y normaliza la dirección antes de abrir Google Maps.
- Abre Google Maps con `travelmode=bicycling`.
- Guarda un historial local de las últimas 10 direcciones abiertas.
- Registra pedidos manualmente con monto, métricas, zona, cobro, observaciones y fecha/hora.
- Calcula resúmenes del día y de la semana enteramente en cliente.
- Funciona como PWA instalable y rápida de reabrir.

## Funciones principales

### Inicio: Pedido → Maps

- Botón grande para leer el portapapeles y abrir Maps.
- Campo manual grande para pegar o editar una dirección.
- Botón para abrir Google Maps manualmente.
- Historial clickeable de direcciones recientes.
- Botón para reabrir la última dirección.
- Feedback visual claro para lectura de portapapeles, apertura de Maps y errores.

### Registrar pedido

- Carga manual de monto.
- Carga manual de km estimados.
- Carga manual de minutos estimados.
- Carga manual de zona.
- Carga manual de forma de cobro.
- Carga manual de observaciones.
- Carga manual de fecha y hora.
- Validaciones básicas para evitar datos rotos.
- Guardado en `localStorage`.
- Limpieza del formulario después de guardar.

### Resumen

- Total del día.
- Cantidad de pedidos del día.
- Promedio por pedido del día.
- Total efectivo del día.
- Total transferencia del día.
- Total semanal.
- Ganancia por hora aproximada del día cuando hay minutos cargados.
- Listado reciente de pedidos guardados.

## Estructura del proyecto

```text
rider-hub/
├─ index.html
├─ styles.css
├─ app.js
├─ manifest.webmanifest
├─ sw.js
├─ 404.html
├─ README.md
├─ engine/
│  ├─ engine.js
│  └─ none.js
└─ icons/
   ├─ apple-touch-icon.png
   ├─ icon-192.png
   ├─ icon-512.png
   ├─ icon.svg
   ├─ icon-192.svg
   ├─ icon-512.svg
   └─ apple-touch-icon.svg
```

## Engine preparado para V2

La app deja una capa interna preparada para crecer sin romper el frontend:

- `getActiveEngine()`
- `processAddressInput(text)`
- `analyzeOrder(order)`

En esta V1:

- `getActiveEngine()` devuelve `"none"`.
- `processAddressInput(text)` limpia el texto de dirección.
- `analyzeOrder(order)` devuelve `null`.
- No hay requests de red ni integración de IA.

La idea es poder sumar más adelante `engine/ollama.js` y resolver la selección del engine desde `engine/engine.js` sin tocar el resto de la app.

## Cómo correrlo localmente

Como es una app estática, conviene abrirla con un servidor local simple para probar bien el service worker y la PWA.

### Opción con Python

```bash
python -m http.server 8080
```

Después abrí:

```text
http://localhost:8080
```

### Opción con VS Code Live Server

Podés abrir la carpeta del proyecto y servirla con una extensión de servidor estático.

## Ejemplos de comandos

### Levantar un servidor local

```bash
python -m http.server 8080
```

### Inicializar Git y crear el primer commit

```bash
git init
git branch -M main
git add .
git commit -m "feat: launch Rider Hub PWA"
```

## Cómo publicarlo en GitHub Pages

1. Subí el proyecto a un repositorio público o privado compatible con Pages.
2. En GitHub, abrí `Settings`.
3. Si la pestaña `Settings` no aparece, abrila desde el menú desplegable de tabs del repositorio.
4. En la barra lateral, dentro de `Code and automation`, entrá a `Pages`.
5. En `Build and deployment`, en `Source`, elegí `Deploy from a branch`.
6. Seleccioná la rama `main`.
7. En la carpeta, dejá `/ (root)`.
8. Tocá `Save` y esperá a que GitHub publique el sitio.

Cuando termine, GitHub te va a mostrar la URL final de Pages.

## Cómo usarlo en iPhone

1. Abrí la URL de GitHub Pages en Safari.
2. Esperá a que cargue la app por completo.
3. Tocá el botón de compartir.
4. Elegí `Agregar a pantalla de inicio`.
5. Abrí Rider Hub desde el ícono para usarlo como app instalada.

## Cómo agregarla a pantalla de inicio

En iPhone, la instalación se hace desde Safari:

1. Entrá al sitio publicado.
2. Tocá `Compartir`.
3. Elegí `Agregar a pantalla de inicio`.
4. Confirmá el nombre.
5. Tocá `Agregar`.

## Limitaciones reales

- La app no puede leer automáticamente una dirección desde otra app si antes el usuario no la copia.
- La lectura del portapapeles depende del navegador, del contexto seguro y de una interacción explícita del usuario.
- GitHub Pages es estático: no hay backend, base de datos remota ni procesamiento del lado servidor.
- El sitio publicado en Pages queda accesible por internet.
- El historial y los pedidos viven en `localStorage`, así que dependen del navegador/dispositivo donde se usen.
- En esta versión no hay sincronización entre dispositivos.

## Notas sobre una futura V2 con Ollama

La estructura ya quedó lista para sumar un engine como `engine/ollama.js`, pero esta V1 no hace llamadas externas ni usa IA.

Si en una V2 querés integrar Ollama, lo recomendado es usar un proxy o backend intermedio. No conviene conectar el navegador directamente a una API local de Ollama desde una PWA pública, tanto por compatibilidad como por seguridad y CORS.

## Publicación en GitHub Pages

Rider Hub es compatible con GitHub Pages porque:

- usa solo HTML, CSS y JavaScript vanilla
- no depende de backend
- no requiere build step
- usa rutas relativas para funcionar bien desde un repositorio publicado en Pages

## Licencia de uso

Podés usar esta base como punto de partida para tu operación diaria y adaptarla a tu flujo de trabajo.
