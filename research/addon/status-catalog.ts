import { SYNCIO_MANIFEST } from "./manifest.js";

export interface StremioMetaPreview {
  id: string;
  type: "movie";
  name: string;
  poster: string;
  posterShape: "poster";
  description: string;
  releaseInfo: string;
}

export function statusCatalog(): { metas: StremioMetaPreview[] } {
  return {
    metas: [
      {
        id: "syncio:status",
        type: "movie",
        name: "SYNCIO Status",
        poster: statusPoster(),
        posterShape: "poster",
        description: "Addon shell installed. Account linking and hosted sync are not connected yet.",
        releaseInfo: SYNCIO_MANIFEST.version
      }
    ]
  };
}

function statusPoster(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <rect width="600" height="900" fill="#101418"/>
  <rect x="44" y="44" width="512" height="812" rx="24" fill="#17202a" stroke="#2dd4bf" stroke-width="8"/>
  <text x="300" y="320" fill="#eef2f5" font-family="Arial, sans-serif" font-size="86" font-weight="700" text-anchor="middle">SYNCIO</text>
  <text x="300" y="410" fill="#a7b1bb" font-family="Arial, sans-serif" font-size="34" text-anchor="middle">Addon shell</text>
  <circle cx="300" cy="560" r="78" fill="#0f766e"/>
  <path d="M256 560h88M300 516v88" stroke="#ffffff" stroke-width="28" stroke-linecap="round"/>
  <text x="300" y="724" fill="#2dd4bf" font-family="Arial, sans-serif" font-size="30" text-anchor="middle">Ready to configure</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
