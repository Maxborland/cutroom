import React from 'react';
import { Sequence, useCurrentFrame, interpolate } from 'remotion';
import type { MontagePlan } from '../../../lib/storage.js';

interface IntroProps {
  title: string;
  durationFrames: number;
  style: MontagePlan['style'];
}

export const Intro: React.FC<IntroProps> = ({ title, durationFrames, style }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 15, durationFrames - 10, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const translateY = interpolate(frame, [0, 15], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Sequence from={0} durationInFrames={durationFrames}>
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
            fontSize: 120,
            color: style.secondaryColor,
            margin: 0,
            transform: `translateY(${translateY}px)`,
            textAlign: 'center',
            padding: '0 100px',
          }}
        >
          {title}
        </h1>
      </div>
    </Sequence>
  );
};
