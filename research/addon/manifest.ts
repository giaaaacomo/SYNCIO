export interface StremioAddonManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  resources: string[];
  types: string[];
  catalogs: Array<{
    type: string;
    id: string;
    name: string;
  }>;
  behaviorHints: {
    configurable: boolean;
    configurationRequired: boolean;
  };
}

export const SYNCIO_MANIFEST: StremioAddonManifest = {
  id: "community.syncio",
  version: "0.1.0",
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
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
};

export function manifestUrl(origin: string): string {
  return `${origin}/manifest.json`;
}

export function stremioInstallUrl(origin: string): string {
  return `stremio://${stripProtocol(manifestUrl(origin))}`;
}

function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//, "");
}
