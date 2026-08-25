const ONBOARDING_SEEN_KEY = "driftline.onboardingSeen";

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
}

export function markOnboardingSeen(): void {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
}
