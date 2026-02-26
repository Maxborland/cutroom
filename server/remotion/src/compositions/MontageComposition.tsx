import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { ResolvedPlan } from '../lib/plan-reader.js';
import { VideoClip } from '../components/VideoClip.js';
import { Transition } from '../components/Transition.js';
import { Intro } from '../components/Intro.js';
import { Outro } from '../components/Outro.js';
import { LowerThirdOverlay } from '../components/LowerThird.js';
import { AudioMixer } from '../components/AudioMixer.js';

interface MontageCompositionProps {
  plan: ResolvedPlan;
}

export const MontageComposition: React.FC<MontageCompositionProps> = ({ plan }) => {
  const outroStart = plan.totalDurationFrames - plan.outroFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: plan.style.primaryColor }}>
      {/* Intro */}
      <Intro
        title={plan.introTitle}
        durationFrames={plan.introFrames}
        style={plan.style}
      />

      {/* Video clips */}
      {plan.clips.map((clip) => (
        <VideoClip
          key={clip.shotId}
          clip={clip}
          fps={plan.fps}
          width={plan.width}
          height={plan.height}
        />
      ))}

      {/* Transitions */}
      {plan.transitions.map((t, i) => (
        <Transition key={`t-${i}`} transition={t} />
      ))}

      {/* Lower thirds */}
      {plan.lowerThirds.map((lt, i) => (
        <LowerThirdOverlay
          key={`lt-${i}`}
          lowerThird={lt}
          style={plan.style}
        />
      ))}

      {/* Outro */}
      <Outro
        title={plan.outroTitle}
        startFrame={outroStart}
        durationFrames={plan.outroFrames}
        style={plan.style}
      />

      {/* Audio */}
      <AudioMixer
        voiceoverFile={plan.voiceoverFile}
        voiceoverGainDb={plan.voiceoverGainDb}
        musicFile={plan.musicFile}
        musicGainDb={plan.musicGainDb}
        musicDuckingDb={plan.musicDuckingDb}
        musicDuckFadeMs={plan.musicDuckFadeMs}
        introFrames={plan.introFrames}
        totalDurationFrames={plan.totalDurationFrames}
        fps={plan.fps}
      />
    </AbsoluteFill>
  );
};
