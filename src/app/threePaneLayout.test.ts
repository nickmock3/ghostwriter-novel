import { describe, expect, it } from "vitest";
import { createThreePaneGridTemplateColumns } from "./threePaneLayout";

describe("createThreePaneGridTemplateColumns", () => {
  it("returns undefined before the user resizes panes", () => {
    expect(
      createThreePaneGridTemplateColumns({
        isLeftPaneCollapsed: false,
        isRightPaneCollapsed: false,
        paneWidths: null,
      }),
    ).toBeUndefined();
  });

  it("preserves the existing grid template when all panes are visible", () => {
    expect(
      createThreePaneGridTemplateColumns({
        isLeftPaneCollapsed: false,
        isRightPaneCollapsed: false,
        paneWidths: { center: 720, right: 340 },
      }),
    ).toEqual({
      gridTemplateColumns: "minmax(250px, calc(100% - 720px - 340px - 1px)) 720px 1px 340px",
    });
  });

  it("preserves the existing grid template when either side pane is collapsed", () => {
    expect(
      createThreePaneGridTemplateColumns({
        isLeftPaneCollapsed: true,
        isRightPaneCollapsed: false,
        paneWidths: { center: 720, right: 340 },
      }),
    ).toEqual({
      gridTemplateColumns: "minmax(720px, calc(100% - 340px - 1px)) 1px 340px",
    });

    expect(
      createThreePaneGridTemplateColumns({
        isLeftPaneCollapsed: false,
        isRightPaneCollapsed: true,
        paneWidths: { center: 720, right: 340 },
      }),
    ).toEqual({
      gridTemplateColumns: "250px minmax(720px, 1fr)",
    });

    expect(
      createThreePaneGridTemplateColumns({
        isLeftPaneCollapsed: true,
        isRightPaneCollapsed: true,
        paneWidths: { center: 720, right: 340 },
      }),
    ).toEqual({
      gridTemplateColumns: "minmax(720px, 100%)",
    });
  });
});
