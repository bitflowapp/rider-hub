export const PLACE_MEMORY_VERSION = 1;

export const PLACE_MEMORY_TAGS = [
  { id: "favorite", label: "Favorita" },
  { id: "useful_access", label: "Acceso util" },
  { id: "complicated_building", label: "Edificio complicado" },
  { id: "awkward_street", label: "Calle incomoda" },
  { id: "best_entry", label: "Mejor entrada" },
  { id: "heavy_climb", label: "Subida pesada" },
  { id: "night_avoid", label: "Evitar de noche" },
];

export const PLACE_MEMORY_TAG_MAP = PLACE_MEMORY_TAGS.reduce((accumulator, tag) => {
  accumulator[tag.id] = tag;
  return accumulator;
}, {});

export function normalizePlaceMemoryEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return [...items]
    .map(normalizePlaceMemoryEntry)
    .filter(Boolean)
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

export function normalizePlaceMemoryEntry(item) {
  const createdAt = new Date(item?.createdAt || item?.updatedAt || Date.now());
  const updatedAt = new Date(item?.updatedAt || item?.createdAt || Date.now());
  const normalizedAddress = String(item?.normalizedAddress || "").trim();
  const streetName = String(item?.streetName || "").trim();
  const zoneLabel = String(item?.zoneLabel || "").trim();

  if (
    Number.isNaN(createdAt.getTime()) ||
    Number.isNaN(updatedAt.getTime()) ||
    !normalizedAddress ||
    !streetName ||
    !zoneLabel
  ) {
    return null;
  }

  return {
    version: PLACE_MEMORY_VERSION,
    id: String(item?.id || item?.normalizedKey || `place-${updatedAt.getTime()}`),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    normalizedAddress,
    normalizedKey: String(item?.normalizedKey || "").trim(),
    streetName,
    streetKey: String(item?.streetKey || "").trim(),
    zoneLabel,
    zoneKey: String(item?.zoneKey || "").trim(),
    sectorLabel: String(item?.sectorLabel || zoneLabel).trim(),
    sectorKey: String(item?.sectorKey || item?.zoneKey || "").trim(),
    tags: normalizePlaceMemoryTags(item?.tags || []),
    note: String(item?.note || "").trim(),
  };
}

export function normalizePlaceMemoryTags(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set();

  return items
    .map((item) => String(item || "").trim())
    .filter((item) => PLACE_MEMORY_TAG_MAP[item] && !seen.has(item) && seen.add(item));
}

export function getPlaceMemoryTagLabel(tagId) {
  return PLACE_MEMORY_TAG_MAP[tagId]?.label || "Memoria";
}
