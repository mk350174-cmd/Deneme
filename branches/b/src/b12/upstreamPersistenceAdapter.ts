// B12 Upstream Persistence Adapter
//
// Provides real access to B01-B11 canonical states via their actual
// persistence implementations. This adapter instantiates concrete
// persistence objects from each upstream module and exposes them as
// a unified B12UpstreamReader.
//
// This is B12-owned code that bridges to existing module persistence
// without modifying B01-B11 source.

import type { B12UpstreamReader } from "./types.js";
import { createMockPersistence as createB01Persistence } from "../b01/persistence.js";
import { createMockPersistence as createB02Persistence } from "../b02/persistence.js";
import { createMockPersistence as createB03Persistence } from "../b03/persistence.js";
import { createMockPersistence as createB04Persistence } from "../b04/persistence.js";
import { createMockPersistence as createB05Persistence } from "../b05/persistence.js";
import { createMockPersistence as createB06Persistence } from "../b06/persistence.js";
import { InMemoryB07Persistence } from "../b07/persistence.js";
import { InMemoryB08Persistence } from "../b08/persistence.js";
import { InMemoryB09Persistence } from "../b09/persistence.js";
import { InMemoryB10Persistence } from "../b10/persistence.js";
import { InMemoryB11Persistence } from "../b11/persistence.js";

/**
 * Creates a real B12UpstreamReader by instantiating actual persistence
 * implementations for B01-B11.
 *
 * This adapter bridges B12 to existing module persistence without modifying
 * B01-B11 source. The returned reader provides real access to canonical states,
 * not fabricated data.
 *
 * Usage:
 *   const reader = createRealUpstreamReader();
 *   const state = await createBranchState(..., { upstreamReader: reader });
 */
export function createRealUpstreamReader(): B12UpstreamReader {
  return {
    b01: createB01Persistence(),
    b02: createB02Persistence(),
    b03: createB03Persistence(),
    b04: createB04Persistence(),
    b05: createB05Persistence(),
    b06: createB06Persistence(),
    b07: new InMemoryB07Persistence(),
    b08: new InMemoryB08Persistence(),
    b09: new InMemoryB09Persistence(),
    b10: new InMemoryB10Persistence(),
    b11: new InMemoryB11Persistence(),
  };
}
