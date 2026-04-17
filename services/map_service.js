import { APP_CONFIG, getRuntimeConfig } from "../utils/app_config.js";

const RISK_FILL_COLORS = [
  "match",
  ["get", "level"],
  "caution",
  "#CDA869",
  "high",
  "#D08B5E",
  "night",
  "#6D82C8",
  "#7DC8FF",
];

export async function createMapService({ containerId, riskZones }) {
  if (!globalThis.maplibregl) {
    throw new Error("MapLibre GL JS no esta cargado.");
  }

  const runtimeConfig = getRuntimeConfig();
  const map = new globalThis.maplibregl.Map({
    container: containerId,
    style: runtimeConfig.mapStyleUrl,
    center: [APP_CONFIG.center.lng, APP_CONFIG.center.lat],
    zoom: APP_CONFIG.defaultZoom,
    pitch: 22,
    bearing: -4,
    maxBounds: APP_CONFIG.maxBounds,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });

  map.touchZoomRotate.disableRotation();
  map.addControl(new globalThis.maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
  map.addControl(new globalThis.maplibregl.AttributionControl({ compact: true }));

  await onceMapLoaded(map);
  installBaseSources(map, riskZones);

  return {
    map,
    setOrigin(pointFeature) {
      updateSource(map, "origin-point", featureCollection(pointFeature ? [pointFeature] : []));
    },
    setDestination(pointFeature) {
      updateSource(map, "destination-point", featureCollection(pointFeature ? [pointFeature] : []));
    },
    setRoutes(routes, activeRouteId, context = {}) {
      const features = routes.map((route) => ({
        type: "Feature",
        properties: {
          routeId: route.id,
          selected: route.id === activeRouteId,
          riskLabel: route.operationalRisk?.overallLabel || route.operationalRisk?.label || "Normal",
        },
        geometry: route.geometry,
      }));

      updateSource(map, "routes", featureCollection(features));
      fitMapToContext(map, {
        routes: features,
        origin: context.origin,
        destination: context.destination,
      });
    },
    fitToContext(context) {
      fitMapToContext(map, context);
    },
    flyTo(lng, lat, zoom = APP_CONFIG.focusZoom) {
      map.flyTo({
        center: [lng, lat],
        zoom,
        speed: 0.88,
        curve: 1.15,
      });
    },
  };
}

function installBaseSources(map, riskZones) {
  map.addSource("risk-zones", {
    type: "geojson",
    data: riskZones,
  });

  map.addLayer({
    id: "risk-zones-fill",
    type: "fill",
    source: "risk-zones",
    paint: {
      "fill-color": RISK_FILL_COLORS,
      "fill-opacity": 0.14,
    },
  });

  map.addLayer({
    id: "risk-zones-line",
    type: "line",
    source: "risk-zones",
    paint: {
      "line-color": RISK_FILL_COLORS,
      "line-width": 1.2,
      "line-opacity": 0.42,
    },
  });

  map.addSource("routes", {
    type: "geojson",
    data: featureCollection([]),
  });

  map.addLayer({
    id: "routes-inactive",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], false],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(240,244,248,0.34)",
      "line-width": 4.4,
      "line-opacity": 0.64,
    },
  });

  map.addLayer({
    id: "routes-active-glow",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], true],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(125,200,255,0.28)",
      "line-width": 10,
      "line-opacity": 0.85,
    },
  });

  map.addLayer({
    id: "routes-active",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], true],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#7DC8FF",
      "line-width": 5.8,
      "line-opacity": 0.96,
    },
  });

  map.addSource("origin-point", {
    type: "geojson",
    data: featureCollection([]),
  });

  map.addSource("destination-point", {
    type: "geojson",
    data: featureCollection([]),
  });

  map.addLayer({
    id: "origin-halo",
    type: "circle",
    source: "origin-point",
    paint: {
      "circle-radius": 12,
      "circle-color": "rgba(255,255,255,0.16)",
    },
  });

  map.addLayer({
    id: "origin-point-layer",
    type: "circle",
    source: "origin-point",
    paint: {
      "circle-radius": 6.8,
      "circle-color": "#F8FAFC",
      "circle-stroke-color": "#0B0D10",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: "destination-halo",
    type: "circle",
    source: "destination-point",
    paint: {
      "circle-radius": 16,
      "circle-color": "rgba(125,200,255,0.24)",
    },
  });

  map.addLayer({
    id: "destination-point-layer",
    type: "circle",
    source: "destination-point",
    paint: {
      "circle-radius": 8.2,
      "circle-color": "#7DC8FF",
      "circle-stroke-color": "#04131B",
      "circle-stroke-width": 2.2,
    },
  });
}

function updateSource(map, sourceId, data) {
  const source = map.getSource(sourceId);

  if (source) {
    source.setData(data);
  }
}

function fitMapToContext(map, context) {
  const bounds = new globalThis.maplibregl.LngLatBounds();
  const routes = context.routes || [];
  const origin = context.origin;
  const destination = context.destination;

  routes.forEach((feature) => {
    const geometry = feature.geometry || {};

    if (geometry.type === "LineString") {
      geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
    }
  });

  if (origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)) {
    bounds.extend([origin.lng, origin.lat]);
  }

  if (destination?.coordinates) {
    bounds.extend([destination.coordinates.lng, destination.coordinates.lat]);
  } else if (destination && Number.isFinite(destination.lng) && Number.isFinite(destination.lat)) {
    bounds.extend([destination.lng, destination.lat]);
  }

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: {
        top: 132,
        right: 32,
        bottom: 164,
        left: 32,
      },
      duration: 720,
      maxZoom: 15.6,
    });
  }
}

function featureCollection(features) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function onceMapLoaded(map) {
  if (map.loaded()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    map.once("load", resolve);
    map.once("error", (event) => reject(event.error || new Error("No pude inicializar el mapa.")));
  });
}
