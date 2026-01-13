/**
 * AnnounceFlow Implementation Note:
 *
 * This file serves as the API abstraction layer.
 * Currently, we are using Shopify Metafields as our "Backend" Database via `metafields.server.ts`.
 *
 * In a future version where we migrate to a standalone backend (e.g. Node/Express + Mongo),
 * we would replace the imports from `metafields.server.ts` with actual `fetch` calls to that backend.
 *
 * The Loader/Action pattern in Remix acts as the "Server Controller" which calls these functions.
 */

// Re-export types for use in frontend
export * from "./types";

// Client-side API helpers (optional, if we needed to fetch from client components directly)
// But standard Remix pattern is to use useFetcher/Form which hits the route's action.

// If we were to implement a custom fetcher for "Ankur's backend":
/*
export const api = {
  getBars: async (): Promise<ApiResponse<Bar[]>> => {
    // const res = await fetch("https://api.ankur-backend.com/bars");
    // return res.json();
    return { success: true, data: [] }; // Mock
  },
  // ...
};
*/
