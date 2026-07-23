export const SYNCIO_VERSION = "0.1.0";

export function manifest(origin: string) {
  return {
    id: "community.syncio",
    version: SYNCIO_VERSION,
    name: "SYNCIO",
    description: "Deep Stremio and Trakt synchronization.",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [
      {
        type: "movie",
        id: "syncio-status",
        name: "SYNCIO Status"
      }
    ],
    idPrefixes: ["syncio:"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      configurationUrl: `${origin}/configure`
    }
  };
}
