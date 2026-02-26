import React from 'react';
import { Sequence, Video, Img } from 'remotion';
import type { ResolvedClip } from '../lib/plan-reader.js';

/** Convert absolute path to file:// URL for Remotion media */
function toFileUrl(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath;
  if (filePath.startsWith('/')) return `file://${filePath}`;
  return filePath;
}

interface VideoClipProps {
  clip: ResolvedClip;
  fps: number;
  width: number;
  height: number;
}

export const VideoClip: React.FC<VideoClipProps> = ({ clip, fps, width, height }) => {
  const isImage = clip.file.match(/\.(jpg|jpeg|png|webp)$/i);
  const src = toFileUrl(clip.file);

  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
      <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
        {isImage ? (
          <Img
            src={src}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Video
            src={src}
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
