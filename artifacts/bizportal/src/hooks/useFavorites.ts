import { usePinnedPages } from "./usePinnedPages";

export function useFavorites() {
  const { pins, togglePin } = usePinnedPages();
  return { favorites: pins, toggleFavorite: togglePin };
}
