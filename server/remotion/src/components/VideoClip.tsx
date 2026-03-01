import React from 'react';
import { Sequence, OffthreadVideo, Img } from 'remotion';
import type { ResolvedClip } from '../lib/plan-reader';

interface VideoClipProps {
  clip: ResolvedClip;
  fps: number;
  width: number;
  height: number;
}

/**
 * Renders a single clip (video or image) within the montage timeline.
 *
 * Uses <OffthreadVideo> instead of <Video> for server-side rendering:
 * - Extracts frames via ffmpeg, not HTML5 <video> element
 * - Handles seeking past video end gracefully (shows last frame)
 * - More reliable and memory-efficient in renderMedia()
 */
export const VideoClip: React.FC<VideoClipProps> = ({ clip, fps, width, height }) => {
  const isImage = clip.file.match(/\.(jpg|jpeg|png|webp)$/i);

  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
      <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
        {isImage ? (
          <Img
            src={clip.file}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <OffthreadVideo
            src={clip.file}
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
