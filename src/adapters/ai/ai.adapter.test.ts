import { describe, expect, it } from "bun:test";
import { AiAdapter } from "./ai.adapter";

describe("AiAdapter Test", () => {
  it("should instantiate AiAdapter successfully", () => {
    const adapter = new AiAdapter();
    expect(adapter).toBeDefined();
  });
});
