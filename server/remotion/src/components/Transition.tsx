import React from 'react';
import { Sequence, interpolate, useCurrentFrame } from 'remotion';
import type { ResolvedTransition } from '../lib/plan-reader.js';

interface TransitionProps {
  transition: ResolvedTransition;
}

export const Transition: React.FC<TransitionProps> = ({ transition }) => {
  const frame = useCurrentFrame();

  if (transition.type === 'cut' || transition.durationFrames === 0) {
    return null; // cuts have no visual overlay
  }

  const { startFrame, durationFrames } = transition;

  return (
    <Sequence from={startFrame} durationInFrames={durationFrames}>
      <TransitionOverlay type={transition.type} durationFrames={durationFrames} />
    </Sequence>
  );
};

const TransitionOverlay: React.FC<{ type: string; durationFrames: number }> = ({
  type,
  durationFrames,
}) => {
  const frame = useCurrentFrame();

  if (type === 'fade') {
    // Fade from black
    const opacity = interpolate(frame, [0, durationFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'black',
          opacity,
          zIndex: 10,
        }}
      />
    );
  }

  if (type === 'crossfade') {
    // Crossfade: outgoing clip fades out (handled by opacity on the layer above)
    const opacity = interpolate(frame, [0, durationFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'black',
          opacity: opacity * 0.5,
          zIndex: 10,
        }}
      />
    );
  }

  if (type === 'wipe') {
    const progress = interpolate(frame, [0, durationFrames], [0, 100], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(to right, transparent ${progress}%, black ${progress}%)`,
          zIndex: 10,
        }}
      />
    );
  }

  return null;
};
