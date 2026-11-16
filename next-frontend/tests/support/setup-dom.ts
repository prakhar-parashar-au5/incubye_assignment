// Adds DOM matchers (toBeChecked, toHaveAccessibleDescription, ...) to Vitest.
import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so it does not implement scrollIntoView.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
