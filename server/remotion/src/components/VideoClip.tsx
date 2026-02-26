import React from 'react';
import { Sequence, Video, Img, staticFile } from 'remotion';
import type { ResolvedClip } from '../lib/plan-reader.js';

interface VideoClipProps {
  clip: ResolvedClip;
  fps: number;
  width: number;
  height: number;
}

export const VideoClip: React.FC<VideoClipProps> = ({ clip, fps, width, height }) => {
  const isImage = clip.file.match(/\.(jpg|jpeg|png|webp)$/i);

  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
      <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
        {isImage ? (
          <Img
            src={staticFile(clip.file)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Video
            src={staticFile(clip.file)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            startFrom={0}
          />
        )}
      </div>
    </Sequence>
  );
};
