import { APP_CONFIG } from "../utils/app_config.js";
import {
  isGeocodedCandidateAccepted,
  normalizeAddressText,
  prepareAddressSearch,
  toAsciiMatch,
} from "../utils/address_utils.js";

export async function geocodeAddress(rawText) {
  const prepared = prepareAddressSearch(rawText);

  if (!prepared.ok) {
    return prepared;
  }

  const url = new URL(APP_CONFIG.providers.geocoding.photonUrl);
  url.searchParams.set("q", prepared.query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("bbox", APP_CONFIG.geocodeBBox.join(","));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`No pude consultar el geocoder (${response.status}).`);
  }

  const payload = await response.json();
  const matches = (payload.features || [])
    .map((feature) => mapPhotonFeature(feature, prepared.searchLabel))
    .filter(isGeocodedCandidateAccepted)
    .sort((left, right) => right.matchScore - left.matchScore);

  if (!matches.length) {
    return {
      ok: false,
      provider: "photon",
      reason: `No encontre una coincidencia confiable dentro de ${APP_CONFIG.cityDisplay}.`,
    };
  }

  return {
    ok: true,
    provider: "photon",
    destination: matches[0],
    matches,
  };
}

function mapPhotonFeature(feature, searchLabel) {
  const properties = feature.properties || {};
  const geometry = feature.geometry || {};
  const coordinates = geometry.coordinates || [];
  const street = normalizeAddressText(properties.street);
  const houseNumber = normalizeAddressText(properties.housenumber);
  const district = normalizeAddressText(properties.district);
  const city = normalizeAddressText(properties.city || APP_CONFIG.cityDisplay);
  const labelBase = [street, houseNumber].filter(Boolean).join(" ").trim();
  const label = labelBase
    ? `${labelBase}, ${APP_CONFIG.cityDisplay}, Neuquen, Argentina`
    : normalizeAddressText(feature.properties?.name || feature.properties?.street || "");
  const displayName = normalizeAddressText(
    [labelBase || properties.name, district, city, "Neuquen", "Argentina"].filter(Boolean).join(", ")
  );

  return {
    id: `photon-${feature.properties?.osm_type || "x"}-${feature.properties?.osm_id || Math.random()}`,
    label,
    displayName,
    coordinates: {
      lng: Number(coordinates[0]),
      lat: Number(coordinates[1]),
    },
    properties,
    matchScore: buildMatchScore({
      searchLabel,
      street,
      houseNumber,
      displayName,
    }),
  };
}

function buildMatchScore({ searchLabel, street, houseNumber, displayName }) {
  const searchAscii = toAsciiMatch(searchLabel);
  const streetAscii = toAsciiMatch(street);
  const displayAscii = toAsciiMatch(displayName);
  let score = 0;

  if (streetAscii && searchAscii.includes(streetAscii)) {
    score += 6;
  }

  if (houseNumber && searchAscii.includes(toAsciiMatch(houseNumber))) {
    score += 4;
  }

  if (displayAscii.includes(searchAscii)) {
    score += 3;
  }

  return score;
}
