export const APP_CONFIG = {
  appName: "Rider Maps Neuquen",
  cityDisplay: "Neuquen Capital",
  cityQuery: "Neuquen Capital, Neuquen, Argentina",
  provinceDisplay: "Neuquen",
  countryDisplay: "Argentina",
  center: {
    lng: -68.0591,
    lat: -38.9516,
  },
  referenceOrigin: {
    lng: -68.0591,
    lat: -38.9516,
    label: "Centro de Neuquen (referencia)",
    isApproximate: true,
  },
  defaultZoom: 13.45,
  focusZoom: 15.35,
  maxBounds: [
    [-68.18, -39.03],
    [-67.98, -38.87],
  ],
  geocodeBBox: [-68.18, -39.03, -67.98, -38.87],
  mapStyleUrl: "https://tiles.openfreemap.org/styles/positron",
  storageKeys: {
    destinationHistory: "riderMaps.destinationHistory.v3",
    lastStrategy: "riderMaps.lastStrategy.v2",
    routeFeedback: "riderMaps.routeFeedback.v2",
    tripMemory: "riderMaps.tripMemory.v1",
    placeMemory: "riderMaps.placeMemory.v1",
    sessionState: "riderMaps.sessionState.v1",
    cashEntries: "riderHub.cashEntries.v2",
    legacyOrders: "riderHub.orders.v1",
    lastResolvedAddress: "riderMaps.lastResolvedAddress.v1",
  },
  providers: {
    geocoding: {
      photonUrl: "https://photon.komoot.io/api/",
      photonReverseUrl: "https://photon.komoot.io/reverse",
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
  recentTripMemoryLimit: 8,
  recentPlaceMemoryLimit: 8,
  maxRouteAlternatives: 4,
  trackingPointSpacingMeters: 18,
  trackingPathLimit: 80,
  trackingSessionSaveDebounceMs: 1200,
  deviationThresholdMeters: 85,
  deviationAccuracyLimitMeters: 95,
  deviationGracePeriodSeconds: 25,
  deviationAutoRecalcDebounceMs: 35000,
  deviationAutoRecalcDelayMs: 2800,
};

export function getRuntimeConfig() {
  const runtime = globalThis.RIDER_MAPS_CONFIG || {};

  return {
    orsApiKey: String(runtime.orsApiKey || "").trim(),
    mapStyleUrl: String(runtime.mapStyleUrl || "").trim() || APP_CONFIG.mapStyleUrl,
  };
}
