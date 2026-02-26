import React from 'react';
import { Sequence, useCurrentFrame, interpolate } from 'remotion';
import type { ResolvedLowerThird } from '../lib/plan-reader.js';
import type { MontagePlan } from '../../../lib/storage.js';

interface LowerThirdProps {
  lowerThird: ResolvedLowerThird;
  style: MontagePlan['style'];
}

export const LowerThirdOverlay: React.FC<LowerThirdProps> = ({ lowerThird, style }) => {
  const frame = useCurrentFrame();
  const fadeIn = 8;
  const fadeOut = 8;
  const dur = lowerThird.durationFrames;

  const opacity = interpolate(frame, [0, fadeIn, dur - fadeOut, dur], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const slideX = interpolate(frame, [0, fadeIn], [-40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Sequence from={lowerThird.appearAtFrame} durationInFrames={dur}>
      <div
        style={{
          position: 'absolute',
          bottom: 120,
          left: 80,
          opacity,
          transform: `translateX(${slideX}px)`,
          zIndex: 20,
        }}
      >
        <div
          style={{
            backgroundColor: `${style.primaryColor}CC`,
            padding: '16px 32px',
            borderLeft: `4px solid ${style.secondaryColor}`,
          }}
        >
          <span
            style={{
              fontFamily: style.fontFamily,
              fontSize: 42,
              color: style.textColor,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            {lowerThird.text}
          </span>
        </div>
      </div>
    </Sequence>
  );
};
