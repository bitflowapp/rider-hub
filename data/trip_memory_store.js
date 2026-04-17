import { APP_CONFIG } from "../utils/app_config.js";
import { readJsonStorage, writeJsonStorage } from "../utils/storage_utils.js";
import { normalizeTripMemoryEntries } from "./trip_memory_schema.js";

export function loadTripMemoryEntries() {
  return normalizeTripMemoryEntries(readJsonStorage(APP_CONFIG.storageKeys.tripMemory, []));
}

export function persistTripMemoryEntries(entries) {
  const normalizedEntries = normalizeTripMemoryEntries(entries);
  writeJsonStorage(APP_CONFIG.storageKeys.tripMemory, normalizedEntries);
  return normalizedEntries;
}
