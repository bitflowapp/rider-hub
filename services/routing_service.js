import { APP_CONFIG, getRuntimeConfig } from "../utils/app_config.js";
import { buildAvoidPolygons } from "./risk_service.js";

export async function getRoute({ origin, destination, strategy }) {
  const runtimeConfig = getRuntimeConfig();

  if (runtimeConfig.orsApiKey) {
    try {
      return await getOrsRoute({ origin, destination, strategy, apiKey: runtimeConfig.orsApiKey });
    } catch (error) {
      console.warn("openrouteservice no respondio; hago fallback a OSRM demo.", error);
    }
  }

  return getOsrmRoute({ origin, destination });
}

export function getAlternativeRoutes(routes, activeRouteId) {
  return routes.filter((route) => route.id !== activeRouteId);
}

export function summarizeRoute({ route, strategy, operationalRisk }) {
  const label = operationalRisk?.overallLabel || "Normal";

  if (strategy === "fast") {
    return label === "Normal"
      ? "Mas rapida para llegar sin desvio extra."
      : "Mas rapida, pero toca zona de atencion.";
  }

  if (strategy === "cautious") {
    return label === "Normal"
      ? "Prudente: prioriza trayecto mas estable."
      : "Prudente: intenta bajar exposicion aunque alargue un poco.";
  }

  if (label === "Normal") {
    return "Equilibrada: balancea tiempo y estabilidad.";
  }

  return "Equilibrada: evita parte de la exposicion sin alargar demasiado.";
}

async function getOrsRoute({ origin, destination, strategy, apiKey }) {
  const body = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    instructions: false,
    units: "m",
    elevation: false,
    options: {},
    alternative_routes: {
      target_count: APP_CONFIG.maxRouteAlternatives,
      share_factor: 0.62,
      weight_factor: strategy === "cautious" ? 2.3 : 1.85,
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
  const routes = (payload.features || []).map((feature, index) => ({
    id: `route-${index + 1}`,
    provider: "openrouteservice",
    geometry: feature.geometry,
    distanceMeters: Number(feature.properties?.summary?.distance || 0),
    durationSeconds: Number(feature.properties?.summary?.duration || 0),
    raw: feature,
  }));

  if (!routes.length) {
    throw new Error("openrouteservice no devolvio rutas.");
  }

  return {
    provider: "openrouteservice",
    routes,
  };
}

async function getOsrmRoute({ origin, destination }) {
  const baseUrl = `${APP_CONFIG.providers.routing.osrmUrl}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(baseUrl);
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`OSRM devolvio ${response.status}.`);
  }

  const payload = await response.json();

  if (payload.code !== "Ok" || !Array.isArray(payload.routes) || !payload.routes.length) {
    throw new Error("OSRM no pudo calcular una ruta usable.");
  }

  return {
    provider: "osrm-demo",
    routes: payload.routes.map((route, index) => ({
      id: `route-${index + 1}`,
      provider: "osrm-demo",
      geometry: {
        type: "LineString",
        coordinates: route.geometry.coordinates,
      },
      distanceMeters: Number(route.distance || 0),
      durationSeconds: Number(route.duration || 0),
      raw: route,
    })),
  };
}
