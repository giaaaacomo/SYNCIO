export const SYNCIO_VERSION = "0.2.0";

export function manifest(origin: string) {
  return {
    id: "community.syncio",
    version: SYNCIO_VERSION,
    name: "SYNCIO",
    description: "Deep Stremio and Trakt synchronization.",
    resources: [],
    types: [],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      configurationUrl: `${origin}/configure`
    }
  };
}
