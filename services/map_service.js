import { APP_CONFIG, getRuntimeConfig } from "../utils/app_config.js";

const RISK_FILL_COLORS = [
  "match",
  ["get", "level"],
  "caution",
  "#F4C06A",
  "high",
  "#FB923C",
  "night",
  "#A78BFA",
  "#7DD3FC",
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
    maxBounds: APP_CONFIG.maxBounds,
    attributionControl: true,
  });

  map.addControl(new globalThis.maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

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
    setRoutes(routes, activeRouteId) {
      const features = routes.map((route) => ({
        type: "Feature",
        properties: {
          routeId: route.id,
          selected: route.id === activeRouteId,
          riskLabel: route.risk?.label || "Normal",
        },
        geometry: route.geometry,
      }));

      updateSource(map, "routes", featureCollection(features));

      if (features.length) {
        fitMapToFeatures(map, features);
      }
    },
    flyTo(lng, lat, zoom = 15.2) {
      map.flyTo({
        center: [lng, lat],
        zoom,
        speed: 0.9,
        curve: 1.2,
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
      "fill-opacity": 0.12,
    },
  });

  map.addLayer({
    id: "risk-zones-line",
    type: "line",
    source: "risk-zones",
    paint: {
      "line-color": RISK_FILL_COLORS,
      "line-width": 1.4,
      "line-opacity": 0.55,
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
      "line-color": "rgba(255,255,255,0.32)",
      "line-width": 4,
      "line-opacity": 0.75,
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
      "line-color": "#38BDF8",
      "line-width": 6,
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
    id: "origin-point-layer",
    type: "circle",
    source: "origin-point",
    paint: {
      "circle-radius": 7,
      "circle-color": "#F8FAFC",
      "circle-stroke-color": "#0B0D10",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: "destination-point-layer",
    type: "circle",
    source: "destination-point",
    paint: {
      "circle-radius": 8,
      "circle-color": "#7DD3FC",
      "circle-stroke-color": "#04131B",
      "circle-stroke-width": 2,
    },
  });
}

function updateSource(map, sourceId, data) {
  const source = map.getSource(sourceId);

  if (source) {
    source.setData(data);
  }
}

function fitMapToFeatures(map, features) {
  const bounds = new globalThis.maplibregl.LngLatBounds();

  features.forEach((feature) => {
    const geometry = feature.geometry || {};

    if (geometry.type === "LineString") {
      geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
    }
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: {
        top: 96,
        right: 36,
        bottom: 150,
        left: 36,
      },
      duration: 700,
      maxZoom: 15.5,
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
