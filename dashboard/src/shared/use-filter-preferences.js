import { createContext, useContext, useMemo, useRef, useState } from "react";
import { createFilterPreferences, parseLocalSearchQuery } from "./filter-preferences.js";

export const FilterPreferencesContext = createContext(null);
export const FilterPageContext = createContext("/");

export function useRememberedRoute(rawRoute, setRawRoute, userId, apiBaseUrl) {
  const store = useMemo(() => createFilterPreferences({ userId, apiBaseUrl }), [userId, apiBaseUrl]);
  void setRawRoute;
  return { route: rawRoute, store };
}

// Local-only filter panels (e.g. an in-progress bulk preview) keep React state for
// the current page visit only. Values are not restored after navigation.
export function useSavedFilters(page, parse) {
  const store = useContext(FilterPreferencesContext);
  const routePath = useContext(FilterPageContext);
  page = `${routePath}:${page}`;
  const load = () => ({ store, page, value: parse(store?.read(page, parse) || "") });
  const [snapshot, setSnapshot] = useState(load);
  let current = snapshot;
  if (snapshot.store !== store || snapshot.page !== page) {
    current = load();
    setSnapshot(current);
  }
  const currentRef = useRef(current);
  currentRef.current = current;
  const setValue = next => {
    const value = typeof next === "function" ? next(currentRef.current.value) : next;
    const query = new URLSearchParams(value).toString();
    const clean = parse(query);
    if (JSON.stringify(clean) === JSON.stringify(currentRef.current.value)) return;
    store?.write(page, query, parse);
    currentRef.current = { store, page, value: clean };
    setSnapshot(currentRef.current);
  };
  return [current.value, setValue];
}

export function useSavedSearch(panel) {
  const [filters, setFilters] = useSavedFilters(panel, parseLocalSearchQuery);
  return [filters.search, search => setFilters({ search })];
}
