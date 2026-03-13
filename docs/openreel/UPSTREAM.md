# OpenReel Upstream Tracking

## Source

- Upstream repository: https://github.com/Augani/openreel-video
- Upstream license: MIT (`vendor/openreel-video/LICENSE`)
- Submodule path: `vendor/openreel-video`
- Pinned commit: `2c3362b082a18373d3c51bf3415b35e802999dc8`

## License compatibility

- CutRoom is licensed under AGPL-3.0.
- OpenReel is licensed under MIT.
- MIT content can be redistributed within an AGPL-3.0 project as long as the original MIT copyright and permission notice are preserved.

## Updating OpenReel upstream

1. Sync submodule metadata:
   ```bash
   npm run openreel:sync
   ```
2. Move the submodule to a newer upstream commit:
   ```bash
   git -C vendor/openreel-video fetch origin
   git -C vendor/openreel-video checkout <commit-or-tag>
   ```
3. Rebuild OpenReel:
   ```bash
   npm run openreel:build
   ```
4. Commit the submodule pointer update and any related integration changes in CutRoom.

## Local patches policy

- Prefer keeping `vendor/openreel-video` clean and pinned to upstream commits.
- If a local patch is required, document it in this file with:
  - reason,
  - affected files,
  - link to upstream issue/PR,
  - removal plan.
- Upstream contribution is preferred over long-lived local divergence.
