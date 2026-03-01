## Problem
1) In ReviewView, clicking “Утвердить” during **image review** moves the shot to **approved (Готово)**, but the expected next step is **video generation**.
2) In ShotBoard, dropping a card into the “Видео” column starts generation, but the card snaps back immediately because frontend state doesn’t move it to the `vid_gen` status while the request is running.

## Root cause
- `ReviewView.handleApprove()` always called `updateShotStatus(..., 'approved')` regardless of whether we are reviewing images or videos.
- `projectStore.generateVideo()` did not optimistically set the shot status to `vid_gen` (unlike image generation), so the Kanban could not reflect an in-flight video generation.

## Fix
- ReviewView approve behavior is now pipeline-aware:
  - if status is `img_review` → start video generation (`generateVideo(shotId)`)
  - if status is `vid_review` → mark as `approved`
- `projectStore.generateVideo()` now:
  - optimistically sets the shot status to `vid_gen` immediately
  - reloads project on failure to restore server truth

## Tests
- Added component tests verifying the approve transition behavior.
- `npm run test:components`, `npm run test:unit`, `npm run build` pass locally.

@codex please review.