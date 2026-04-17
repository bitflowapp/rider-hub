import { APP_CONFIG, getRuntimeConfig } from "../utils/app_config.js";

const RISK_FILL_COLORS = [
  "match",
  ["get", "level"],
  "caution",
  "#DEC6A1",
  "high",
  "#D8AE94",
  "night",
  "#B8C4EE",
  "#BFD8EA",
];

const RISK_LINE_COLORS = [
  "match",
  ["get", "level"],
  "caution",
  "#BB9A67",
  "high",
  "#B97859",
  "night",
  "#7B8ECF",
  "#7DA8C7",
];

const ACTIVE_ROUTE_GRADIENT = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  0,
  "#2A6FE8",
  0.45,
  "#3E89FF",
  1,
  "#72D2FF",
];

const TRACKING_ROUTE_GRADIENT = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  0,
  "#5CC3FF",
  0.5,
  "#73D5FF",
  1,
  "#97E6FF",
];

export async function createMapService({ containerId, riskZones }) {
  if (!globalThis.maplibregl) {
    throw new Error("MapLibre GL JS no esta cargado.");
  }

  const container = resolveContainer(containerId);

  if (!container) {
    throw new Error("No encontre el contenedor del mapa.");
  }

  await waitForContainerSize(container);

  const runtimeConfig = getRuntimeConfig();
  const map = new globalThis.maplibregl.Map({
    container,
    style: runtimeConfig.mapStyleUrl,
    center: [APP_CONFIG.center.lng, APP_CONFIG.center.lat],
    zoom: APP_CONFIG.defaultZoom,
    pitch: 26,
    bearing: -7,
    maxBounds: APP_CONFIG.maxBounds,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  const scheduleResize = createResizeScheduler(map);

  map.touchZoomRotate.disableRotation();
  map.addControl(new globalThis.maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
  map.addControl(new globalThis.maplibregl.AttributionControl({ compact: true }));

  await onceMapLoaded(map);
  tuneBaseMapStyle(map);
  installBaseSources(map, riskZones);
  installContainerResizeObserver(container, scheduleResize);
  scheduleResize();

  return {
    map,
    resize(delay = 0) {
      scheduleResize(delay);
    },
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

      resizeMap(map);
      updateSource(map, "routes", featureCollection(features));
      fitMapToContext(map, {
        routes: features,
        origin: context.origin,
        destination: context.destination,
        trackingPoint: context.trackingPoint,
      });
    },
    setTracking(pointFeature, trailFeature) {
      updateSource(map, "tracking-point", featureCollection(pointFeature ? [pointFeature] : []));
      updateSource(map, "tracking-trail", featureCollection(trailFeature ? [trailFeature] : []));
    },
    fitToContext(context) {
      resizeMap(map);
      fitMapToContext(map, context);
    },
    flyTo(lng, lat, zoom = APP_CONFIG.focusZoom) {
      resizeMap(map);
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
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        0.05,
        14,
        0.09,
        17,
        0.12,
      ],
    },
  });

  map.addLayer({
    id: "risk-zones-line",
    type: "line",
    source: "risk-zones",
    paint: {
      "line-color": RISK_LINE_COLORS,
      "line-width": 1.15,
      "line-opacity": 0.38,
      "line-dasharray": [3, 3.6],
    },
  });

  map.addSource("routes", {
    type: "geojson",
    lineMetrics: true,
    data: featureCollection([]),
  });

  map.addLayer({
    id: "routes-inactive-shadow",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], false],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(64, 73, 88, 0.14)",
      "line-width": 8.8,
      "line-opacity": 0.48,
      "line-blur": 0.75,
    },
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
      "line-color": "rgba(101, 112, 128, 0.5)",
      "line-width": 4.3,
      "line-opacity": 0.62,
    },
  });

  map.addLayer({
    id: "routes-active-shadow",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], true],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(76, 142, 255, 0.2)",
      "line-width": 15,
      "line-opacity": 0.82,
      "line-blur": 1.05,
    },
  });

  map.addLayer({
    id: "routes-active-casing",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], true],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(255, 255, 255, 0.96)",
      "line-width": 10.2,
      "line-opacity": 0.98,
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
      "line-gradient": ACTIVE_ROUTE_GRADIENT,
      "line-width": 6.2,
      "line-opacity": 0.98,
    },
  });

  map.addLayer({
    id: "routes-active-sheen",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "selected"], true],
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(255, 255, 255, 0.38)",
      "line-width": 2.35,
      "line-opacity": 0.92,
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

  map.addSource("tracking-point", {
    type: "geojson",
    data: featureCollection([]),
  });

  map.addSource("tracking-trail", {
    type: "geojson",
    lineMetrics: true,
    data: featureCollection([]),
  });

  map.addLayer({
    id: "origin-halo",
    type: "circle",
    source: "origin-point",
    paint: {
      "circle-radius": 13,
      "circle-color": "rgba(33, 42, 58, 0.16)",
    },
  });

  map.addLayer({
    id: "origin-point-layer",
    type: "circle",
    source: "origin-point",
    paint: {
      "circle-radius": 6.4,
      "circle-color": "#FFFFFF",
      "circle-stroke-color": "#1F2735",
      "circle-stroke-width": 1.8,
    },
  });

  map.addLayer({
    id: "destination-halo",
    type: "circle",
    source: "destination-point",
    paint: {
      "circle-radius": 18,
      "circle-color": "rgba(78, 146, 255, 0.18)",
    },
  });

  map.addLayer({
    id: "destination-point-layer",
    type: "circle",
    source: "destination-point",
    paint: {
      "circle-radius": 8.4,
      "circle-color": "#2B78EF",
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 2.35,
    },
  });

  map.addLayer({
    id: "destination-point-inner",
    type: "circle",
    source: "destination-point",
    paint: {
      "circle-radius": 3.2,
      "circle-color": "#F5FBFF",
    },
  });

  map.addLayer({
    id: "tracking-trail-shadow",
    type: "line",
    source: "tracking-trail",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(81, 207, 255, 0.18)",
      "line-width": 12,
      "line-opacity": 0.72,
      "line-blur": 1.15,
    },
  });

  map.addLayer({
    id: "tracking-trail",
    type: "line",
    source: "tracking-trail",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-gradient": TRACKING_ROUTE_GRADIENT,
      "line-width": 3.7,
      "line-opacity": 0.92,
      "line-dasharray": [0.75, 1.45],
    },
  });

  map.addLayer({
    id: "tracking-trail-highlight",
    type: "line",
    source: "tracking-trail",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(255, 255, 255, 0.3)",
      "line-width": 1.6,
      "line-opacity": 0.88,
    },
  });

  map.addLayer({
    id: "tracking-point-halo",
    type: "circle",
    source: "tracking-point",
    paint: {
      "circle-radius": 18,
      "circle-color": "rgba(109, 220, 255, 0.18)",
    },
  });

  map.addLayer({
    id: "tracking-point-layer",
    type: "circle",
    source: "tracking-point",
    paint: {
      "circle-radius": 7.2,
      "circle-color": "#76DAFF",
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 2.4,
    },
  });

  map.addLayer({
    id: "tracking-point-inner",
    type: "circle",
    source: "tracking-point",
    paint: {
      "circle-radius": 2.7,
      "circle-color": "#FFFFFF",
    },
  });
}

function tuneBaseMapStyle(map) {
  const paintUpdates = [
    ["background", "background-color", "#EEF2F5"],
    ["water", "fill-color", "#CFDFEA"],
    ["waterway", "line-color", "#C2D5E4"],
    ["landuse_residential", "fill-color", "#ECEDE9"],
    ["landuse_residential", "fill-opacity", 0.62],
    ["landcover_wood", "fill-color", "#E0E8DE"],
    ["landcover_glacier", "fill-color", "#F2F5F7"],
    ["landcover_ice_shelf", "fill-color", "#EDF1F5"],
    ["landuse_park", "fill-color", "#E5ECE2"],
    ["building", "fill-color", "#EBE6E0"],
    ["building", "fill-outline-color", "#D7D0C8"],
    ["aeroway-area", "fill-color", "#E9E6E0"],
    ["road_area_pier", "fill-color", "#ECE8E2"],
    ["road_pier", "line-color", "#D7D2CC"],
    ["highway_path", "line-color", "#D8D2CA"],
    ["highway_minor", "line-color", "#FBFBFC"],
    ["highway_major_casing", "line-color", "#D8D2CB"],
    ["highway_major_inner", "line-color", "#FFFFFF"],
    ["highway_major_subtle", "line-color", "#E6DED4"],
    ["highway_motorway_casing", "line-color", "#CEC8C1"],
    ["highway_motorway_inner", "line-color", "#FFF9F4"],
    ["highway_motorway_subtle", "line-color", "#E9E0D8"],
    ["railway_transit", "line-color", "rgba(134, 142, 152, 0.42)"],
    ["railway_transit_dashline", "line-color", "rgba(134, 142, 152, 0.34)"],
    ["railway_minor", "line-color", "rgba(134, 142, 152, 0.36)"],
    ["railway_minor_dashline", "line-color", "rgba(134, 142, 152, 0.28)"],
    ["railway", "line-color", "rgba(134, 142, 152, 0.38)"],
    ["railway_dashline", "line-color", "rgba(134, 142, 152, 0.28)"],
    ["boundary_state", "line-color", "rgba(104, 112, 124, 0.34)"],
    ["boundary_country_z0-4", "line-color", "rgba(104, 112, 124, 0.34)"],
    ["boundary_country_z5-", "line-color", "rgba(104, 112, 124, 0.34)"],
  ];

  paintUpdates.forEach(([layerId, property, value]) => {
    setPaintIfLayerExists(map, layerId, property, value);
  });

  setSymbolLayerPaint(map, ["water_name"], {
    "text-color": "#6B879B",
    "text-halo-color": "rgba(255, 255, 255, 0.9)",
    "text-halo-width": 1.1,
  });

  setSymbolLayerPaint(map, ["highway_name_other", "highway_name_motorway"], {
    "text-color": "#6E727A",
    "text-halo-color": "rgba(255, 255, 255, 0.88)",
    "text-halo-width": 1.2,
  });

  setSymbolLayerPaint(
    map,
    [
      "place_other",
      "place_suburb",
      "place_village",
      "place_town",
      "place_city",
      "place_city_large",
      "place_state",
      "place_country_other",
      "place_country_minor",
      "place_country_major",
    ],
    {
      "text-color": "#505865",
      "text-halo-color": "rgba(255, 255, 255, 0.92)",
      "text-halo-width": 1.4,
    }
  );
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
  const trackingPoint = context.trackingPoint;

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

  if (trackingPoint && Number.isFinite(trackingPoint.lng) && Number.isFinite(trackingPoint.lat)) {
    bounds.extend([trackingPoint.lng, trackingPoint.lat]);
  }

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: getMapPadding(),
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

function resolveContainer(containerId) {
  if (typeof containerId === "string") {
    return globalThis.document?.getElementById(containerId);
  }

  return containerId || null;
}

function waitForContainerSize(container, timeoutMs = 2600) {
  if (hasContainerSize(container)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let resizeObserver = null;
    let animationFrameId = 0;
    let timeoutId = 0;
    let settled = false;

    const cleanup = () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      if (animationFrameId) {
        globalThis.cancelAnimationFrame(animationFrameId);
      }

      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
    };

    const finish = () => {
      if (settled || !hasContainerSize(container)) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const inspect = () => {
      if (settled) {
        return;
      }

      if (hasContainerSize(container)) {
        finish();
        return;
      }

      animationFrameId = globalThis.requestAnimationFrame(inspect);
    };

    if ("ResizeObserver" in globalThis) {
      resizeObserver = new globalThis.ResizeObserver(finish);
      resizeObserver.observe(container);
    }

    animationFrameId = globalThis.requestAnimationFrame(inspect);
    timeoutId = globalThis.setTimeout(() => {
      if (hasContainerSize(container)) {
        finish();
        return;
      }

      cleanup();
      reject(new Error("El contenedor del mapa no obtuvo una altura util a tiempo."));
    }, timeoutMs);
  });
}

function hasContainerSize(container) {
  const rect = container?.getBoundingClientRect?.();
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function createResizeScheduler(map) {
  let timeoutId = 0;
  let animationFrameId = 0;

  return (delay = 0) => {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = 0;
    }

    if (animationFrameId) {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    const run = () => {
      animationFrameId = globalThis.requestAnimationFrame(() => {
        animationFrameId = 0;
        resizeMap(map);
      });
    };

    if (delay > 0) {
      timeoutId = globalThis.setTimeout(() => {
        timeoutId = 0;
        run();
      }, delay);
      return;
    }

    run();
  };
}

function installContainerResizeObserver(container, scheduleResize) {
  if (!("ResizeObserver" in globalThis)) {
    return;
  }

  const resizeObserver = new globalThis.ResizeObserver(() => {
    scheduleResize();
  });

  resizeObserver.observe(container);
}

function resizeMap(map) {
  try {
    map.resize();
  } catch (error) {
    console.warn("No pude redimensionar el mapa en este instante.", error);
  }
}

function getMapPadding() {
  const isCompactViewport = globalThis.matchMedia?.("(max-width: 739px)").matches ?? false;

  if (isCompactViewport) {
    return {
      top: 52,
      right: 18,
      bottom: 52,
      left: 18,
    };
  }

  return {
    top: 82,
    right: 28,
    bottom: 82,
    left: 28,
  };
}

function setSymbolLayerPaint(map, layerIds, paint) {
  layerIds.forEach((layerId) => {
    Object.entries(paint).forEach(([property, value]) => {
      setPaintIfLayerExists(map, layerId, property, value);
    });
  });
}

function setPaintIfLayerExists(map, layerId, property, value) {
  if (!map.getLayer(layerId)) {
    return;
  }

  try {
    map.setPaintProperty(layerId, property, value);
  } catch (error) {
    console.warn(`No pude ajustar ${property} en ${layerId}.`, error);
  }
}
