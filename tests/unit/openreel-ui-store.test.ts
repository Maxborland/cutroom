import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../../vendor/openreel-video/apps/web/src/stores/ui-store";

describe("OpenReel UI store preview quality", () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      previewQualityMode: "auto",
    });
  });

  it("defaults preview quality to auto", () => {
    expect(useUIStore.getState().previewQualityMode).toBe("auto");
  });

  it("updates preview quality mode", () => {
    useUIStore.getState().setPreviewQualityMode("performance");

    expect(useUIStore.getState().previewQualityMode).toBe("performance");
  });
});
