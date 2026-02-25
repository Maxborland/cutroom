import type { BriefAsset } from './storage.js';

export interface AssetAngleManifestEntry {
  base: string;
  files: string[];
  description: string;
}

function toAngleBase(filename: string): string {
  return filename.replace(/_\d{5}\.\w+$/, '');
}

export function buildAssetAngleManifest(assets: BriefAsset[]): AssetAngleManifestEntry[] {
  const labelMap = new Map<string, string>();
  for (const asset of assets) {
    if (asset.label?.trim()) {
      labelMap.set(asset.filename, asset.label.trim());
    }
  }

  const grouped = new Map<string, string[]>();
  for (const asset of assets) {
    const base = toAngleBase(asset.filename);
    if (!grouped.has(base)) {
      grouped.set(base, []);
    }
    grouped.get(base)!.push(asset.filename);
  }

  return [...grouped.entries()].map(([base, files]) => {
    const sorted = [...files].sort();
    const description = labelMap.get(sorted[0]) || labelMap.get(sorted[1]) || '';
    return { base, files: sorted, description };
  });
}
