export const APP_CONFIG = {
  appName: "Rider Maps Neuquen",
  cityDisplay: "Neuqu\u00e9n Capital",
  cityQuery: "Neuqu\u00e9n Capital, Neuqu\u00e9n, Argentina",
  center: {
    lng: -68.0591,
    lat: -38.9516,
  },
  referenceOrigin: {
    lng: -68.0591,
    lat: -38.9516,
    label: "Centro de Neuqu\u00e9n (referencia)",
    isApproximate: true,
  },
  defaultZoom: 13.25,
  maxBounds: [
    [-68.18, -39.03],
    [-67.98, -38.87],
  ],
  geocodeBBox: [-68.18, -39.03, -67.98, -38.87],
  mapStyleUrl: "https://tiles.openfreemap.org/styles/liberty",
  storageKeys: {
    destinationHistory: "riderMaps.destinationHistory.v2",
    lastStrategy: "riderMaps.lastStrategy.v1",
    routeFeedback: "riderMaps.routeFeedback.v1",
    cashEntries: "riderHub.cashEntries.v2",
    legacyOrders: "riderHub.orders.v1",
  },
  providers: {
    geocoding: {
      photonUrl: "https://photon.komoot.io/api/",
    },
    routing: {
      orsUrl: "https://api.openrouteservice.org/v2/directions/cycling-regular/geojson",
      osrmUrl: "https://router.project-osrm.org/route/v1/bicycle",
    },
  },
  blockedLocalities: [
    "cipolletti",
    "plottier",
    "centenario",
    "senillosa",
    "fernandez oro",
    "cinco saltos",
    "contralmirante cordero",
    "vista alegre",
    "allen",
    "general roca",
    "rio negro",
    "cutral co",
    "plaza huincul",
    "zapala",
    "buenos aires",
    "caba",
    "cordoba",
  ],
  strategyOrder: ["fast", "balanced", "cautious"],
  maxHistoryItems: 12,
  recentFeedbackLimit: 8,
};

export function getRuntimeConfig() {
  const runtime = globalThis.RIDER_MAPS_CONFIG || {};

  return {
    orsApiKey: String(runtime.orsApiKey || "").trim(),
    mapStyleUrl: String(runtime.mapStyleUrl || "").trim() || APP_CONFIG.mapStyleUrl,
  };
}
