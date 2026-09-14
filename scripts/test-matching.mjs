import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "moonshade-matching-"));
const dataFile = join(tempDir, "moonshade.json");

const profile = (id, gender, seeking, createdAt) => ({
  id,
  token: `${id}-token`,
  displayName: id,
  email: `${id}@example.com`,
  birthYear: 2000,
  age: 26,
  gender,
  seeking: [seeking],
  city: "北京",
  school: "北京大学",
  department: "理学",
  stage: "硕士生",
  identity: "硕士生",
  schoolType: "北京大学",
  idealBirthYearMin: 1995,
  idealBirthYearMax: 2005,
  idealSchoolTypes: ["北京大学"],
  location: ["燕园"],
  idealLocations: ["燕园"],
  hometownProvince: "北京",
  idealHometownRegions: ["华北"],
  homeArea: "直辖市/省会/首府/计划单列市",
  idealHomeAreas: ["直辖市/省会/首府/计划单列市"],
  discipline: "理学",
  idealDisciplines: ["理学"],
  intent: "认真发展",
  idealIntent: ["认真发展"],
  tempo: "日常分享",
  idealTempo: ["日常分享"],
  intimacy: "开放态度",
  idealIntimacy: ["开放态度"],
  intimacyTiming: "关系稳定后",
  idealIntimacyTiming: ["关系稳定后"],
  socialBoundary: "保持现状",
  idealSocialBoundary: ["保持现状"],
  selfWeekends: ["散步游览"],
  idealWeekends: ["散步游览"],
  selfValues: ["坦诚表达"],
  idealValues: ["坦诚表达"],
  selfMetrics: { marriage: 1, fertility: 1 },
  idealMetrics: { marriage: [1], fertility: [1] },
  contactType: "微信",
  contactValue: id,
  consent: true,
  matchPaused: false,
  createdAt,
  updatedAt: createdAt
});

const now = Date.now();
const profiles = [
  profile("old-draft-left", "女", "男", new Date(now - 30 * 86_400_000).toISOString()),
  profile("old-draft-right", "男", "女", new Date(now - 30 * 86_400_000).toISOString()),
  profile("new-left", "女", "男", new Date(now - 30 * 86_400_000).toISOString()),
  profile("new-right", "男", "女", new Date(now - 30 * 86_400_000).toISOString())
];

await writeFile(dataFile, JSON.stringify({
  profiles,
  users: [],
  verifications: [],
  adminSessions: [],
  userSessions: [],
  matches: [{
    id: "legacy-draft",
    leftId: "old-draft-left",
    rightId: "old-draft-right",
    status: "draft",
    createdAt: new Date(now - 29 * 86_400_000).toISOString()
  }],
  settings: {},
  announcements: [],
  community: {}
}, null, 2));

try {
  process.env.MOONSHADE_TEST = "1";
  process.env.MOONSHADE_DATA_FILE = dataFile;
  const { ensureDailyDraftMatches, localDateKey, normalizeData } = await import("../server.mjs");
  const data = normalizeData(JSON.parse(await readFile(dataFile, "utf8")));
  const changed = ensureDailyDraftMatches(data);
  const currentDay = localDateKey();
  const candidates = data.matches.filter(match => match.status === "draft" && match.matchDay === currentDay);

  assert.equal(changed, true);
  assert.ok(candidates.length > 0, "旧草稿不能阻止当天生成候选");
  assert.ok(candidates.every(match => match.matchDay === currentDay), "后台应返回当天候选");
  assert.ok(candidates.some(match => (
    new Set([match.leftId, match.rightId]).has("old-draft-left")
    && new Set([match.leftId, match.rightId]).has("old-draft-right")
  )), "旧草稿对应的配对可以重新进入当天候选");
  assert.ok(data.matches.some(match => match.id === "legacy-draft"), "旧草稿记录不应被误删");
  console.log(`matching regression passed: ${candidates.length} candidate(s)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
