const FASTAPI_BASE_URL = process.env.FASTAPI_INTERNAL_URL ?? process.env.FASTAPI_BASE_URL ?? "http://api:8000";

export type MeResponse = {
  id: number;
  username: string;
  name: string;
  track_name: string;
  role: string;
  created_at: string;
};

export type ProgressSkillItem = {
  skill_id: number;
  skill_name: string;
  earned_points: number;
  possible_points: number;
  mastery: number;
};

export type ProgressRecentSubmission = {
  submission_id: number;
  problem_id: number;
  problem_title: string;
  problem_version: number;
  status: string;
  created_at: string;
  score: number | null;
  max_score: number | null;
};

export type MeProgressResponse = {
  skills: ProgressSkillItem[];
  recent_submissions: ProgressRecentSubmission[];
};

export async function fetchMeWithToken(token: string): Promise<MeResponse | null> {
  const response = await fetch(`${FASTAPI_BASE_URL}/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MeResponse;
}

export async function fetchMyProgressWithToken(token: string): Promise<MeProgressResponse | null> {
  const response = await fetch(`${FASTAPI_BASE_URL}/me/progress`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MeProgressResponse;
}

export { FASTAPI_BASE_URL };
