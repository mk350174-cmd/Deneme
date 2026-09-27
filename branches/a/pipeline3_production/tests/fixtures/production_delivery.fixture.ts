// Committed, static fixture for the manual Production Delivery stage —
// explicit asset_delivery_map declaring identity, never inferred from
// filenames/order/timestamps.

import type { ProductionDeliveryInput } from "../../src/types.js";

const FILE_HASH_1 = "1234567890abcdef".repeat(4); // 64 hex chars
const FILE_HASH_2 = "abcdef1234567890".repeat(4); // 64 hex chars

export const PRODUCTION_DELIVERY_FIXTURE: ProductionDeliveryInput = {
  asset_delivery_map: [
    { asset_requirement_id: "astreq_wide_arch", asset_file_id: "file_wide_arch_001" },
    { asset_requirement_id: "astreq_water_flow", asset_file_id: "file_water_flow_001" },
  ],
  generated_assets: [
    {
      asset_file_id: "file_wide_arch_001",
      hash: FILE_HASH_1,
      media_properties: { type: "image", width: 1080, height: 1920 },
    },
    {
      asset_file_id: "file_water_flow_001",
      hash: FILE_HASH_2,
      media_properties: { type: "video", width: 1080, height: 1920, duration_s: 2.5 },
    },
  ],
};
