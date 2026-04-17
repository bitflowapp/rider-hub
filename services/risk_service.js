import { RISK_ZONES } from "../data/risk_zones.js";

const LEVEL_PRIORITY = {
  normal: 0,
  caution: 1,
  high: 2,
  night: 3,
};

const LABEL_BY_LEVEL = {
  normal: "Normal",
  caution: "Precaucion",
  high: "Alta precaucion",
  night: "No recomendado de noche",
};

const STRATEGY_WEIGHTS = {
  fast: 1.9,
  balanced: 4.7,
  cautious: 8.5,
};

export function getRiskZones() {
  return RISK_ZONES;
}

export function evaluateDestinationRisk(destinationPoint) {
  return evaluateFeatureRisk(destinationPoint, "destination");
}

export function evaluateRouteRisk(routeFeature) {
  return evaluateFeatureRisk(routeFeature, "route");
}

export function evaluateOperationalRisk({ destination, routeFeature }) {
  const destinationSummary = evaluateDestinationRisk(destination);
  const routeSummary = evaluateRouteRisk(routeFeature);
  const overallLevel = getHighestLevel([destinationSummary.level, routeSummary.level]);
  const reasons = uniqueList([...destinationSummary.reasons, ...routeSummary.reasons]).slice(0, 3);
  const matchedZones = uniqueList([...destinationSummary.matchedZones, ...routeSummary.matchedZones]);

  return {
    destinationRisk: destinationSummary.label,
    routeRisk: routeSummary.label,
    overallLabel: LABEL_BY_LEVEL[overallLevel],
    label: LABEL_BY_LEVEL[overallLevel],
    level: overallLevel,
    score: Math.max(destinationSummary.score, routeSummary.score),
    matchedZones,
    reasons,
    recommendation: buildRecommendation(overallLevel, reasons),
    hasNightWarning: destinationSummary.hasNightWarning || routeSummary.hasNightWarning,
    destinationSummary,
    routeSummary,
  };
}

export function scoreRouteForStrategy(route, operationalRisk, strategy) {
  const durationMinutes = Number(route.durationSeconds || 0) / 60;
  const distancePenalty = Number(route.distanceMeters || 0) / 1800;
  const riskPenalty = (operationalRisk.score || 0) * (STRATEGY_WEIGHTS[strategy] || STRATEGY_WEIGHTS.balanced);
  const nightPenalty = operationalRisk.hasNightWarning ? (strategy === "cautious" ? 15 : 24) : 0;

  return durationMinutes + distancePenalty + riskPenalty + nightPenalty;
}

export function buildAvoidPolygons(strategy) {
  const levelsToAvoid = strategy === "cautious" ? ["high", "night"] : strategy === "balanced" ? ["night"] : [];

  if (!levelsToAvoid.length) {
    return null;
  }

  const polygons = RISK_ZONES.features
    .filter((feature) => levelsToAvoid.includes(feature.properties?.level))
    .map((feature) => feature.geometry.coordinates);

  if (!polygons.length) {
    return null;
  }

  return {
    type: "MultiPolygon",
    coordinates: polygons,
  };
}

export function getRiskTone(label) {
  if (label === LABEL_BY_LEVEL.night) {
    return "night";
  }

  if (label === LABEL_BY_LEVEL.high) {
    return "danger";
  }

  if (label === LABEL_BY_LEVEL.caution) {
    return "warning";
  }

  return "normal";
}

function evaluateFeatureRisk(feature, mode) {
  const matchedZones = RISK_ZONES.features.filter((zone) => {
    if (mode === "destination") {
      return pointTouchesZone(extractPointCoordinates(feature), zone.geometry.coordinates[0]);
    }

    return routeIntersectsPolygon(extractLineCoordinates(feature), zone.geometry.coordinates[0]);
  });

  const totalWeight = matchedZones.reduce((total, zone) => total + Number(zone.properties?.weight || 0), 0);
  const strongestLevel = getHighestLevel(matchedZones.map((zone) => zone.properties?.level || "normal"));
  const reasons = matchedZones.map((zone) => zone.properties?.reason).filter(Boolean);
  const names = matchedZones.map((zone) => zone.properties?.name).filter(Boolean);

  return {
    level: classifyLevel(totalWeight, strongestLevel),
    label: LABEL_BY_LEVEL[classifyLevel(totalWeight, strongestLevel)],
    score: totalWeight,
    matchedZones: names,
    reasons: uniqueList(reasons),
    hasNightWarning: matchedZones.some((zone) => zone.properties?.level === "night"),
  };
}

function classifyLevel(totalWeight, strongestLevel) {
  if (strongestLevel === "night") {
    return "night";
  }

  if (strongestLevel === "high" || totalWeight >= 5) {
    return "high";
  }

  if (strongestLevel === "caution" || totalWeight >= 2) {
    return "caution";
  }

  return "normal";
}

function buildRecommendation(level, reasons) {
  if (level === "night") {
    return "No recomendado de noche por riesgo operativo cargado.";
  }

  if (level === "high") {
    return reasons[0] || "Conviene minimizar espera y elegir una ruta mas estable.";
  }

  if (level === "caution") {
    return reasons[0] || "Zona para operar con atencion.";
  }

  return "Sin alertas especificas cargadas.";
}

function getHighestLevel(levels) {
  return levels.reduce((highest, candidate) => {
    const safeCandidate = candidate && LEVEL_PRIORITY[candidate] != null ? candidate : "normal";
    return LEVEL_PRIORITY[safeCandidate] > LEVEL_PRIORITY[highest] ? safeCandidate : highest;
  }, "normal");
}

function extractPointCoordinates(feature) {
  if (!feature?.geometry || feature.geometry.type !== "Point") {
    return null;
  }

  return feature.geometry.coordinates || null;
}

function extractLineCoordinates(routeFeature) {
  if (!routeFeature?.geometry) {
    return [];
  }

  if (routeFeature.geometry.type === "LineString") {
    return routeFeature.geometry.coordinates || [];
  }

  if (routeFeature.geometry.type === "MultiLineString") {
    return routeFeature.geometry.coordinates.flat();
  }

  return [];
}

function pointTouchesZone(point, polygonRing) {
  if (!point || !polygonRing?.length) {
    return false;
  }

  return pointInPolygon(point, polygonRing);
}

function routeIntersectsPolygon(lineCoordinates, polygonRing) {
  if (!lineCoordinates.length || !polygonRing?.length) {
    return false;
  }

  const lineBbox = computeBbox(lineCoordinates);
  const polygonBbox = computeBbox(polygonRing);

  if (!bboxIntersects(lineBbox, polygonBbox)) {
    return false;
  }

  for (const point of lineCoordinates) {
    if (pointInPolygon(point, polygonRing)) {
      return true;
    }
  }

  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    const segmentStart = lineCoordinates[index];
    const segmentEnd = lineCoordinates[index + 1];

    for (let polygonIndex = 0; polygonIndex < polygonRing.length - 1; polygonIndex += 1) {
      const polygonStart = polygonRing[polygonIndex];
      const polygonEnd = polygonRing[polygonIndex + 1];

      if (segmentsIntersect(segmentStart, segmentEnd, polygonStart, polygonEnd)) {
        return true;
      }
    }
  }

  return false;
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function segmentsIntersect(a, b, c, d) {
  return (
    orientation(a, b, c) !== orientation(a, b, d) &&
    orientation(c, d, a) !== orientation(c, d, b)
  );
}

function orientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]) > 0;
}

function computeBbox(coordinates) {
  return coordinates.reduce(
    (bbox, [lng, lat]) => [
      Math.min(bbox[0], lng),
      Math.min(bbox[1], lat),
      Math.max(bbox[2], lng),
      Math.max(bbox[3], lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}

function bboxIntersects(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function uniqueList(items) {
  return [...new Set(items)];
}
