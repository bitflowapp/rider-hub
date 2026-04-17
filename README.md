# Rider Maps Neuquen

Rider Maps Neuquen es la V2 de Rider Hub: una PWA rider-first para moverse en bicicleta dentro de Neuquen Capital con mapa embebido, geocoding acotado, rutas sugeridas, evaluacion de riesgo operativo y un modulo secundario de efectivo/exportacion.

## Lo que ya funciona

- Mapa embebido con MapLibre GL JS.
- Basemap remoto sin clave usando OpenFreeMap.
- Geocoding acotado a Neuquen Capital con Photon.
- Rechazo de localidades fuera de alcance como Cipolletti, Plottier o Centenario.
- Marcador de destino.
- Origen por geolocalizacion cuando el navegador lo permite.
- Origen de referencia en el centro de Neuquen cuando no hay geolocalizacion.
- Calculo de rutas en bicicleta con abstraccion de provider.
- Fallback automatico a OSRM demo si no hay clave de openrouteservice.
- Selector de estrategia: `Rapida`, `Equilibrada`, `Prudente`.
- Evaluacion local de riesgo operativo contra zonas cargadas en `data/risk_zones.js`.
- Historial de destinos.
- Feedback rapido del rider sobre la ruta.
- Registro simple de efectivo con exportacion PDF y XLSX.
- Persistencia local con `localStorage`.
- Compatibilidad con GitHub Pages y PWA.

## Arquitectura

```text
rider-hub/
├─ index.html
├─ styles.css
├─ app.js
├─ manifest.webmanifest
├─ sw.js
├─ 404.html
├─ README.md
├─ data/
│  └─ risk_zones.js
├─ engine/
│  ├─ engine.js
│  └─ none.js
├─ services/
│  ├─ export_service.js
│  ├─ geocoding_service.js
│  ├─ map_service.js
│  ├─ risk_service.js
│  └─ routing_service.js
├─ utils/
│  ├─ address_utils.js
│  ├─ app_config.js
│  ├─ format_utils.js
│  └─ storage_utils.js
├─ vendor/
│  ├─ jspdf.plugin.autotable.min.js
│  ├─ jspdf.umd.min.js
│  ├─ maplibre-gl.css
│  ├─ maplibre-gl.js
│  └─ xlsx.full.min.js
└─ icons/
   ├─ apple-touch-icon.png
   ├─ icon-192.png
   ├─ icon-512.png
   ├─ icon.svg
   ├─ icon-192.svg
   ├─ icon-512.svg
   └─ apple-touch-icon.svg
```

## Providers y restricciones reales

### Basemap

- El mapa usa OpenFreeMap como estilo/base publica.
- La UI ya queda lista para cambiar luego a PMTiles o una base local/regional propia.

### Geocoding

- La busqueda usa Photon (`photon.komoot.io`) con bounding box sobre Neuquen Capital.
- Es apto para prototipo y bajo volumen.
- Para un despliegue serio con trafico sostenido conviene pasar a un geocoder propio o a un proxy liviano.

### Routing

- La capa `services/routing_service.js` abstrae el provider.
- Si hay clave de `openrouteservice`, la app usa ORS.
- Si no hay clave, cae a `OSRM demo` para que el prototipo siga funcionando de verdad.
- La recomendacion de produccion es mover ORS o GraphHopper detras de un proxy/back-end chico para no exponer claves en el frontend publico.

### Riesgo operativo

- La evaluacion actual cruza las rutas con zonas locales semilla definidas en `data/risk_zones.js`.
- Esa base no pretende ser definitiva ni "verdad absoluta".
- Antes de una version operativa fuerte conviene reemplazarla por zonas validadas con datos de calle y feedback real del rider.

## Estrategias de ruta

- `Rapida`: prioriza tiempo y penaliza poco el riesgo.
- `Equilibrada`: mezcla tiempo y riesgo.
- `Prudente`: castiga mucho el riesgo y, cuando ORS esta activo, intenta evitar zonas mas delicadas.

## Configuracion opcional para ORS

La app funciona sin claves gracias al fallback a OSRM demo, pero si quieres usar openrouteservice puedes inyectar una config global antes de `app.js`:

```html
<script>
  window.RIDER_MAPS_CONFIG = {
    orsApiKey: "TU_CLAVE_ORS"
  };
</script>
```

No conviene commitear claves en un repo publico.

## Correr localmente

```bash
python -m http.server 8080
```

Abre:

```text
http://localhost:8080
```

## GitHub Pages

El frontend sigue siendo 100% estatico y compatible con GitHub Pages porque:

- usa HTML, CSS y JavaScript vanilla
- no requiere build step
- no depende de backend para renderizar la app
- usa rutas relativas

## Publicar cambios

```bash
git status
git add .
git commit -m "feat: build rider-first map experience for Neuquén bicycle routing"
git push origin main
```

## Limitaciones honestas

- El basemap, el geocoder y el routing actual dependen de servicios remotos.
- GitHub Pages solo sirve el frontend; no resuelve por si solo geocoding o routing en infraestructura propia.
- Para una V3 mas robusta conviene:
  - proxy pequeño para ORS o GraphHopper
  - geocoder propio o cacheado
  - dataset local de riesgo validado en calle
  - opcion de tiles locales/PMTiles de Neuquen
