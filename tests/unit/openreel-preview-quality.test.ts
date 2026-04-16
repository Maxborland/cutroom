import { describe, expect, it } from "vitest";
import {
  getPreviewRenderSize,
  getPreviewScale,
} from "../../vendor/openreel-video/apps/web/src/utils/preview-quality";

describe("OpenReel preview quality helpers", () => {
  it("uses reduced auto scale for 4k projects", () => {
    expect(getPreviewScale("auto", 3840, 2160)).toBe(0.5);
  });

  it("keeps full scale for hd projects in auto mode", () => {
    expect(getPreviewScale("auto", 1920, 1080)).toBe(1);
  });

  it("returns even-sized preview dimensions", () => {
    expect(getPreviewRenderSize(2559, 1439, "balanced")).toEqual({
      width: 1920,
      height: 1080,
      scale: 0.75,
    });
  });
});
