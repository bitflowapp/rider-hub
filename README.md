# Rider Maps Neuquen

Rider Maps Neuquen es una PWA estatica rider-first pensada para Neuquen Capital: interpreta direcciones sucias, valida si parecen reales dentro de la ciudad, ubica el destino en un mapa oscuro premium, calcula rutas en bici y expone riesgo operativo con una recomendacion corta y accionable.

## Lo que ya funciona

- Mapa embebido con MapLibre GL JS y estilo oscuro.
- Flujo principal centrado en mapa con estado operacional claro.
- Limpieza de direccion, interpretacion de calle y enriquecimiento automatico a Neuquen Capital.
- Rechazo explicito de localidades fuera de alcance como Cipolletti, Plottier o Centenario.
- Base local de calles semilla en `data/neuquen_streets.js`.
- Servicio desacoplado de indice local en `services/street_index_service.js`.
- Geocoding con Photon acotado a Neuquen Capital.
- Reverse geocoding para mejorar la etiqueta del origen cuando hay geolocalizacion.
- Ruteo en bici con abstraccion de provider.
- Fallback automatico a OSRM demo si no hay clave de openrouteservice.
- Estrategias reales: `Rapida`, `Equilibrada`, `Prudente`.
- Evaluacion de riesgo operativo sobre destino y recorrido.
- Historial de destinos y feedback rapido del rider.
- Modulo secundario de efectivo con exportacion PDF y XLSX.
- Persistencia local con `localStorage`.
- Compatibilidad con GitHub Pages y PWA.

## Arquitectura

```text
rider-hub/
|-- index.html
|-- styles.css
|-- app.js
|-- manifest.webmanifest
|-- sw.js
|-- 404.html
|-- README.md
|-- data/
|   |-- neuquen_streets.js
|   `-- risk_zones.js
|-- engine/
|   |-- engine.js
|   `-- none.js
|-- services/
|   |-- export_service.js
|   |-- geocoding_service.js
|   |-- map_service.js
|   |-- risk_service.js
|   |-- routing_service.js
|   `-- street_index_service.js
|-- utils/
|   |-- address_utils.js
|   |-- app_config.js
|   |-- format_utils.js
|   `-- storage_utils.js
|-- vendor/
|   |-- jspdf.plugin.autotable.min.js
|   |-- jspdf.umd.min.js
|   |-- maplibre-gl.css
|   |-- maplibre-gl.js
|   `-- xlsx.full.min.js
`-- icons/
```

## Providers y restricciones reales

### Basemap

- El mapa usa un estilo oscuro remoto compatible con MapLibre.
- Sigue siendo 100% frontend; GitHub Pages lo sirve sin build step.

### Geocoding

- La busqueda usa Photon (`photon.komoot.io`) con bounding box sobre Neuquen Capital.
- La validacion no inventa coincidencias: si el match es flojo, la app marca la direccion como dudosa.
- Para trafico serio conviene pasar a geocoder propio o proxy con cache.

### Routing

- `services/routing_service.js` abstrae el provider.
- Si hay clave de `openrouteservice`, la app usa ORS y la estrategia prudente puede evitar zonas mas cargadas.
- Si no hay clave, cae a `OSRM demo` para que la app siga resolviendo una ruta real.
- En produccion conviene mover ORS o GraphHopper detras de un backend o proxy chico para no exponer claves.

### Riesgo operativo

- La capa `data/risk_zones.js` sigue siendo una base local semilla; sirve para una evaluacion prudente y visible.
- No pretende reemplazar validacion de calle real ni feedback acumulado de riders.
- La siguiente iteracion natural es cargar zonas por feedback operativo validado.

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

La app sigue siendo viable en GitHub Pages porque:

- usa HTML, CSS y JavaScript vanilla
- no requiere build step
- conserva rutas relativas
- no depende de backend propio para renderizar la interfaz

## Limitaciones honestas

- Basemap, geocoder y routing dependen de servicios remotos.
- GitHub Pages solo sirve el frontend; no aloja geocoding ni routing propio.
- La base local de calles es amplia para una semilla operativa, no un callejero municipal exhaustivo.
- Para subir mucho la robustez real conviene sumar cache/proxy, feedback operacional persistido y dataset de riesgo validado en calle.
