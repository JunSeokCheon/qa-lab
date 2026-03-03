#!/usr/bin/env node

import process from "node:process";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

function toErrorDetail(payload) {
  if (payload == null) return "no-payload";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && "detail" in payload) {
    return String(payload.detail);
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

async function api(method, route, { token, json, expected = [200] } = {}) {
  const response = await fetch(`${API_BASE_URL}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!expected.includes(response.status)) {
    throw new Error(
      `${method} ${route} failed: status=${response.status} expected=${expected.join(",")} detail=${toErrorDetail(payload)}`
    );
  }
  return { status: response.status, data: payload };
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(username, password) {
  const result = await api("POST", "/auth/login", {
    json: { username, password },
  });
  const token = result.data?.access_token;
  ensure(typeof token === "string" && token.length > 0, `missing token for ${username}`);
  return token;
}

async function registerUser(user) {
  await api("POST", "/auth/register", {
    json: user,
    expected: [201],
  });
}

async function deleteUsersByKeyword(adminToken, keyword) {
  const users = await api("GET", `/admin/users?keyword=${encodeURIComponent(keyword)}&limit=200`, {
    token: adminToken,
  });
  const rows = Array.isArray(users.data) ? users.data : [];
  for (const row of rows) {
    if (!row || typeof row.id !== "number") continue;
    if (row.role === "admin") continue;
    await api("DELETE", `/admin/users/${row.id}`, {
      token: adminToken,
      expected: [204],
    });
  }
}

async function main() {
  const suffix = Date.now();
  const userPrefix = `track-check-${suffix}`;
  const newTrackName = process.env.TRACK_NAME ?? "로컬트랙-테스트";
  const examTitle = `track-target-check-${suffix}`;

  const adminToken = await login("admin", "admin1234");

  const createdTrack = await api("POST", "/admin/tracks", {
    token: adminToken,
    json: { name: newTrackName },
    expected: [201, 409],
  });
  if (createdTrack.status === 201) {
    ensure(createdTrack.data?.name === newTrackName, "created track name mismatch");
  }

  const publicTracks = await api("GET", "/tracks");
  const trackList = Array.isArray(publicTracks.data) ? publicTracks.data : [];
  ensure(trackList.includes(newTrackName), "public track list does not include newly created track");

  const primaryUser = {
    username: `${userPrefix}-main`,
    name: "Track Main User",
    track_name: newTrackName,
    password: "User1234!",
  };
  await registerUser(primaryUser);

  const primaryToken = await login(primaryUser.username, primaryUser.password);
  const me = await api("GET", "/me", { token: primaryToken });
  ensure(me.data?.track_name === newTrackName, "registered user track_name mismatch");

  const filteredUsers = await api("GET", `/admin/users?track_name=${encodeURIComponent(newTrackName)}&limit=200`, {
    token: adminToken,
  });
  const filteredRows = Array.isArray(filteredUsers.data) ? filteredUsers.data : [];
  ensure(filteredRows.some((row) => row?.username === primaryUser.username), "admin user filter by track failed");

  const createdExam = await api("POST", "/admin/exams", {
    token: adminToken,
    json: {
      title: examTitle,
      description: "track targeting smoke check",
      exam_kind: "quiz",
      target_track_name: newTrackName,
      status: "published",
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "1 + 1 = ?",
          required: true,
          choices: ["1", "2", "3", "4"],
          correct_choice_index: 1,
          correct_choice_indexes: [1],
        },
      ],
    },
    expected: [201],
  });
  const examId = createdExam.data?.id;
  ensure(typeof examId === "number", "exam create failed");

  const ownTrackExams = await api("GET", "/exams", { token: primaryToken });
  const ownExamRows = Array.isArray(ownTrackExams.data) ? ownTrackExams.data : [];
  ensure(ownExamRows.some((row) => row?.id === examId), "newly created track user cannot see targeted exam");

  const fallbackTrack = trackList.find((track) => track !== newTrackName) ?? null;
  if (fallbackTrack) {
    const outsiderUser = {
      username: `${userPrefix}-other`,
      name: "Track Other User",
      track_name: fallbackTrack,
      password: "User1234!",
    };
    await registerUser(outsiderUser);
    const outsiderToken = await login(outsiderUser.username, outsiderUser.password);
    const outsiderExams = await api("GET", "/exams", { token: outsiderToken });
    const outsiderRows = Array.isArray(outsiderExams.data) ? outsiderExams.data : [];
    ensure(!outsiderRows.some((row) => row?.id === examId), "other track user should not see targeted exam");
  }

  await api("DELETE", `/admin/tracks/${encodeURIComponent(newTrackName)}`, {
    token: adminToken,
    expected: [204],
  });

  const tracksAfterDelete = await api("GET", "/tracks");
  const tracksAfterDeleteRows = Array.isArray(tracksAfterDelete.data) ? tracksAfterDelete.data : [];
  ensure(!tracksAfterDeleteRows.includes(newTrackName), "deleted track should not appear in public tracks list");

  const meAfterTrackDelete = await api("GET", "/me", { token: primaryToken });
  ensure(meAfterTrackDelete.data?.track_name === newTrackName, "existing user track_name must remain after track delete");

  const examsAfterTrackDelete = await api("GET", "/exams", { token: primaryToken });
  const examsAfterTrackDeleteRows = Array.isArray(examsAfterTrackDelete.data) ? examsAfterTrackDelete.data : [];
  ensure(
    examsAfterTrackDeleteRows.some((row) => row?.id === examId),
    "existing user should still access own track exam after track delete"
  );

  const registerAfterDelete = await api("POST", "/auth/register", {
    json: {
      username: `${userPrefix}-late`,
      name: "Track Late User",
      track_name: newTrackName,
      password: "User1234!",
    },
    expected: [400],
  });
  ensure(registerAfterDelete.status === 400, "register with deleted track should be rejected");

  const createExamAfterDelete = await api("POST", "/admin/exams", {
    token: adminToken,
    json: {
      title: `track-deleted-check-${suffix}`,
      description: "deleted track exam create check",
      exam_kind: "quiz",
      target_track_name: newTrackName,
      status: "published",
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "2 + 2 = ?",
          required: true,
          choices: ["1", "2", "3", "4"],
          correct_choice_index: 3,
          correct_choice_indexes: [3],
        },
      ],
    },
    expected: [400],
  });
  ensure(createExamAfterDelete.status === 400, "exam create with deleted track should be rejected");

  await api("DELETE", `/admin/exams/${examId}`, {
    token: adminToken,
    expected: [204],
  });
  await deleteUsersByKeyword(adminToken, userPrefix);

  console.log(`track-management-local-check passed (track=${newTrackName})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

