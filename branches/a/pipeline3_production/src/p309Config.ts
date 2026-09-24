// P3.08-DIST Distributed Render — single configuration source for identities that
// are specific to whoever is deploying this pipeline (their Kaggle account,
// their GitHub fork). No personal username or repository URL is hardcoded
// anywhere in the P3.08-DIST modules (distribution.ts, orchestration_p309.ts,
// p309_live_execution.ts) — they all resolve identity through this module.
// A missing value fails loudly at the point of use rather than silently
// defaulting to a value baked in from one specific deployer's account.

export interface P309Identity {
  kaggleUsername: string;
  githubRepoUrl: string;
}

export function loadP309Identity(overrides: Partial<P309Identity> = {}): P309Identity {
  const kaggleUsername = overrides.kaggleUsername ?? process.env.KAGGLE_USERNAME;
  const githubRepoUrl = overrides.githubRepoUrl ?? process.env.P309_GITHUB_REPO_URL;

  if (!kaggleUsername) {
    throw new Error(
      "P3.08-DIST (distributed render) requires a Kaggle username: set the KAGGLE_USERNAME environment variable, " +
        "or pass { kaggleUsername } explicitly. No default account is baked into source.",
    );
  }
  if (!githubRepoUrl) {
    throw new Error(
      "P3.08-DIST (distributed render) requires a GitHub repository URL for the Kaggle kernel to clone: set the " +
        "P309_GITHUB_REPO_URL environment variable, or pass { githubRepoUrl } explicitly. No default " +
        "repository is baked into source.",
    );
  }

  return { kaggleUsername, githubRepoUrl };
}
