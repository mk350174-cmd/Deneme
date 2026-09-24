// B00 — Governance Layer: Canonical Terminology
//
// Defines the canonical B-Branch terminology for all modules (B01-B12).
// All terms used in B module outputs must be defined here or proposed via
// governance protocol.
//
// This file is the single source of truth for B-Branch terminology.
// Updates are versioned and tracked in audit trail.

export const TERMINOLOGY_VERSION = "1.0";
export const TERMINOLOGY_CREATED_AT = "2026-08-27T00:00:00Z";
export const TERMINOLOGY_DECISION_AUTHORITY = "governance@b-branch.local";

export enum Platform {
  YOUTUBE = "YOUTUBE",
  TIKTOK = "TIKTOK",
  LINKEDIN = "LINKEDIN",
  X = "X",
  INSTAGRAM = "INSTAGRAM",
  FACEBOOK = "FACEBOOK",
  YOUTUBE_SHORTS = "YOUTUBE_SHORTS",
  UNKNOWN = "UNKNOWN",
}

export enum Role {
  PRIMARY_CHANNEL = "primary_channel",
  SECONDARY_CHANNEL = "secondary_channel",
  EXPERIMENTAL_CHANNEL = "experimental_channel",
  ARCHIVE_CHANNEL = "archive_channel",
  UNKNOWN = "UNKNOWN",
}

export enum PlatformCapability {
  LONG_FORM_VIDEO = "long_form_video",
  SHORT_FORM_VIDEO = "short_form_video",
  LIVE_STREAMING = "live_streaming",
  IMAGE_CAROUSEL = "image_carousel",
  SINGLE_IMAGE = "single_image",
  TEXT_POST = "text_post",
  THREAD = "thread",
  STORY = "story",
  COMMUNITY_CHAT = "community_chat",
  NEWSLETTER = "newsletter",
  UNKNOWN = "UNKNOWN",
}

export enum ContentFormat {
  LONG_FORM_EDUCATIONAL_VIDEO = "long_form_educational_video",
  SHORT_FORM_NARRATIVE_VIDEO = "short_form_narrative_video",
  TEXT_POST_WITH_IMAGES = "text_post_with_images",
  THREAD = "thread",
  LIVE_STREAM = "live_stream",
  CAROUSEL = "carousel",
  UNKNOWN = "UNKNOWN",
}

export type TerminologyVersion = "v1.0" | "v1.1" | "v2.0";

/** Channel role classification (B01.03 phase) */
export type ChannelRole = "primary" | "secondary" | "experimental" | "UNKNOWN";

/** Distribution strategy routing decision (B01.08 phase) */
export type DistributionRole = "primary_channel" | "secondary_channel" | "testing_ground" | "experimental" | "UNKNOWN";

/** Content type classification for editorial rules (B01.09 phase) */
export type ContentType = "tutorial" | "case_study" | "opinion" | "announcement" | "behind_scenes" | "UNKNOWN";

/** Territory boundary type (B01.07 phase) */
export type TerritoryType = "geographic" | "regulatory" | "timezone" | "audience_segment" | "UNKNOWN";

/** Editorial rule type for content governance (B01.09 phase) */
export type EditorialRuleType = "required" | "forbidden" | "restricted" | "encouraged" | "UNKNOWN";

/** Strategic constraint level (B01.11 phase) */
export type ConstraintLevel = "hard_blocker" | "soft_constraint" | "guidance" | "UNKNOWN";

/** Content angle classification retained as B-Branch domain vocabulary. */
export type ContentAngle =
  | "build_in_public"
  | "technical_decision"
  | "problem_solution"
  | "experiment"
  | "failure_lesson"
  | "architecture"
  | "benchmark"
  | "before_after"
  | "cost"
  | "speed"
  | "workflow"
  | "automation"
  | "AI"
  | "MCP"
  | "product_insight";

/** Readiness/connection state for B-Branch providers (parallel to SOP ProviderState) */
export type ProviderState = "AVAILABLE" | "CONFIGURED" | "CONNECTED" | "UNVERIFIED";

export interface PlatformDescriptor {
  name: string;
  capabilities: PlatformCapability[];
  api_status: "available" | "deprecated" | "beta";
  content_guidelines_url?: string;
}

export interface RoleDescriptor {
  name: string;
  activity_expectation: string;
  typical_audience_size: string;
  primary_purpose: string;
}

export interface CapabilityDescriptor {
  name: string;
  platforms: Platform[];
  content_types: ContentFormat[];
  typical_duration?: string;
}

export const PLATFORMS_REGISTRY: Record<Platform, PlatformDescriptor> = {
  [Platform.YOUTUBE]: {
    name: "YouTube",
    capabilities: [PlatformCapability.LONG_FORM_VIDEO, PlatformCapability.SHORT_FORM_VIDEO, PlatformCapability.LIVE_STREAMING, PlatformCapability.COMMUNITY_CHAT],
    api_status: "available",
  },
  [Platform.TIKTOK]: {
    name: "TikTok",
    capabilities: [PlatformCapability.SHORT_FORM_VIDEO, PlatformCapability.LIVE_STREAMING],
    api_status: "available",
  },
  [Platform.LINKEDIN]: {
    name: "LinkedIn",
    capabilities: [PlatformCapability.LONG_FORM_VIDEO, PlatformCapability.TEXT_POST, PlatformCapability.THREAD, PlatformCapability.IMAGE_CAROUSEL],
    api_status: "available",
  },
  [Platform.X]: {
    name: "X (Twitter)",
    capabilities: [PlatformCapability.TEXT_POST, PlatformCapability.IMAGE_CAROUSEL, PlatformCapability.SHORT_FORM_VIDEO],
    api_status: "available",
  },
  [Platform.INSTAGRAM]: {
    name: "Instagram",
    capabilities: [PlatformCapability.SHORT_FORM_VIDEO, PlatformCapability.IMAGE_CAROUSEL, PlatformCapability.STORY, PlatformCapability.SINGLE_IMAGE],
    api_status: "available",
  },
  [Platform.FACEBOOK]: {
    name: "Facebook",
    capabilities: [PlatformCapability.LONG_FORM_VIDEO, PlatformCapability.SHORT_FORM_VIDEO, PlatformCapability.IMAGE_CAROUSEL, PlatformCapability.TEXT_POST],
    api_status: "available",
  },
  [Platform.YOUTUBE_SHORTS]: {
    name: "YouTube Shorts",
    capabilities: [PlatformCapability.SHORT_FORM_VIDEO],
    api_status: "available",
  },
  [Platform.UNKNOWN]: {
    name: "Unknown Platform",
    capabilities: [],
    api_status: "beta",
  },
};

export const ROLES_REGISTRY: Record<Role, RoleDescriptor> = {
  [Role.PRIMARY_CHANNEL]: {
    name: "Primary Channel",
    activity_expectation: "2-3x weekly updates",
    typical_audience_size: "core audience (10k-1M)",
    primary_purpose: "Main distribution channel, primary engagement",
  },
  [Role.SECONDARY_CHANNEL]: {
    name: "Secondary Channel",
    activity_expectation: "1-2x weekly updates",
    typical_audience_size: "secondary audience (1k-100k)",
    primary_purpose: "Secondary distribution, niche engagement",
  },
  [Role.EXPERIMENTAL_CHANNEL]: {
    name: "Experimental Channel",
    activity_expectation: "Variable, as-needed updates",
    typical_audience_size: "testing audience (100-10k)",
    primary_purpose: "Testing, pilot, experimental content",
  },
  [Role.ARCHIVE_CHANNEL]: {
    name: "Archive Channel",
    activity_expectation: "No new updates",
    typical_audience_size: "historical audience",
    primary_purpose: "Historical content repository, no active engagement",
  },
  [Role.UNKNOWN]: {
    name: "Unknown Role",
    activity_expectation: "Not determined",
    typical_audience_size: "Unknown",
    primary_purpose: "Role not yet classified",
  },
};

export const CAPABILITIES_REGISTRY: Record<PlatformCapability, CapabilityDescriptor> = {
  [PlatformCapability.LONG_FORM_VIDEO]: {
    name: "Long-form Video",
    platforms: [Platform.YOUTUBE, Platform.LINKEDIN, Platform.FACEBOOK],
    content_types: [ContentFormat.LONG_FORM_EDUCATIONAL_VIDEO],
    typical_duration: "10-60 minutes",
  },
  [PlatformCapability.SHORT_FORM_VIDEO]: {
    name: "Short-form Video",
    platforms: [Platform.YOUTUBE_SHORTS, Platform.TIKTOK, Platform.INSTAGRAM, Platform.X],
    content_types: [ContentFormat.SHORT_FORM_NARRATIVE_VIDEO],
    typical_duration: "15-90 seconds",
  },
  [PlatformCapability.LIVE_STREAMING]: {
    name: "Live Streaming",
    platforms: [Platform.YOUTUBE, Platform.TIKTOK, Platform.FACEBOOK],
    content_types: [ContentFormat.LIVE_STREAM],
  },
  [PlatformCapability.IMAGE_CAROUSEL]: {
    name: "Image Carousel",
    platforms: [Platform.LINKEDIN, Platform.INSTAGRAM, Platform.X, Platform.FACEBOOK],
    content_types: [ContentFormat.TEXT_POST_WITH_IMAGES],
  },
  [PlatformCapability.SINGLE_IMAGE]: {
    name: "Single Image",
    platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    content_types: [ContentFormat.TEXT_POST_WITH_IMAGES],
  },
  [PlatformCapability.TEXT_POST]: {
    name: "Text Post",
    platforms: [Platform.X, Platform.LINKEDIN, Platform.FACEBOOK],
    content_types: [ContentFormat.TEXT_POST_WITH_IMAGES],
  },
  [PlatformCapability.THREAD]: {
    name: "Thread",
    platforms: [Platform.LINKEDIN, Platform.X],
    content_types: [ContentFormat.THREAD],
  },
  [PlatformCapability.STORY]: {
    name: "Story",
    platforms: [Platform.INSTAGRAM, Platform.FACEBOOK],
    content_types: [ContentFormat.SHORT_FORM_NARRATIVE_VIDEO],
    typical_duration: "3-15 seconds",
  },
  [PlatformCapability.COMMUNITY_CHAT]: {
    name: "Community Chat",
    platforms: [Platform.YOUTUBE],
    content_types: [ContentFormat.TEXT_POST_WITH_IMAGES],
  },
  [PlatformCapability.NEWSLETTER]: {
    name: "Newsletter",
    platforms: [Platform.LINKEDIN],
    content_types: [ContentFormat.LONG_FORM_EDUCATIONAL_VIDEO],
  },
  [PlatformCapability.UNKNOWN]: {
    name: "Unknown Capability",
    platforms: [],
    content_types: [],
  },
};
