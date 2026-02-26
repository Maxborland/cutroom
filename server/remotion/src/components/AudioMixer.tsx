import React from 'react';
import { Audio, Sequence, interpolate, useCurrentFrame } from 'remotion';

interface AudioMixerProps {
  voiceoverFile: string;
  voiceoverGainDb: number;
  musicFile: string;
  musicGainDb: number;
  musicDuckingDb: number;
  musicDuckFadeMs: number;
  introFrames: number;
  totalDurationFrames: number;
  fps: number;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export const AudioMixer: React.FC<AudioMixerProps> = ({
  voiceoverFile,
  voiceoverGainDb,
  musicFile,
  musicGainDb,
  musicDuckingDb,
  musicDuckFadeMs,
  introFrames,
  totalDurationFrames,
  fps,
}) => {
  const frame = useCurrentFrame();
  const duckFadeFrames = Math.round((musicDuckFadeMs / 1000) * fps);

  // Music volume: full during intro/outro, ducked during voiceover
  const voStart = introFrames;
  const voEnd = totalDurationFrames - Math.round(4 * fps); // outro ~4s

  const musicVolumeDb = interpolate(
    frame,
    [
      voStart - duckFadeFrames,
      voStart,
      voEnd,
      voEnd + duckFadeFrames,
    ],
    [musicGainDb, musicGainDb + musicDuckingDb, musicGainDb + musicDuckingDb, musicGainDb],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <>
      {voiceoverFile && (
        <Sequence from={introFrames}>
          <Audio src={voiceoverFile} volume={dbToLinear(voiceoverGainDb)} />
        </Sequence>
      )}
      {musicFile && (
        <Sequence from={0} durationInFrames={totalDurationFrames}>
          <Audio src={musicFile} volume={dbToLinear(musicVolumeDb)} loop />
        </Sequence>
      )}
    </>
  );
};
