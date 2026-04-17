import { APP_CONFIG } from "../utils/app_config.js";
import { readJsonStorage, writeJsonStorage } from "../utils/storage_utils.js";
import { normalizePlaceMemoryEntries } from "./place_memory_schema.js";

export function loadPlaceMemoryEntries() {
  return normalizePlaceMemoryEntries(readJsonStorage(APP_CONFIG.storageKeys.placeMemory, []));
}

export function persistPlaceMemoryEntries(entries) {
  const normalizedEntries = normalizePlaceMemoryEntries(entries);
  writeJsonStorage(APP_CONFIG.storageKeys.placeMemory, normalizedEntries);
  return normalizedEntries;
}
