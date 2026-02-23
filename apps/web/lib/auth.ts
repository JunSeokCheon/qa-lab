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

export type MeExamResultSummary = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  exam_kind: string;
  status: string;
  submitted_at: string;
  objective_total: number;
  objective_answered: number;
  objective_correct: number;
  coding_total: number;
  coding_graded: number;
  coding_failed: number;
  coding_pending: number;
  coding_score: number | null;
  coding_max_score: number | null;
  has_subjective: boolean;
  grading_ready: boolean;
  results_published: boolean;
  results_published_at: string | null;
  objective_pending: number;
  objective_incorrect: number;
  subjective_total: number;
  subjective_correct: number;
  subjective_incorrect: number;
  subjective_pending: number;
  coding_correct: number;
  coding_incorrect: number;
  coding_review_pending: number;
  overall_total: number;
  overall_correct: number;
  overall_incorrect: number;
  overall_pending: number;
  strong_skill_keywords: string[];
  weak_skill_keywords: string[];
  question_results: MeExamQuestionResult[];
};

export type MeExamQuestionResult = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_preview: string;
  verdict: "correct" | "incorrect" | "pending" | "review_pending";
  skill_keywords: string[];
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

export async function fetchMyExamResultsWithToken(token: string): Promise<MeExamResultSummary[] | null> {
  const response = await fetch(`${FASTAPI_BASE_URL}/me/exam-results?limit=50`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as MeExamResultSummary[];
}

export { FASTAPI_BASE_URL };
