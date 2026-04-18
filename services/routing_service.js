import { APP_CONFIG, getRuntimeConfig } from "../utils/app_config.js";
import { buildAvoidPolygons } from "./risk_service.js";

export async function getRouteOptions({ origin, destination }) {
  const runtimeConfig = getRuntimeConfig();

  if (runtimeConfig.orsApiKey) {
    try {
      return await getOrsRouteSet({
        origin,
        destination,
        apiKey: runtimeConfig.orsApiKey,
      });
    } catch (error) {
      console.warn("openrouteservice no respondio en todas las estrategias; hago fallback a OSRM demo.", error);
    }
  }

  return getOsrmRouteSet({ origin, destination });
}

export function getAlternativeRoutes(routes, activeRouteId) {
  return routes.filter((route) => route.id !== activeRouteId);
}

export function summarizeRoute({ route, strategy, operationalRisk }) {
  const safeStrategy = strategy || route?.displayStrategy || route?.strategy || "balanced";
  const label = operationalRisk?.overallLabel || "Normal";

  if (safeStrategy === "fast") {
    return label === "Normal"
      ? "Rapida y directa para bajar tiempo de llegada."
      : "Rapida, pero entra en un sector que pide mas atencion.";
  }

  if (safeStrategy === "cautious") {
    return label === "Normal"
      ? "Prudente: baja exposicion sin inventar desvio."
      : "Prudente: prioriza estabilidad aunque pueda alargarse.";
  }

  if (label === "Normal") {
    return "Equilibrada: balancea tiempo, estabilidad y carga mental.";
  }

  return "Equilibrada: intenta sostener ritmo sin agrandar la exposicion.";
}

async function getOrsRouteSet({ origin, destination, apiKey }) {
  const settledResults = await Promise.allSettled(
    APP_CONFIG.strategyOrder.map(async (strategy) => ({
      strategy,
      response: await getOrsRoute({
        origin,
        destination,
        strategy,
        apiKey,
      }),
    }))
  );

  const successfulStrategies = settledResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  if (!successfulStrategies.length) {
    throw new Error("openrouteservice no devolvio rutas reales.");
  }

  const mergedRoutes = mergeRouteCandidates(
    successfulStrategies.flatMap(({ strategy, response }) =>
      response.routes.map((route, index) => ({
        ...route,
        strategy,
        generatedForStrategy: strategy,
        providerRank: index + 1,
      }))
    )
  );

  return {
    provider: "openrouteservice",
    providerNote: buildProviderNote({
      provider: "openrouteservice",
      strategies: successfulStrategies.map((item) => item.strategy),
      routeCount: mergedRoutes.length,
      note:
        mergedRoutes.length > 1
          ? "Alternativas reales del provider, ordenadas luego por memoria operativa."
          : "El provider devolvio una sola ruta real; no se inventaron extras.",
    }),
    usesHeuristics: false,
    routes: mergedRoutes,
  };
}

async function getOrsRoute({ origin, destination, strategy, apiKey }) {
  const body = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    instructions: true,
    units: "m",
    elevation: false,
    options: {},
    alternative_routes: {
      target_count: APP_CONFIG.maxRouteAlternatives,
      share_factor: 0.62,
      weight_factor: strategy === "cautious" ? 2.3 : strategy === "balanced" ? 1.95 : 1.72,
    },
  };

  const avoidPolygons = buildAvoidPolygons(strategy);

  if (avoidPolygons) {
    body.options.avoid_polygons = avoidPolygons;
  }

  const response = await fetch(APP_CONFIG.providers.routing.orsUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, application/geo+json",
      Authorization: apiKey,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`openrouteservice devolvio ${response.status}.`);
  }

  const payload = await response.json();
  const routes = (payload.features || []).map((feature) => ({
    provider: "openrouteservice",
    geometry: feature.geometry,
    distanceMeters: Number(feature.properties?.summary?.distance || 0),
    durationSeconds: Number(feature.properties?.summary?.duration || 0),
    guidanceSteps: normalizeOrsGuidanceSteps(feature),
    raw: feature,
  }));

  if (!routes.length) {
    throw new Error(`openrouteservice no devolvio rutas para ${strategy}.`);
  }

  return {
    provider: "openrouteservice",
    routes,
  };
}

async function getOsrmRouteSet({ origin, destination }) {
  const baseUrl = `${APP_CONFIG.providers.routing.osrmUrl}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(baseUrl);
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`OSRM devolvio ${response.status}.`);
  }

  const payload = await response.json();

  if (payload.code !== "Ok" || !Array.isArray(payload.routes) || !payload.routes.length) {
    throw new Error("OSRM no pudo calcular una ruta usable.");
  }

  const routes = payload.routes.map((route, index) => ({
    id: `route-${index + 1}`,
    provider: "osrm-demo",
    geometry: {
      type: "LineString",
      coordinates: route.geometry.coordinates,
    },
    distanceMeters: Number(route.distance || 0),
    durationSeconds: Number(route.duration || 0),
    guidanceSteps: normalizeOsrmGuidanceSteps(route),
    raw: route,
    strategy: "balanced",
    availableStrategies: [...APP_CONFIG.strategyOrder],
    sourceKind: "provider-route",
    providerRank: index + 1,
  }));

  return {
    provider: "osrm-demo",
    providerNote: buildProviderNote({
      provider: "osrm-demo",
      strategies: APP_CONFIG.strategyOrder,
      routeCount: routes.length,
      note:
        routes.length > 1
          ? "Alternativas reales del provider. Las estrategias se aplican en el ranking, no en la geometria."
          : "El provider devolvio una sola ruta real; la recomendacion usa riesgo e historial sin inventar variantes.",
    }),
    usesHeuristics: false,
    routes,
  };
}

function mergeRouteCandidates(routes) {
  const bucket = new Map();

  routes.forEach((route) => {
    const fingerprint = buildGeometryFingerprint(route.geometry, route.distanceMeters, route.durationSeconds);
    const existing = bucket.get(fingerprint);

    if (!existing) {
      bucket.set(fingerprint, {
        ...route,
        id: "",
        availableStrategies: [route.strategy],
        sourceKind: "provider-route",
      });
      return;
    }

    existing.availableStrategies = [...new Set([...existing.availableStrategies, route.strategy])];
    existing.providerRank = Math.min(existing.providerRank, route.providerRank);
  });

  return [...bucket.values()]
    .sort((left, right) => left.providerRank - right.providerRank || left.durationSeconds - right.durationSeconds)
    .map((route, index) => ({
      ...route,
      id: `route-${index + 1}`,
      strategy: route.availableStrategies.includes("balanced") ? "balanced" : route.availableStrategies[0],
    }));
}

function buildGeometryFingerprint(geometry, distanceMeters, durationSeconds) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return `${Math.round(distanceMeters)}:${Math.round(durationSeconds)}`;
  }

  const coordinates = geometry.type === "MultiLineString" ? geometry.coordinates.flat() : geometry.coordinates;

  if (!coordinates.length) {
    return `${Math.round(distanceMeters)}:${Math.round(durationSeconds)}`;
  }

  const middleIndex = Math.floor(coordinates.length / 2);
  const signature = [coordinates[0], coordinates[middleIndex], coordinates[coordinates.length - 1]]
    .filter(Boolean)
    .map(([lng, lat]) => `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`)
    .join("|");

  return `${signature}|${Math.round(distanceMeters)}|${Math.round(durationSeconds)}`;
}

function buildProviderNote({ provider, strategies, routeCount, note }) {
  const coverage =
    strategies.length === APP_CONFIG.strategyOrder.length
      ? "rapida, equilibrada y prudente"
      : strategies.map((strategy) => mapStrategyLabel(strategy)).join(", ");

  return `Provider: ${provider} | ${routeCount} ruta${routeCount === 1 ? "" : "s"} real${routeCount === 1 ? "" : "es"} | cobertura ${coverage} | ${note}`;
}

function normalizeOsrmGuidanceSteps(route) {
  const steps = (route.legs || []).flatMap((leg) => leg.steps || []);

  return steps.map((step, index) => ({
    index,
    maneuverType: mapOsrmManeuverType(step.maneuver?.type, step.maneuver?.modifier),
    modifier: String(step.maneuver?.modifier || "").trim(),
    streetName: String(step.name || step.ref || "").trim(),
    distanceMeters: Number(step.distance || 0),
    durationSeconds: Number(step.duration || 0),
    coordinate: Array.isArray(step.maneuver?.location)
      ? {
          lng: Number(step.maneuver.location[0]),
          lat: Number(step.maneuver.location[1]),
        }
      : null,
    instruction: "",
  }));
}

function normalizeOrsGuidanceSteps(feature) {
  const coordinates = feature?.geometry?.type === "LineString"
    ? feature.geometry.coordinates || []
    : [];
  const steps = (feature?.properties?.segments || []).flatMap((segment) => segment.steps || []);

  return steps.map((step, index) => {
    const geometryIndex = Array.isArray(step.way_points) ? Number(step.way_points[0]) : -1;
    const coordinate = coordinates[geometryIndex];

    return {
      index,
      maneuverType: mapOrsManeuverType(step.type),
      modifier: "",
      streetName: String(step.name || "").trim(),
      distanceMeters: Number(step.distance || 0),
      durationSeconds: Number(step.duration || 0),
      coordinate: Array.isArray(coordinate)
        ? {
            lng: Number(coordinate[0]),
            lat: Number(coordinate[1]),
          }
        : null,
      geometryIndex: geometryIndex >= 0 ? geometryIndex : null,
      instruction: String(step.instruction || "").trim(),
    };
  });
}

function mapOsrmManeuverType(type, modifier) {
  const safeType = String(type || "").trim().toLowerCase();
  const safeModifier = String(modifier || "").trim().toLowerCase();

  if (safeType === "arrive") {
    return "arrive";
  }

  if (safeModifier === "left" || safeModifier === "sharp left") {
    return "left";
  }

  if (safeModifier === "right" || safeModifier === "sharp right") {
    return "right";
  }

  if (safeModifier === "slight left") {
    return "slight-left";
  }

  if (safeModifier === "slight right") {
    return "slight-right";
  }

  if (safeModifier === "straight") {
    return "continue";
  }

  if (safeType === "depart") {
    return "continue";
  }

  if (safeType === "new name" || safeType === "continue" || safeType === "merge") {
    return "continue";
  }

  return safeType || "continue";
}

function mapOrsManeuverType(typeCode) {
  const safeType = Number(typeCode);

  if (safeType === 0 || safeType === 2) {
    return "left";
  }

  if (safeType === 1 || safeType === 3) {
    return "right";
  }

  if (safeType === 4 || safeType === 12) {
    return "slight-left";
  }

  if (safeType === 5 || safeType === 13) {
    return "slight-right";
  }

  if (safeType === 10) {
    return "arrive";
  }

  if (safeType === 11 || safeType === 6) {
    return "continue";
  }

  if (safeType === 9) {
    return "uturn";
  }

  return "continue";
}

function mapStrategyLabel(strategy) {
  if (strategy === "fast") {
    return "rapida";
  }

  if (strategy === "cautious") {
    return "prudente";
  }

  return "equilibrada";
}
