import { createRequire } from 'node:module';

type RemotionComposition = Record<string, unknown>;
type RemotionProgress = { progress: number };

export type RemotionModules = {
  bundle: (options: { entryPoint: string }) => Promise<string>;
  selectComposition: (options: {
    serveUrl: string;
    id: string;
    inputProps: { plan: unknown };
  }) => Promise<RemotionComposition>;
  renderMedia: (options: {
    composition: RemotionComposition;
    serveUrl: string;
    codec: 'h264' | 'h265';
    outputLocation: string;
    inputProps: { plan: unknown };
    crf: number;
    concurrency: number;
    onProgress?: (payload: RemotionProgress) => void;
  }) => Promise<void>;
};

const require = createRequire(import.meta.url);

export async function loadRemotionModules(): Promise<RemotionModules> {
  try {
    const { bundle } = require('@remotion/bundler') as {
      bundle: RemotionModules['bundle'];
    };
    const { renderMedia, selectComposition } = require('@remotion/renderer') as {
      renderMedia: RemotionModules['renderMedia'];
      selectComposition: RemotionModules['selectComposition'];
    };

    return {
      bundle,
      renderMedia,
      selectComposition,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Remotion runtime is unavailable: ${message}`);
  }
}
