import { RISK_ZONES } from "../data/risk_zones.js";

const LEVEL_PRIORITY = {
  normal: 0,
  caution: 1,
  high: 2,
  night: 3,
};

const STRATEGY_WEIGHTS = {
  fast: 2.5,
  balanced: 6.5,
  cautious: 11,
};

export function getRiskZones() {
  return RISK_ZONES;
}

export function evaluateRouteRisk(routeFeature) {
  const coordinates = extractLineCoordinates(routeFeature);
  const matchedZones = RISK_ZONES.features.filter((zone) =>
    routeIntersectsPolygon(coordinates, zone.geometry.coordinates[0])
  );
  const totalWeight = matchedZones.reduce(
    (total, zone) => total + Number(zone.properties?.weight || 0),
    0
  );
  const maxPriority = matchedZones.reduce(
    (maxValue, zone) => Math.max(maxValue, LEVEL_PRIORITY[zone.properties?.level] || 0),
    0
  );
  const reasons = matchedZones.map((zone) => zone.properties?.reason).filter(Boolean);
  const names = matchedZones.map((zone) => zone.properties?.name).filter(Boolean);

  return {
    label: classifyRisk(totalWeight, maxPriority),
    score: totalWeight,
    matchedZones: names,
    reasons: uniqueList(reasons),
    hasNightWarning: matchedZones.some((zone) => zone.properties?.level === "night"),
  };
}

export function scoreRouteForStrategy(route, riskSummary, strategy) {
  const durationMinutes = Number(route.durationSeconds || 0) / 60;
  const riskPenalty = riskSummary.score * (STRATEGY_WEIGHTS[strategy] || STRATEGY_WEIGHTS.balanced);
  const nightPenalty = strategy === "cautious" && riskSummary.hasNightWarning ? 25 : 0;

  return durationMinutes + riskPenalty + nightPenalty;
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

function classifyRisk(totalWeight, maxPriority) {
  if (maxPriority >= LEVEL_PRIORITY.night) {
    return "No recomendado de noche";
  }

  if (maxPriority >= LEVEL_PRIORITY.high || totalWeight >= 5) {
    return "Alta precaucion";
  }

  if (maxPriority >= LEVEL_PRIORITY.caution || totalWeight >= 2) {
    return "Precaucion";
  }

  return "Normal";
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
