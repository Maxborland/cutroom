import React from 'react';
import { Composition } from 'remotion';
import { MontageComposition } from './compositions/MontageComposition.js';
import type { ResolvedPlan } from './lib/plan-reader.js';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Montage"
        component={MontageComposition}
        durationInFrames={900} // default, overridden at render time
        fps={30}
        width={3840}
        height={2160}
        defaultProps={{
          plan: {} as ResolvedPlan,
        }}
      />
    </>
  );
};
