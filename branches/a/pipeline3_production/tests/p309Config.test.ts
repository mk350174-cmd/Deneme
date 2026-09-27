// P3.09 — single-configuration-source identity resolution.
// Proves loadP309Identity never falls back to a hardcoded personal
// Kaggle username or GitHub repo: it either resolves from an explicit
// override / environment variable, or throws.

import { describe, expect, it, afterEach } from "vitest";
import { loadP309Identity } from "../src/p309Config.js";

describe("loadP309Identity", () => {
  const originalKaggleUsername = process.env.KAGGLE_USERNAME;
  const originalRepoUrl = process.env.P309_GITHUB_REPO_URL;

  afterEach(() => {
    if (originalKaggleUsername === undefined) delete process.env.KAGGLE_USERNAME;
    else process.env.KAGGLE_USERNAME = originalKaggleUsername;
    if (originalRepoUrl === undefined) delete process.env.P309_GITHUB_REPO_URL;
    else process.env.P309_GITHUB_REPO_URL = originalRepoUrl;
  });

  it("throws when neither env vars nor overrides supply an identity — no hardcoded fallback", () => {
    delete process.env.KAGGLE_USERNAME;
    delete process.env.P309_GITHUB_REPO_URL;
    expect(() => loadP309Identity()).toThrow(/KAGGLE_USERNAME/);
  });

  it("throws when only kaggleUsername is supplied (githubRepoUrl still missing)", () => {
    delete process.env.P309_GITHUB_REPO_URL;
    expect(() => loadP309Identity({ kaggleUsername: "someone" })).toThrow(/P309_GITHUB_REPO_URL/);
  });

  it("resolves from explicit overrides", () => {
    delete process.env.KAGGLE_USERNAME;
    delete process.env.P309_GITHUB_REPO_URL;
    const identity = loadP309Identity({
      kaggleUsername: "explicit-user",
      githubRepoUrl: "https://github.com/explicit/repo.git",
    });
    expect(identity).toEqual({ kaggleUsername: "explicit-user", githubRepoUrl: "https://github.com/explicit/repo.git" });
  });

  it("resolves from environment variables when no override is given", () => {
    process.env.KAGGLE_USERNAME = "env-user";
    process.env.P309_GITHUB_REPO_URL = "https://github.com/env/repo.git";
    const identity = loadP309Identity();
    expect(identity).toEqual({ kaggleUsername: "env-user", githubRepoUrl: "https://github.com/env/repo.git" });
  });

  it("an explicit override takes precedence over the environment variable", () => {
    process.env.KAGGLE_USERNAME = "env-user";
    process.env.P309_GITHUB_REPO_URL = "https://github.com/env/repo.git";
    const identity = loadP309Identity({ kaggleUsername: "override-user" });
    expect(identity.kaggleUsername).toBe("override-user");
    expect(identity.githubRepoUrl).toBe("https://github.com/env/repo.git");
  });
});
