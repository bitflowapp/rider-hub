import { processAddressInput } from "../engine/engine.js";
import { APP_CONFIG } from "./app_config.js";

const CITY_SUFFIX = `, ${APP_CONFIG.cityQuery}`;

export function normalizeAddressText(value) {
  return processAddressInput(value)
    .replace(/\u00a0/g, " ")
    .replace(/[|]+/g, " ")
    .replace(/[–—]+/g, " ")
    .replace(/[;:_*+=~`"'“”‘’<>[\]{}()!?¡¿]+/g, " ")
    .replace(/[\\/#]+/g, " ")
    .replace(/[°º]/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:^,\s*|\s*,\s*$)/g, "")
    .trim();
}

export function toAsciiMatch(value) {
  return normalizeAddressText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function compactDestinationLabel(value) {
  const address = normalizeAddressText(value);
  return address.endsWith(CITY_SUFFIX) ? address.slice(0, -CITY_SUFFIX.length) : address;
}

export function buildGoogleMapsUrl({ origin, destination }) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("travelmode", "bicycling");

  if (origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)) {
    url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  }

  if (destination?.coordinates) {
    url.searchParams.set("destination", `${destination.coordinates.lat},${destination.coordinates.lng}`);
  } else if (destination?.label) {
    url.searchParams.set("destination", destination.label);
  }

  return url.toString();
}

export function findBlockedLocality(rawText) {
  const asciiText = toAsciiMatch(rawText);

  return APP_CONFIG.blockedLocalities.find((locality) => {
    const pattern = new RegExp(`(^|\\b)${escapeRegex(locality)}(\\b|$)`, "i");
    return pattern.test(asciiText);
  }) || null;
}

export function prepareAddressSearch(rawText) {
  const cleaned = normalizeAddressText(rawText);

  if (!cleaned) {
    return {
      ok: false,
      reason: "Ingresa una direccion antes de buscar.",
    };
  }

  const blockedLocality = findBlockedLocality(cleaned);

  if (blockedLocality) {
    return {
      ok: false,
      reason: `La direccion parece pertenecer a ${formatLocalityLabel(blockedLocality)}. Rider Maps Neuquen solo trabaja dentro de ${APP_CONFIG.cityDisplay}.`,
    };
  }

  const stripped = cleaned
    .replace(/\bNeuquen(?:\s+Capital)?\b/gi, "")
    .replace(/\bNQN\b/gi, "")
    .replace(/\bProvincia(?:\s+de|\s+del)?\s+Neuquen\b/gi, "")
    .replace(/\bArgentina\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/(?:^,\s*|\s*,\s*$)/g, "")
    .trim();

  if (stripped.length < 4) {
    return {
      ok: false,
      reason: "Suma calle y altura para buscar una direccion confiable.",
    };
  }

  return {
    ok: true,
    cleanedInput: cleaned,
    searchLabel: stripped,
    query: `${stripped}, Neuquen`,
  };
}

export function isWithinNeuquenBounds(lng, lat) {
  const [[minLng, minLat], [maxLng, maxLat]] = APP_CONFIG.maxBounds;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

export function buildDestinationHistoryEntry(destination) {
  return {
    id: destination.id,
    label: destination.label,
    displayName: destination.displayName,
    coordinates: destination.coordinates,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeDestinationHistory(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenLabels = new Set();

  return items
    .map((item) => {
      const label = normalizeAddressText(item?.label);
      const createdAt = new Date(item?.createdAt || Date.now());
      const lng = Number(item?.coordinates?.lng);
      const lat = Number(item?.coordinates?.lat);

      if (!label || Number.isNaN(createdAt.getTime()) || !Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
      }

      const lookupKey = toAsciiMatch(label);

      if (seenLabels.has(lookupKey)) {
        return null;
      }

      seenLabels.add(lookupKey);

      return {
        id: String(item?.id || lookupKey),
        label,
        displayName: normalizeAddressText(item?.displayName) || label,
        coordinates: { lng, lat },
        createdAt: createdAt.toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, APP_CONFIG.maxHistoryItems);
}

export function formatLocalityLabel(value) {
  return value
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
