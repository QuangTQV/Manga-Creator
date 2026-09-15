import { describe, expect, it } from "vitest";
import { sortFilesByName } from "./importPages";

function file(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("sortFilesByName", () => {
  it("sorts numerically so page9 comes before page10", () => {
    const files = [file("page10.png"), file("page2.png"), file("page1.png"), file("page9.png")];
    expect(sortFilesByName(files).map((f) => f.name)).toEqual(["page1.png", "page2.png", "page9.png", "page10.png"]);
  });

  it("sorts case-insensitively", () => {
    const files = [file("Page2.png"), file("page1.png")];
    expect(sortFilesByName(files).map((f) => f.name)).toEqual(["page1.png", "Page2.png"]);
  });

  it("does not mutate the input array", () => {
    const files = [file("b.png"), file("a.png")];
    const original = [...files];
    sortFilesByName(files);
    expect(files).toEqual(original);
  });

  it("handles an already-sorted list as a no-op ordering", () => {
    const files = [file("a.png"), file("b.png"), file("c.png")];
    expect(sortFilesByName(files).map((f) => f.name)).toEqual(["a.png", "b.png", "c.png"]);
  });
});
