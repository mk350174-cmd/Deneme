// B06.03 — Content Scheduling
// Define posting schedules for channels

import type { ContentSchedule } from "../types.js";
import type { ChannelSelection } from "../types.js";
import type { DistributionContext } from "./B06_01_registry.js";

export function createContentSchedules(
  context: DistributionContext,
  selections: ChannelSelection[],
  deps?: { hash?: { stableScheduleId: (campaignId: string, channelId: string) => string }; now?: () => string },
): ContentSchedule[] {
  const schedules: ContentSchedule[] = [];
  const stableScheduleId =
    deps?.hash?.stableScheduleId || ((cid: string, chid: string) => `sch_${cid}_${chid}`);
  const timestamp = deps?.now?.() || new Date().toISOString();

  // Create schedules for primary/secondary channels only
  const primarySelections = selections.filter(
    (s) => s.role === "primary_channel" || s.role === "secondary_channel",
  );

  for (const selection of primarySelections) {
    const schedule: ContentSchedule = {
      schedule_id: stableScheduleId(selection.campaign_id, selection.channel_id),
      campaign_id: selection.campaign_id,
      channel_id: selection.channel_id,

      posting_frequency: inferFrequency(selection),
      optimal_posting_times: inferOptimalTimes(selection.channel_id),
      timezone_adapted: false,
      schedule_basis: "DEFAULT",
      timezone_basis: "DEFAULT",
      source_timezone: "America/New_York",
      target_timezone: "UNKNOWN",
      conversion_method: "NONE",
      empirically_optimized: false,
      days_between_posts: inferDaysBetween(selection),

      evidence_refs: [
        {
          id: `ev_sch_${stableScheduleId(selection.campaign_id, selection.channel_id)}`,
          source: `selection:${selection.selection_id}`,
          status: "INFERRED" as const,
          excerpt: `Scheduling for ${selection.role}`,
        },
      ],
      provenance: {
        type: "INFERRED" as const,
        decision_authority: `B06_03:createContentSchedules`,
        timestamp,
        rationale: `Scheduled based on channel and role`,
      },
    };

    schedules.push(schedule);
  }

  return schedules;
}

function inferFrequency(
  selection: ChannelSelection,
): "daily" | "2_3_weekly" | "weekly" | "bi_weekly" | "monthly" | "as_available" {
  if (selection.role === "primary_channel") {
    return "2_3_weekly"; // Primary channels: 2-3x per week
  }
  return "weekly"; // Secondary: weekly
}

function inferOptimalTimes(channelId: string): string[] {
  const timesByChannel: { [key: string]: string[] } = {
    youtube: ["10:00 America/New_York", "15:00 America/New_York"],
    linkedin: ["09:00 America/New_York", "12:00 America/New_York"],
    tiktok: ["19:00 America/New_York", "21:00 America/New_York"],
    instagram: ["11:00 America/New_York", "19:00 America/New_York"],
  };
  return timesByChannel[channelId.toLowerCase()] || ["09:00 America/New_York", "15:00 America/New_York"];
}

function inferDaysBetween(selection: ChannelSelection): number | undefined {
  if (selection.role === "primary_channel") {
    return 2; // Post every 2-3 days (2 or 3 times per week)
  }
  return 7; // Post weekly
}
