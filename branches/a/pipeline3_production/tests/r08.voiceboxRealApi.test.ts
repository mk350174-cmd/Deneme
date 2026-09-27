// UNIFIED-PIPELINE (2026-09-22) — Voicebox adapter against the REAL server
// contract, verified in jamiepine/voicebox@51f49de:
//   * GET /generate/{id}/status  -> text/event-stream, `data: {json}` per second,
//                                   closes after "completed" | "failed"
//   * GET /audio/{id}            -> audio file (FileResponse)
//   * engines: only "chatterbox" lists "tr"
// A local HTTP server reproduces exactly those semantics; the adapter's REAL
// default fetch seams are used (no injected fakes on the client).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { VoiceboxClient, parseVoiceboxStatusBody, defaultVoiceboxEngine } from "../src/voiceboxClient.js";

const AUDIO = Buffer.from("RIFF....WAVEfmt fake-but-real-bytes");
let server: http.Server;
let base = "";
const seen: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "healthy" }));
    }
    if (req.method === "POST" && req.url === "/generate") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "gen-1", profile_id: "p1", text: "x", status: "generating" }));
    }
    if (req.method === "GET" && req.url === "/generate/gen-1/status") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(`data: ${JSON.stringify({ id: "gen-1", status: "generating", duration: null, error: null, source: "rest" })}\n\n`);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ id: "gen-1", status: "completed", duration: 3.2, error: null, source: "rest" })}\n\n`);
        res.end();
      }, 30);
      return;
    }
    if (req.method === "GET" && req.url === "/audio/gen-1") {
      res.writeHead(200, { "content-type": "audio/wav" });
      return res.end(AUDIO);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "Not Found" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Voicebox adapter vs the real server contract", () => {
  it("reads the final SSE status event instead of failing to JSON.parse the stream", async () => {
    const client = new VoiceboxClient({ baseUrl: base });
    const status = await client.getStatus("gen-1");
    expect(status).toEqual({ id: "gen-1", status: "completed" });
  });

  it("fetches completed audio from /audio/{id}", async () => {
    const client = new VoiceboxClient({ baseUrl: base });
    expect(client.resolveAudioUrl("gen-1")).toBe(`${base}/audio/gen-1`);
    expect(Buffer.compare(await client.getAudio("gen-1"), AUDIO)).toBe(0);
    expect(seen).toContain("GET /audio/gen-1");
    expect(seen.some((s) => s.includes("/generate/gen-1/audio"))).toBe(false);
  });

  it("parses failed events with their error and still accepts a bare JSON body", () => {
    expect(parseVoiceboxStatusBody('data: {"id":"g","status":"generating"}\n\ndata: {"id":"g","status":"failed","error":"CUDA OOM"}\n\n')).toEqual({ id: "g", status: "failed", error: "CUDA OOM" });
    expect(parseVoiceboxStatusBody('{"id":"g","status":"completed"}').status).toBe("completed");
    expect(() => parseVoiceboxStatusBody("data: not-json\n\n")).toThrow();
  });

  it("chooses a Turkish-capable engine by default", () => {
    expect(defaultVoiceboxEngine("tr")).toBe("chatterbox");
    expect(defaultVoiceboxEngine("en")).toBe("qwen");
  });
});

import { VoiceboxProvider } from "../src/voiceboxProvider.js";
import { recordGateApproval } from "../src/gates.js";

describe("VoiceboxProvider end-to-end against the real contract (Turkish)", () => {
  const a5 = () => {
    const a4 = recordGateApproval({ gateId: "A4", stateBefore: "AWAITING_PRODUCTION_DELIVERY", actor: "user:test", objectVersionBeingApproved: "delivery_1", stateAfter: "PRODUCTION_DELIVERY_RECEIVED", downstreamOperationUnlocked: "P3.02" });
    const a5r = recordGateApproval({ gateId: "A5", stateBefore: "PIPER_PREVIEW_GENERATED", actor: "user:test", objectVersionBeingApproved: "preview_1", stateAfter: "NARRATION_APPROVED_FOR_PRODUCTION", downstreamOperationUnlocked: "P3.05", history: [a4] } as any);
    return [a4, a5r];
  };

  it("generates Turkish narration via chatterbox, reads SSE status and /audio", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", client: new VoiceboxClient({ baseUrl: base, httpFetch: async ({ method, url, body }) => {
      if (url.endsWith("/profiles")) return { status: 200, bodyText: JSON.stringify([{ id: "p1", name: "Anlatıcı", language: "tr" }]) };
      if (method === "POST") expect((body as { engine: string; language: string })).toMatchObject({ engine: "chatterbox", language: "tr" });
      const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, bodyText: await res.text() };
    } }), probe: async () => ({ decodable: true, duration_s: 3.2 }), pollIntervalMs: 1 });
    const result = await provider.generate({ text: "Taydula Hatun Altın Orda'nın en güçlü kadınlarından biriydi.", voiceLineId: "vl_tr", language: "tr", gates: a5(), outputDir: "/tmp" } as any);
    expect(result.status).toBe("SUCCESS");
    expect(result.voice!.duration_s).toBe(3.2);
  });

  it("refuses an explicit engine that cannot speak the language", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", engine: "qwen", client: new VoiceboxClient({ baseUrl: base }) });
    const result = await provider.generate({ text: "merhaba", voiceLineId: "vl", language: "tr", gates: a5() } as any);
    expect(result.status).toBe("INVALID_REQUEST");
  });
});
