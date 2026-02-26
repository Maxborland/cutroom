/**
 * plan-reader.ts — Parse MontagePlan JSON into Remotion-friendly data structures.
 */

import type { MontagePlan, TimelineEntry, TransitionEntry, LowerThird } from '../../../lib/storage.js';

export interface ResolvedClip {
  shotId: string;
  file: string;           // absolute path to normalized clip
  startFrame: number;
  durationFrames: number;
  trimEndSec?: number;
  motionEffect?: string;
}

export interface ResolvedTransition {
  fromShotId: string;
  toShotId: string;
  type: 'fade' | 'crossfade' | 'cut' | 'wipe';
  durationFrames: number;
  startFrame: number;     // frame where transition begins
}

export interface ResolvedLowerThird {
  shotId: string;
  text: string;
  position: string;
  appearAtFrame: number;
  durationFrames: number;
}

export interface ResolvedPlan {
  fps: number;
  width: number;
  height: number;
  totalDurationFrames: number;
  introFrames: number;
  outroFrames: number;
  introTitle: string;
  outroTitle: string;
  clips: ResolvedClip[];
  transitions: ResolvedTransition[];
  lowerThirds: ResolvedLowerThird[];
  voiceoverFile: string;
  voiceoverGainDb: number;
  musicFile: string;
  musicGainDb: number;
  musicDuckingDb: number;
  musicDuckFadeMs: number;
  style: MontagePlan['style'];
}

/**
 * Convert a MontagePlan (seconds-based) to frame-based data for Remotion.
 */
export function resolvePlan(plan: MontagePlan, projectDir: string): ResolvedPlan {
  const { fps } = plan.format;
  const secToFrames = (sec: number) => Math.round(sec * fps);

  const introFrames = secToFrames(plan.motionGraphics.intro?.durationSec ?? 3);
  const outroFrames = secToFrames(plan.motionGraphics.outro?.durationSec ?? 4);

  // Resolve clips
  const clips: ResolvedClip[] = plan.timeline.map((entry) => ({
    shotId: entry.shotId,
    file: `${projectDir}/${entry.clipFile}`,
    startFrame: secToFrames(entry.startSec),
    durationFrames: secToFrames(entry.durationSec),
    trimEndSec: entry.trimEndSec,
    motionEffect: entry.motionEffect,
  }));

  // Total duration = last clip end + outro
  const lastClip = clips[clips.length - 1];
  const clipsEndFrame = lastClip
    ? lastClip.startFrame + lastClip.durationFrames
    : introFrames;
  const totalDurationFrames = clipsEndFrame + outroFrames;

  // Resolve transitions
  const transitions: ResolvedTransition[] = plan.transitions.map((t) => {
    const targetClip = clips.find(c => c.shotId === t.toShotId);
    const startFrame = targetClip ? targetClip.startFrame : introFrames;
    return {
      fromShotId: t.fromShotId,
      toShotId: t.toShotId,
      type: t.type,
      durationFrames: secToFrames(t.durationSec),
      startFrame,
    };
  });

  // Resolve lower thirds
  const lowerThirds: ResolvedLowerThird[] = plan.motionGraphics.lowerThirds.map((lt) => {
    const parentClip = clips.find(c => c.shotId === lt.shotId);
    const baseFrame = parentClip ? parentClip.startFrame : 0;
    return {
      shotId: lt.shotId,
      text: lt.text,
      position: lt.position,
      appearAtFrame: baseFrame + secToFrames(lt.appearAtSec),
      durationFrames: secToFrames(lt.durationSec),
    };
  });

  return {
    fps,
    width: plan.format.width,
    height: plan.format.height,
    totalDurationFrames,
    introFrames,
    outroFrames,
    introTitle: plan.motionGraphics.intro?.title ?? '',
    outroTitle: plan.motionGraphics.outro?.title ?? '',
    clips,
    transitions,
    lowerThirds,
    voiceoverFile: plan.audio.voiceover.file ? `${projectDir}/${plan.audio.voiceover.file}` : '',
    voiceoverGainDb: plan.audio.voiceover.gainDb,
    musicFile: plan.audio.music.file ? `${projectDir}/${plan.audio.music.file}` : '',
    musicGainDb: plan.audio.music.gainDb,
    musicDuckingDb: plan.audio.music.duckingDb ?? -10,
    musicDuckFadeMs: plan.audio.music.duckFadeMs ?? 500,
    style: plan.style,
  };
}
