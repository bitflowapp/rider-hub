import { APP_CONFIG, getRuntimeConfig } from "../utils/app_config.js";
import { buildAvoidPolygons } from "./risk_service.js";

export async function getRoute({ origin, destination, strategy }) {
  const runtimeConfig = getRuntimeConfig();

  if (runtimeConfig.orsApiKey) {
    try {
      return await getOrsRoute({ origin, destination, strategy, apiKey: runtimeConfig.orsApiKey });
    } catch (error) {
      console.warn("openrouteservice no respondio, hago fallback a OSRM demo.", error);
    }
  }

  return getOsrmRoute({ origin, destination });
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
      target_count: 3,
      share_factor: 0.6,
      weight_factor: 1.8,
    },
  };

  const avoidPolygons = buildAvoidPolygons(strategy);

  if (avoidPolygons) {
    body.options.avoid_polygons = avoidPolygons;
  }

  const response = await fetch(APP_CONFIG.providers.routing.orsUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8",
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
