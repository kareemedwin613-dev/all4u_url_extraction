import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createFilterPreferences, parseLocalSearchQuery } from "./filter-preferences.js";

export const FilterPreferencesContext = createContext(null);
export const FilterPageContext = createContext("/");

export function useRememberedRoute(rawRoute, setRawRoute, userId, apiBaseUrl) {
  const store = useMemo(() => createFilterPreferences({ userId, apiBaseUrl }), [userId, apiBaseUrl]);
  const lastAccount = useRef(null);
  const switched = Boolean(userId && lastAccount.current && lastAccount.current !== store.scope);
  const route = useMemo(() => store.resolve(switched ? { ...rawRoute, query: "" } : rawRoute), [store, rawRoute, switched]);
  useEffect(() => {
    if (!userId) return;
    lastAccount.current = store.scope;
    store.remember(route);
    if (route !== rawRoute) {
      // replaceState does not fire hashchange: update React's route as well.
      globalThis.history?.replaceState(null, "", `#${route.path}${route.query ? `?${route.query}` : ""}`);
      setRawRoute(route);
    }
  }, [store, route, rawRoute, setRawRoute, userId]);
  return { route, store };
}

// Local-only filter panels (e.g. an in-progress bulk preview) use the same
// per-user store without serializing their workflow state into the URL.
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
