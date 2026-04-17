import { compactDestinationLabel } from "../utils/address_utils.js";
import { getHourContext } from "../utils/time_utils.js";
import { loadPlaceMemoryEntries, persistPlaceMemoryEntries } from "../data/place_memory_store.js";
import {
  getPlaceMemoryTagLabel,
  normalizePlaceMemoryEntry,
  normalizePlaceMemoryTags,
} from "../data/place_memory_schema.js";

export function getPlaceMemories() {
  return loadPlaceMemoryEntries();
}

export function savePlaceMemory(entry) {
  const normalizedEntry = normalizePlaceMemoryEntry({
    ...entry,
    updatedAt: new Date().toISOString(),
  });

  if (!normalizedEntry) {
    return null;
  }

  const existingEntries = loadPlaceMemoryEntries();
  const existingIndex = existingEntries.findIndex((item) => item.normalizedKey === normalizedEntry.normalizedKey);
  const mergedEntry =
    existingIndex >= 0
      ? mergePlaceMemoryEntries(existingEntries[existingIndex], normalizedEntry)
      : normalizedEntry;
  const nextEntries = existingEntries.filter((item, index) => index !== existingIndex);

  return persistPlaceMemoryEntries([mergedEntry, ...nextEntries])[0] || null;
}

export function summarizePlaceMemoryForDestination(profile, hourContext = getHourContext()) {
  const safeProfile = profile || {};
  const matches = getPlaceMemories()
    .map((entry) => {
      const match = matchPlaceMemory(entry, safeProfile);
      return match ? { ...entry, ...match } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.priority - left.priority || new Date(right.updatedAt) - new Date(left.updatedAt));

  if (!matches.length) {
    return {
      hasMemory: false,
      tags: [],
      note: "",
      headline: "Sin memoria local guardada",
      detail: "Todavia no guardaste favoritas, accesos ni observaciones para este destino, calle o zona.",
      relevantEntries: [],
      tone: "neutral",
      shouldAvoidAtNight: false,
      canAutoFillDraft: false,
    };
  }

  const relevantEntries = matches.slice(0, 5);
  const tags = normalizePlaceMemoryTags(relevantEntries.flatMap((entry) => entry.tags));
  const note = relevantEntries.find((entry) => entry.note)?.note || "";
  const exactEntry = relevantEntries.find((entry) => entry.matchType === "exact") || null;
  const shouldAvoidAtNight = hourContext === "night" && tags.includes("night_avoid");
  const headline = buildPlaceMemoryHeadline(tags, relevantEntries, shouldAvoidAtNight);
  const detail = buildPlaceMemoryDetail(tags, note, relevantEntries);

  return {
    hasMemory: true,
    tags,
    note,
    headline,
    detail,
    relevantEntries,
    exactEntry,
    tone: shouldAvoidAtNight ? "warning" : tags.includes("favorite") ? "normal" : "neutral",
    shouldAvoidAtNight,
    canAutoFillDraft: Boolean(exactEntry),
  };
}

export function buildPlaceMemoryEntry({ destinationProfile, tags = [], note = "" }) {
  if (!destinationProfile?.normalizedAddress || !destinationProfile?.streetName || !destinationProfile?.zoneLabel) {
    return null;
  }

  return {
    normalizedAddress: compactDestinationLabel(destinationProfile.normalizedAddress),
    normalizedKey: destinationProfile.normalizedKey,
    streetName: destinationProfile.streetName,
    streetKey: destinationProfile.streetKey,
    zoneLabel: destinationProfile.zoneLabel,
    zoneKey: destinationProfile.zoneKey,
    sectorLabel: destinationProfile.sectorLabel,
    sectorKey: destinationProfile.sectorKey,
    tags: normalizePlaceMemoryTags(tags),
    note: String(note || "").trim(),
  };
}

function mergePlaceMemoryEntries(existingEntry, nextEntry) {
  return {
    ...existingEntry,
    ...nextEntry,
    createdAt: existingEntry.createdAt,
    tags: normalizePlaceMemoryTags([...(existingEntry.tags || []), ...(nextEntry.tags || [])]),
    note: nextEntry.note || existingEntry.note || "",
  };
}

function matchPlaceMemory(entry, profile) {
  if (entry.normalizedKey && profile.normalizedKey && entry.normalizedKey === profile.normalizedKey) {
    return {
      matchType: "exact",
      priority: 4,
    };
  }

  if (entry.streetKey && profile.streetKey && entry.streetKey === profile.streetKey) {
    return {
      matchType: "street",
      priority: 3,
    };
  }

  if (entry.sectorKey && profile.sectorKey && entry.sectorKey === profile.sectorKey) {
    return {
      matchType: "sector",
      priority: 2,
    };
  }

  if (entry.zoneKey && profile.zoneKey && entry.zoneKey === profile.zoneKey) {
    return {
      matchType: "zone",
      priority: 1,
    };
  }

  return null;
}

function buildPlaceMemoryHeadline(tags, relevantEntries, shouldAvoidAtNight) {
  if (shouldAvoidAtNight) {
    return "Memoria local: mejor evitar de noche";
  }

  if (tags.includes("favorite")) {
    return "Memoria local: destino favorito";
  }

  if (tags.includes("best_entry") || tags.includes("useful_access")) {
    return "Memoria local: acceso guardado";
  }

  if (tags.includes("complicated_building") || tags.includes("awkward_street")) {
    return "Memoria local: punto delicado";
  }

  return `Memoria local: ${relevantEntries.length} nota${relevantEntries.length === 1 ? "" : "s"} util${relevantEntries.length === 1 ? "" : "es"}`;
}

function buildPlaceMemoryDetail(tags, note, relevantEntries) {
  const pieces = tags.slice(0, 3).map(getPlaceMemoryTagLabel);

  if (note) {
    pieces.push(note);
  } else {
    const relatedLabel = relevantEntries[0]?.matchType === "exact"
      ? compactDestinationLabel(relevantEntries[0].normalizedAddress)
      : relevantEntries[0]?.matchType === "street"
        ? relevantEntries[0].streetName
        : relevantEntries[0]?.zoneLabel || "";

    if (relatedLabel) {
      pieces.push(`Aplica a ${relatedLabel}`);
    }
  }

  return pieces.filter(Boolean).join(" | ");
}
