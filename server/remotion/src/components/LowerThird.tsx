import React from 'react';
import { Sequence, useCurrentFrame, interpolate } from 'remotion';
import type { ResolvedLowerThird } from '../lib/plan-reader';
import type { MontagePlan } from '../../../lib/storage';

interface LowerThirdProps {
  lowerThird: ResolvedLowerThird;
  style: MontagePlan['style'];
}

export const LowerThirdOverlay: React.FC<LowerThirdProps> = ({ lowerThird, style }) => {
  return (
    <Sequence from={lowerThird.appearAtFrame} durationInFrames={lowerThird.durationFrames}>
      <LowerThirdInner text={lowerThird.text} durationFrames={lowerThird.durationFrames} style={style} />
    </Sequence>
  );
};

/** Inner component so useCurrentFrame() returns sequence-relative frames */
const LowerThirdInner: React.FC<{ text: string; durationFrames: number; style: MontagePlan['style'] }> = ({
  text,
  durationFrames,
  style,
}) => {
  const frame = useCurrentFrame(); // now relative to Sequence start
  const fadeIn = 8;
  const fadeOut = 8;

  const opacity = interpolate(frame, [0, fadeIn, durationFrames - fadeOut, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const slideX = interpolate(frame, [0, fadeIn], [-40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
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
          {text}
        </span>
      </div>
    </div>
  );
};
