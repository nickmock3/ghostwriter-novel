import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof window !== "undefined") {
  window.scrollTo = vi.fn();

  if (typeof window.PointerEvent === "undefined") {
    window.PointerEvent = MouseEvent as typeof PointerEvent;
  }
}
