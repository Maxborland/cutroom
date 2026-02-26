import React from 'react';
import { Sequence, useCurrentFrame, interpolate } from 'remotion';
import type { MontagePlan } from '../../../lib/storage.js';

interface OutroProps {
  title: string;
  startFrame: number;
  durationFrames: number;
  style: MontagePlan['style'];
}

export const Outro: React.FC<OutroProps> = ({ title, startFrame, durationFrames, style }) => {
  return (
    <Sequence from={startFrame} durationInFrames={durationFrames}>
      <OutroInner title={title} durationFrames={durationFrames} style={style} />
    </Sequence>
  );
};

/** Inner component so useCurrentFrame() returns sequence-relative frames */
const OutroInner: React.FC<{ title: string; durationFrames: number; style: MontagePlan['style'] }> = ({
  title,
  durationFrames,
  style,
}) => {
  const frame = useCurrentFrame(); // now relative to Sequence start

  const opacity = interpolate(frame, [0, 15, durationFrames - 5, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: style.primaryColor,
        opacity,
      }}
    >
      <h1
        style={{
          fontFamily: style.fontFamily,
          fontSize: 96,
          color: style.secondaryColor,
          margin: 0,
          textAlign: 'center',
          padding: '0 100px',
        }}
      >
        {title}
      </h1>
    </div>
  );
};
