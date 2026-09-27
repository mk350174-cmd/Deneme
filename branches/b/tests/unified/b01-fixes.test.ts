// UNIFIED FIXES (2026-09-22) — see ../../../../MERGE_REPORT.md "Güncelleme 4".
import { describe, it, expect } from "vitest";
import { runB01, approveCandidate, commitVersion } from "../../src/b01/orchestration.js";
import { createMockPersistence } from "../../src/b01/persistence.js";

const base = {
  input_id: "unified-fix",
  created_at: "2026-09-22T00:00:00Z",
  known_channels: [{ channel_id: "ch1", name: "History Vertical", platform: "YouTube", audience_category: "niche" }],
};

async function canonical(input: any) {
  const c = await runB01(input);
  const ids = [...(c.ecosystem?.channels ?? []).map((x: any) => x.channel_id), ...(c.ecosystem?.platforms ?? []).map((x: any) => x.platform_id)];
  return commitVersion(approveCandidate(c, ids, [], "owner"), "v1.0", "owner", createMockPersistence());
}

describe("B-1: brand name and mission reach canonical state", () => {
  it("keeps the user-provided brand name and mission", async () => {
    const s = await canonical({ ...base, brand_context: { brand_name: "Bozkırın Kadınları", positioning: "Kaynak temelli dikey belgesel", mission: "Unutulan hatunları anlatmak" } });
    expect(s.brand_profile.brand_name).toBe("Bozkırın Kadınları");
    expect(s.brand_profile.mission).toBe("Unutulan hatunları anlatmak");
  });
  it("still says UNKNOWN when nothing was provided", async () => {
    const s = await canonical(base);
    expect(s.brand_profile.brand_name).toBe("UNKNOWN");
  });
});

describe("B-2: territories only from whole-word mentions", () => {
  const territories = async (doc: string) =>
    ((await runB01({ ...base, brand_context: { brand_name: "x", positioning: "y" }, documentation: { channel_policies: doc } })).territories?.territories ?? []).map((t: any) => t.territory_id);

  it("does not invent regions from substrings (focus/us, best/est, neutral/eu, restricted)", async () => {
    const ids = await territories("We focus on the best interest of neutral, restricted archives.");
    expect(ids).not.toContain("geo_north_america");
    expect(ids).not.toContain("geo_europe");
    expect(ids).not.toContain("geo_china_restricted");
  });
  it("still detects explicit mentions", async () => {
    const ids = await territories("Published for viewers in Europe and Asia; also available in the US.");
    expect(ids).toEqual(expect.arrayContaining(["geo_europe", "geo_asia_pacific", "geo_north_america"]));
  });
});
