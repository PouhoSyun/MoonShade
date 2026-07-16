import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function loadEnvFile(filePath) {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(join(__dirname, ".env"));

const PUBLIC_DIR = join(__dirname, "public");
const DATA_FILE = process.env.MOONSHADE_DATA_FILE || join(__dirname, "data", "moonshade.json");
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = process.env.MOONSHADE_ADMIN_EMAIL || "moodylitchee@stu.pku.edu.cn";
const ADMIN_PASSWORD = process.env.MOONSHADE_ADMIN_PASSWORD || "moodylitchee";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const defaultData = {
  profiles: [],
  users: [],
  verifications: [],
  adminSessions: [],
  userSessions: [],
  matches: [],
  settings: {
    matchIntervalDays: 3,
    matchWindowNote: "原则上每三天进行一次匹配；实际频率会受用户画像分布、性别比例与偏好宽窄影响。"
  },
  announcements: [
    {
      id: "welcome",
      title: "MoonShade 内测开放",
      body: "本轮先开放基础问卷与自动匹配。问卷题目会逐步增加，已提交的信息可随时更新。"
    }
  ]
};

async function ensureDataFile() {
  await mkdir(join(__dirname, "data"), { recursive: true });
  try {
    await stat(DATA_FILE);
  } catch {
    await writeJson(DATA_FILE, defaultData);
  }
}

async function readJson(file) {
  const raw = await readFile(file, "utf8");
  return normalizeData(JSON.parse(raw));
}

async function writeJson(file, value) {
  await mkdir(join(file, ".."), { recursive: true }).catch(() => {});
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function cleanText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function normalizeData(data) {
  return {
    ...defaultData,
    ...data,
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    users: Array.isArray(data.users) ? data.users : [],
    verifications: Array.isArray(data.verifications) ? data.verifications : [],
    adminSessions: Array.isArray(data.adminSessions) ? data.adminSessions : [],
    userSessions: Array.isArray(data.userSessions) ? data.userSessions : [],
    matches: Array.isArray(data.matches) ? data.matches : [],
    settings: {
      ...defaultData.settings,
      ...(data.settings && typeof data.settings === "object" ? data.settings : {})
    },
    announcements: Array.isArray(data.announcements) ? data.announcements : defaultData.announcements
  };
}

function normalizeEmail(email) {
  return cleanText(email, 120).toLowerCase();
}

function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized === ADMIN_EMAIL) return true;
  return /^\d{10}@(stu\.)?pku\.edu\.cn$/.test(normalized);
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored = "") {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

function envValue(...names) {
  return names.map(name => process.env[name]).find(value => value !== undefined && value !== "");
}

function envBool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function formatEmailAddress(email, name = "") {
  return name ? `${encodeMimeHeader(name)} <${email}>` : email;
}

function escapeSmtpDataLine(line) {
  return line.startsWith(".") ? `.${line}` : line;
}

async function sendSmtpMail({ to, subject, text }) {
  const host = envValue("MOONSHADE_SMTP_HOST", "SMTP_HOST");
  const user = envValue("MOONSHADE_SMTP_USER", "SMTP_USER");
  const pass = envValue("MOONSHADE_SMTP_PASS", "SMTP_PASS");
  const from = envValue("MOONSHADE_SMTP_FROM", "SMTP_FROM") || user;
  const fromName = envValue("MOONSHADE_SMTP_FROM_NAME", "SMTP_FROM_NAME") || "MoonShade";
  const secure = envBool(envValue("MOONSHADE_SMTP_SECURE", "SMTP_SECURE"), false);
  const startTls = envBool(envValue("MOONSHADE_SMTP_STARTTLS", "SMTP_STARTTLS"), !secure);
  const port = Number(envValue("MOONSHADE_SMTP_PORT", "SMTP_PORT") || (secure ? 465 : 587));
  const helloName = envValue("MOONSHADE_SMTP_HELO", "SMTP_HELO") || "moonshade.local";

  if (!host || !from) {
    throw new Error("SMTP 未配置：请设置 MOONSHADE_SMTP_HOST 和 MOONSHADE_SMTP_FROM。");
  }

  let socket;
  let buffer = "";
  let closed = false;
  let pendingResponse = null;

  function parseResponses() {
    if (!pendingResponse) return;
    const lines = buffer.split(/\r?\n/);
    if (buffer && !/\r?\n$/.test(buffer)) {
      buffer = lines.pop();
    } else {
      buffer = "";
      if (lines.at(-1) === "") lines.pop();
    }
    if (!lines.length) return;
    pendingResponse.lines.push(...lines);
    const doneIndex = pendingResponse.lines.findIndex(line => /^\d{3} /.test(line));
    if (doneIndex === -1) return;
    const responseLines = pendingResponse.lines.splice(0, doneIndex + 1);
    const code = Number(responseLines.at(-1).slice(0, 3));
    const { resolve } = pendingResponse;
    pendingResponse = null;
    resolve({ code, lines: responseLines });
    if (pendingResponse) parseResponses();
  }

  function attachSocket(nextSocket) {
    socket = nextSocket;
    socket.setEncoding("utf8");
    socket.setTimeout(15_000);
    socket.on("data", chunk => {
      buffer += chunk;
      parseResponses();
    });
    socket.on("error", error => {
      if (pendingResponse) {
        const { reject } = pendingResponse;
        pendingResponse = null;
        reject(error);
      }
    });
    socket.on("timeout", () => socket.destroy(new Error("SMTP 连接超时。")));
    socket.on("close", () => {
      closed = true;
    });
  }

  function readResponse() {
    if (pendingResponse) throw new Error("SMTP 协议状态异常：仍有响应未读取。");
    return new Promise((resolve, reject) => {
      pendingResponse = { lines: [], resolve, reject };
      parseResponses();
    });
  }

  function expect(response, expectedCodes, commandName) {
    const expected = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
    if (!expected.includes(response.code)) {
      throw new Error(`${commandName} 失败：${response.lines.join(" | ")}`);
    }
    return response;
  }

  async function command(line, expectedCodes) {
    if (closed) throw new Error("SMTP 连接已关闭。");
    socket.write(`${line}\r\n`);
    return expect(await readResponse(), expectedCodes, line.split(" ")[0]);
  }

  await new Promise((resolve, reject) => {
    const nextSocket = secure
      ? tls.connect({ host, port, servername: host }, resolve)
      : net.createConnection({ host, port }, resolve);
    nextSocket.on("error", reject);
    attachSocket(nextSocket);
  });

  try {
    expect(await readResponse(), 220, "CONNECT");
    await command(`EHLO ${helloName}`, 250);

    if (!secure && startTls) {
      await command("STARTTLS", 220);
      buffer = "";
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      socket.removeAllListeners("timeout");
      socket.removeAllListeners("close");
      await new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({ socket, servername: host }, resolve);
        tlsSocket.on("error", reject);
        attachSocket(tlsSocket);
      });
      await command(`EHLO ${helloName}`, 250);
    }

    if (user && pass) {
      await command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64")}`, [235, 503]);
    }

    await command(`MAIL FROM:<${from}>`, 250);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", 354);

    const message = [
      `From: ${formatEmailAddress(from, fromName)}`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      ...text.replace(/\r\n/g, "\n").split("\n").map(escapeSmtpDataLine)
    ].join("\r\n");
    socket.write(`${message}\r\n.\r\n`);
    await expect(await readResponse(), 250, "DATA body");
    await command("QUIT", 221).catch(() => {});
  } finally {
    socket.end();
  }
}

async function sendVerificationEmail(email, code) {
  const subject = "MoonShade 北大邮箱验证码";
  const body = `你的 MoonShade 验证码是：${code}\n\n10 分钟内有效。若非本人操作，请忽略这封邮件。`;
  if (process.env.MOONSHADE_MAIL_TRANSPORT === "smtp") {
    await sendSmtpMail({ to: email, subject, text: body });
    return { delivered: true };
  } else if (process.env.MOONSHADE_MAIL_TRANSPORT === "sendmail") {
    const command = process.env.SENDMAIL_PATH || "sendmail";
    await new Promise((resolve, reject) => {
      const child = spawn(command, ["-t"], { stdio: ["pipe", "ignore", "pipe"] });
      let error = "";
      child.stderr.on("data", chunk => { error += chunk; });
      child.on("close", codeValue => codeValue === 0 ? resolve() : reject(new Error(error || `sendmail exited ${codeValue}`)));
      child.stdin.end(`To: ${email}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`);
    });
    return { delivered: true };
  } else {
    console.log(`[MoonShade verification] ${email}: ${code}`);
    return { delivered: false, devCode: code };
  }
}

function getUserBySession(data, token) {
  const session = data.userSessions.find(item => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  if (session.email === ADMIN_EMAIL) {
    return { id: "admin", email: ADMIN_EMAIL, verifiedAt: new Date().toISOString(), role: "admin" };
  }
  return data.users.find(user => user.email === session.email) || null;
}

function requireAdmin(data, token) {
  return data.adminSessions.some(item => item.token === token && new Date(item.expiresAt) > new Date());
}

function cleanList(value, allowed = []) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map(item => String(item || "").trim()).filter(Boolean))]
    .filter(item => allowed.length === 0 || allowed.includes(item));
}

function cleanMetricMap(value = {}, multi = false) {
  const source = value && typeof value === "object" ? value : {};
  const keys = ["warmth", "ambition", "decision", "novelty", "schedule"];
  return Object.fromEntries(keys.map(key => {
    if (multi) {
      const numbers = cleanList(source[key]).map(Number).filter(item => Number.isInteger(item) && item >= -3 && item <= 3);
      return [key, [...new Set(numbers)]];
    }
    const number = Number(source[key]);
    return [key, Number.isInteger(number) && number >= -3 && number <= 3 ? number : null];
  }));
}

function cleanHeight(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 140 && number <= 210 ? number : null;
}

function cleanMbtiMap(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const keys = ["ei", "sn", "tf", "jp"];
  return Object.fromEntries(keys.map(key => {
    const number = Number(source[key]);
    return [key, Number.isInteger(number) && number >= -3 && number <= 3 ? number : 0];
  }));
}

const provinceRegions = {
  华北: ["北京", "天津", "河北", "山西", "内蒙古"],
  东北: ["辽宁", "吉林", "黑龙江"],
  华东: ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东"],
  华中: ["河南", "湖北", "湖南"],
  华南: ["广东", "广西", "海南"],
  西南: ["重庆", "四川", "贵州", "云南", "西藏"],
  西北: ["陕西", "甘肃", "青海", "宁夏", "新疆"],
  港澳台: ["香港", "澳门", "台湾"]
};

function regionForProvince(province) {
  return Object.entries(provinceRegions).find(([, provinces]) => provinces.includes(province))?.[0] || "";
}

function cleanSettings(input = {}) {
  const interval = Number.parseInt(input.matchIntervalDays, 10);
  return {
    matchIntervalDays: Number.isInteger(interval) && interval >= 1 && interval <= 14 ? interval : defaultData.settings.matchIntervalDays,
    matchWindowNote: cleanText(input.matchWindowNote || defaultData.settings.matchWindowNote, 240)
  };
}

function currentRound(now = new Date(), settings = defaultData.settings) {
  const clean = cleanSettings(settings);
  const intervalMs = clean.matchIntervalDays * 86_400_000;
  const anchor = Date.UTC(2026, 0, 1, 12, 0, 0, 0);
  const currentTime = now.getTime();
  const elapsed = Math.max(0, currentTime - anchor);
  const index = Math.floor(elapsed / intervalMs);
  const open = new Date(anchor + index * intervalMs);
  const next = new Date(open.getTime() + intervalMs);
  if (next <= now) {
    open.setTime(open.getTime() + intervalMs);
    next.setTime(next.getTime() + intervalMs);
  }
  const resultAt = new Date(next);
  resultAt.setHours(20, 0, 0, 0);

  const id = open.toISOString().slice(0, 10);
  return {
    id,
    label: `${open.toISOString().slice(0, 10)} 至 ${next.toISOString().slice(0, 10)}`,
    opensAt: open.toISOString(),
    closesAt: next.toISOString(),
    resultsAt: resultAt.toISOString(),
    intervalDays: clean.matchIntervalDays,
    note: clean.matchWindowNote
  };
}

function sanitizeProfile(input, existing = {}, settings = defaultData.settings) {
  const allowedGenders = ["女", "男", "非二元", "暂不透露"];
  const allowedSeek = ["女", "男", "非二元", "不限"];
  const allowedIdentities = ["本科生", "硕士生", "博士生", "毕业工作", "自由探索"];
  const allowedSchoolTypes = ["北京大学"];
  const allowedLocations = ["燕园", "马池口", "学院路", "万柳", "西山口", "统军庄", "人民医院", "第一医院", "第三医院", "第六医院", "国际医院", "深圳", "牛津", "校外"];
  const allowedProvinces = ["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "香港", "澳门", "台湾", "海外"];
  const allowedRegions = ["华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台"];
  const allowedHomeAreas = ["直辖市/省会/首府/计划单列市", "地级市/州府/公署驻地", "其他城市化地区", "乡村", "流动成长"];
  const allowedDisciplines = ["理学", "工学", "人文", "社科", "医学", "经管法", "艺术体育", "其他"];
  const allowedIntent = ["快速转进", "认真发展", "先交朋友", "慢慢了解"];
  const allowedTempo = ["高频交流", "日常分享", "低频稳定", "线下优先"];
  const allowedIntimacy = ["一见钟情", "自然走进", "先定关系", "保守踏实"];
  const allowedIntimacyTiming = ["不接受", "婚后", "有稳定好感后", "相熟一到三个月后", "顺其自然"];
  const allowedWeekend = ["外出旅行", "散步游览", "朋友聚会", "运动户外", "自习工作", "做饭探店", "球番剧竞"];
  const allowedValues = ["坦诚表达", "边界清晰", "共同成长", "情绪稳定", "生活有序", "保持好奇"];
  const allowedStyle = ["清冷", "学院", "运动", "中式", "正式", "随性"];
  const allowedHair = ["短发", "中长发", "长发", "不设偏好"];
  const allowedGlasses = ["常戴", "偶尔戴", "基本不戴", "不设偏好"];
  const allowedAppearanceFeel = ["成熟", "同龄", "少年", "不明显", "不设偏好"];

  return {
    id: existing.id || crypto.randomUUID(),
    token: existing.token || crypto.randomBytes(24).toString("hex"),
    roundId: currentRound(new Date(), settings).id,
    displayName: cleanText(input.displayName, 40),
    email: normalizeEmail(existing.email || input.email),
    birthYear: Number.parseInt(input.birthYear, 10) || null,
    idealBirthYearMin: Number.parseInt(input.idealBirthYearMin, 10) || null,
    idealBirthYearMax: Number.parseInt(input.idealBirthYearMax, 10) || null,
    age: Number.parseInt(input.age, 10) || null,
    gender: allowedGenders.includes(input.gender) ? input.gender : "",
    seeking: cleanList(input.seeking, allowedSeek),
    city: cleanText(input.city || cleanList(input.location, allowedLocations).join("、"), 40),
    school: "北京大学",
    department: cleanText(input.department || input.discipline, 80),
    stage: cleanText(input.stage || input.identity, 40),
    identity: allowedIdentities.includes(input.identity) ? input.identity : "",
    idealIdentities: cleanList(input.idealIdentities, allowedIdentities),
    schoolType: input.schoolType === "北京大学" ? "北京大学" : "",
    idealSchoolTypes: cleanList(input.idealSchoolTypes, allowedSchoolTypes),
    location: cleanList(input.location, allowedLocations),
    idealLocations: cleanList(input.idealLocations, allowedLocations),
    hometownProvince: allowedProvinces.includes(input.hometownProvince) ? input.hometownProvince : "",
    idealHometownRegions: cleanList(input.idealHometownRegions, allowedRegions),
    homeArea: allowedHomeAreas.includes(input.homeArea) ? input.homeArea : "",
    idealHomeAreas: cleanList(input.idealHomeAreas, allowedHomeAreas),
    discipline: allowedDisciplines.includes(input.discipline) ? input.discipline : "",
    idealDisciplines: cleanList(input.idealDisciplines, allowedDisciplines),
    intent: allowedIntent.includes(input.intent) ? input.intent : "",
    idealIntent: cleanList(input.idealIntent, allowedIntent),
    tempo: allowedTempo.includes(input.tempo) ? input.tempo : "",
    idealTempo: cleanList(input.idealTempo, allowedTempo),
    intimacy: allowedIntimacy.includes(input.intimacy) ? input.intimacy : "",
    idealIntimacy: cleanList(input.idealIntimacy, allowedIntimacy),
    intimacyTiming: allowedIntimacyTiming.includes(input.intimacyTiming) ? input.intimacyTiming : "",
    idealIntimacyTiming: cleanList(input.idealIntimacyTiming, allowedIntimacyTiming),
    weekend: cleanList(input.weekend || input.selfWeekends, allowedWeekend),
    values: cleanList(input.values || input.selfValues, allowedValues),
    selfWeekends: cleanList(input.selfWeekends || input.weekend, allowedWeekend),
    idealWeekends: cleanList(input.idealWeekends, allowedWeekend),
    selfValues: cleanList(input.selfValues || input.values, allowedValues),
    idealValues: cleanList(input.idealValues, allowedValues),
    selfStyle: cleanList(input.selfStyle, allowedStyle),
    idealStyle: cleanList(input.idealStyle, allowedStyle),
    hair: allowedHair.includes(input.hair) ? input.hair : "",
    idealHair: cleanList(input.idealHair, allowedHair),
    glasses: allowedGlasses.includes(input.glasses) ? input.glasses : "",
    idealGlasses: cleanList(input.idealGlasses, allowedGlasses),
    appearanceFeel: allowedAppearanceFeel.includes(input.appearanceFeel) ? input.appearanceFeel : "",
    idealAppearanceFeel: cleanList(input.idealAppearanceFeel, allowedAppearanceFeel),
    selfMetrics: cleanMetricMap(input.selfMetrics, false),
    idealMetrics: cleanMetricMap(input.idealMetrics, false),
    mbtiMetrics: cleanMbtiMap(input.mbtiMetrics),
    idealMbtiMetrics: cleanMbtiMap(input.idealMbtiMetrics),
    height: cleanHeight(input.height),
    idealHeight: cleanHeight(input.idealHeight),
    mbti: cleanText(input.mbti, 8).toUpperCase(),
    selfIntro: cleanText(input.selfIntro, 600),
    contactType: "微信",
    contactValue: cleanText(input.contactValue, 120),
    consent: input.consent === true,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function validateProfile(profile) {
  const missing = [];
  if (!profile.displayName) missing.push("展示名");
  if (!profile.gender) missing.push("我的性别");
  if (profile.seeking.length === 0) missing.push("希望匹配的对象性别");
  if (!profile.birthYear && !profile.age) missing.push("出生年");
  if (!profile.identity && !profile.stage) missing.push("目前身份");
  if (profile.schoolType !== "北京大学") missing.push("院校背景（北京大学）");
  if ((!Array.isArray(profile.location) || profile.location.length === 0) && !profile.city) missing.push("所在校区");
  if (!profile.intent) missing.push("匹配期待");
  if (!profile.tempo) missing.push("沟通节奏");
  if (!profile.contactValue) missing.push("联系方式");
  if (!profile.consent) missing.push("授权参与本轮匹配");
  return missing;
}

function publicProfile(profile, context = {}) {
  const frequency = context.frequencyMap?.get(profile.id) || null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    age: profile.age,
    birthYear: profile.birthYear,
    idealBirthYearMin: profile.idealBirthYearMin,
    idealBirthYearMax: profile.idealBirthYearMax,
    gender: profile.gender,
    city: profile.city,
    school: profile.school,
    department: profile.department,
    stage: profile.stage,
    identity: profile.identity,
    schoolType: profile.schoolType,
    location: profile.location,
    hometownProvince: profile.hometownProvince,
    idealHometownRegions: profile.idealHometownRegions,
    homeArea: profile.homeArea,
    discipline: profile.discipline,
    intent: profile.intent,
    tempo: profile.tempo,
    intimacy: profile.intimacy,
    intimacyTiming: profile.intimacyTiming,
    weekend: profile.weekend,
    values: profile.values,
    selfWeekends: profile.selfWeekends,
    selfValues: profile.selfValues,
    selfStyle: profile.selfStyle,
    hair: profile.hair,
    glasses: profile.glasses,
    appearanceFeel: profile.appearanceFeel,
    selfMetrics: profile.selfMetrics,
    idealMetrics: profile.idealMetrics,
    mbtiMetrics: profile.mbtiMetrics,
    idealMbtiMetrics: profile.idealMbtiMetrics,
    height: profile.height,
    idealHeight: profile.idealHeight,
    mbti: profile.mbti,
    selfIntro: profile.selfIntro,
    matchFrequency: frequency ? {
      label: frequency.label,
      intervalDays: frequency.intervalDays,
      daysSinceLastMatch: frequency.daysSinceLastMatch,
      lastSuccessfulMatchAt: frequency.lastSuccessfulMatchAt,
      expectedNextAllocationAt: frequency.expectedNextAllocationAt,
      nextEligibleAt: frequency.nextEligibleAt,
      referenceDays: frequency.referenceDays,
      eligible: frequency.eligible,
      reason: frequency.reason
    } : undefined,
    updatedAt: profile.updatedAt
  };
}

function genderCompatible(a, b) {
  const aOpen = a.seeking.includes("不限");
  const bOpen = b.seeking.includes("不限");
  return (aOpen || a.seeking.includes(b.gender)) && (bOpen || b.seeking.includes(a.gender));
}

function overlapScore(a = [], b = [], weight = 1) {
  const set = new Set(a);
  const hits = b.filter(item => set.has(item)).length;
  return hits * weight;
}

function preferenceScore(actual, acceptable = [], weight = 1) {
  if (!actual || !Array.isArray(acceptable) || acceptable.length === 0) return 0;
  if (acceptable.includes("不设偏好")) return Math.round(weight * 0.6);
  return acceptable.includes(actual) ? weight : 0;
}

function preferenceScoreAny(actual, acceptable = [], weight = 1) {
  const actualList = Array.isArray(actual) ? actual : [actual];
  if (!actualList.filter(Boolean).length || !Array.isArray(acceptable) || acceptable.length === 0) return 0;
  if (acceptable.includes("不设偏好")) return Math.round(weight * 0.6);
  return actualList.some(item => acceptable.includes(item)) ? weight : 0;
}

function mutualPreferenceScore(aActual, aIdeal, bActual, bIdeal, weight = 1) {
  return preferenceScore(bActual, aIdeal, weight) + preferenceScore(aActual, bIdeal, weight);
}

function mutualPreferenceScoreAny(aActual, aIdeal, bActual, bIdeal, weight = 1) {
  return preferenceScoreAny(bActual, aIdeal, weight) + preferenceScoreAny(aActual, bIdeal, weight);
}

function yearInRange(year, min, max) {
  if (!year) return false;
  const lower = Number.isInteger(min) ? min : 1900;
  const upper = Number.isInteger(max) ? max : 2100;
  return year >= Math.min(lower, upper) && year <= Math.max(lower, upper);
}

function mutualYearRangeScore(aYear, aMin, aMax, bYear, bMin, bMax) {
  let score = 0;
  const aHasRange = Number.isInteger(aMin) || Number.isInteger(aMax);
  const bHasRange = Number.isInteger(bMin) || Number.isInteger(bMax);
  if (aHasRange && yearInRange(bYear, aMin, aMax)) score += 3;
  if (bHasRange && yearInRange(aYear, bMin, bMax)) score += 3;
  return score;
}

function metricScore(a, b) {
  const labels = {
    warmth: "相处气质",
    ambition: "学业事业节奏",
    decision: "决策方式",
    novelty: "新鲜感偏好",
    schedule: "作息节律"
  };
  let score = 0;
  const reasons = [];
  for (const key of Object.keys(labels)) {
    const aIdeal = Number.isInteger(a.idealMetrics?.[key]) ? [a.idealMetrics[key]] : (Array.isArray(a.idealMetrics?.[key]) ? a.idealMetrics[key] : []);
    const bIdeal = Number.isInteger(b.idealMetrics?.[key]) ? [b.idealMetrics[key]] : (Array.isArray(b.idealMetrics?.[key]) ? b.idealMetrics[key] : []);
    const aHit = Number.isInteger(b.selfMetrics?.[key]) && aIdeal.includes(b.selfMetrics[key]);
    const bHit = Number.isInteger(a.selfMetrics?.[key]) && bIdeal.includes(a.selfMetrics[key]);
    if (aHit) score += 3;
    if (bHit) score += 3;
    if (aHit && bHit) reasons.push(`${labels[key]}互相落在期待范围`);
  }
  return { score, reasons };
}

function heightScore(a, b) {
  let score = 0;
  if (Number.isInteger(a.idealHeight) && Number.isInteger(b.height)) {
    score += Math.max(0, 4 - Math.floor(Math.abs(a.idealHeight - b.height) / 3));
  }
  if (Number.isInteger(b.idealHeight) && Number.isInteger(a.height)) {
    score += Math.max(0, 4 - Math.floor(Math.abs(b.idealHeight - a.height) / 3));
  }
  return score;
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join("::");
}

function matchTime(match) {
  return new Date(match.publishedAt || match.updatedAt || match.createdAt || 0).getTime() || 0;
}

function matchHistory(matches = []) {
  const pairCounts = new Map();
  const lastPartners = new Map();
  const lastMatchedAt = new Map();
  const proposals = matches
    .filter(match => ["draft", "published"].includes(match.status))
    .sort((a, b) => matchTime(a) - matchTime(b));
  for (const match of proposals) {
    const key = pairKey(match.leftId, match.rightId);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    const at = matchTime(match);
    lastPartners.set(match.leftId, match.rightId);
    lastPartners.set(match.rightId, match.leftId);
    if (match.status === "published") {
      lastMatchedAt.set(match.leftId, at);
      lastMatchedAt.set(match.rightId, at);
    }
  }
  return { pairCounts, lastPartners, lastMatchedAt };
}

function listLength(value) {
  return Array.isArray(value) ? value.length : (value ? 1 : 0);
}

function containsValue(value, expected) {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

function rareTraitCount(profile, pool) {
  const traits = [
    ["identity", profile.identity],
    ["discipline", profile.discipline],
    ["intent", profile.intent],
    ["tempo", profile.tempo],
    ["intimacy", profile.intimacy],
    ["intimacyTiming", profile.intimacyTiming],
    ...(Array.isArray(profile.selfValues) ? profile.selfValues.map(value => ["selfValues", value]) : []),
    ...(Array.isArray(profile.selfStyle) ? profile.selfStyle.map(value => ["selfStyle", value]) : [])
  ].filter(([, value]) => value);
  const unique = new Map(traits.map(([field, value]) => [`${field}:${value}`, [field, value]]));
  const rareLimit = Math.max(2, Math.ceil(pool.length * 0.28));
  return [...unique.values()].filter(([field, value]) => {
    const count = pool.filter(item => containsValue(item[field], value)).length;
    return count > 0 && count <= rareLimit && count < pool.length;
  }).length;
}

function profileFrequency(profile, profiles, history, settings = defaultData.settings, now = Date.now()) {
  const pool = profiles.filter(item => item.consent);
  const genderTotal = pool.filter(item => item.gender === profile.gender).length || 1;
  const genderShare = pool.length ? genderTotal / pool.length : 1;
  const idealLengths = [
    listLength(profile.seeking),
    listLength(profile.idealIdentities),
    listLength(profile.idealLocations),
    listLength(profile.idealHometownRegions),
    listLength(profile.idealHomeAreas),
    listLength(profile.idealDisciplines),
    listLength(profile.idealIntent),
    listLength(profile.idealTempo),
    listLength(profile.idealIntimacy),
    listLength(profile.idealIntimacyTiming),
    listLength(profile.idealWeekends),
    listLength(profile.idealValues),
    listLength(profile.idealStyle)
  ];
  const precise = idealLengths.filter(length => length >= 1 && length <= 3).length;
  const tooBroad = idealLengths.filter(length => length >= 5).length + (profile.seeking?.includes("不限") ? 2 : 0);
  const tooNarrow = idealLengths.filter(length => length === 1).length;
  const rareGender = genderShare <= 0.38;
  const rareTraits = rareTraitCount(profile, pool);
  const rarePersonality = rareTraits >= 2;
  const interval = cleanSettings(settings).matchIntervalDays;
  const lastAt = history.lastMatchedAt.get(profile.id) || 0;
  const daysSince = lastAt ? Math.max(0, Math.floor((now - lastAt) / 86_400_000)) : null;
  let label = "标准频率";
  let intervalDays = interval;
  const reasons = [];
  if (rareGender) reasons.push("性别画像相对稀缺");
  if (rarePersonality) reasons.push("相处节奏或性格画像相对稀缺");
  if (precise >= 8) reasons.push("TA 画像较精准");
  if (tooBroad >= 5) reasons.push("TA 画像偏宽");
  if (tooNarrow >= 9) reasons.push("TA 画像偏窄");
  if (rareGender || rarePersonality || precise >= 8) {
    label = "高频";
    intervalDays = Math.max(1, Math.floor(interval / 2));
  }
  if (tooBroad >= 5 || tooNarrow >= 9) {
    label = "低频观察";
    intervalDays = interval * 2;
  }
  const nextEligibleAtMs = lastAt ? lastAt + intervalDays * 86_400_000 : now;
  const referenceDays = Math.max(0, Math.ceil((nextEligibleAtMs - now) / 86_400_000));
  const overdue = nextEligibleAtMs <= now;
  const waitBoost = daysSince === null
    ? 18
    : Math.min(36, (daysSince >= intervalDays ? 10 : 0) + Math.floor(Math.max(0, daysSince - intervalDays) / Math.max(1, intervalDays)) * 8);
  const notYetPenalty = overdue ? 0 : 12 + referenceDays * 3;
  if (daysSince === null) reasons.push("尚无成功匹配记录");
  else if (daysSince >= intervalDays) reasons.push(`距上次成功匹配 ${daysSince} 天`);
  return {
    label,
    intervalDays,
    daysSinceLastMatch: daysSince,
    lastSuccessfulMatchAt: lastAt ? new Date(lastAt).toISOString() : null,
    expectedNextAllocationAt: new Date(nextEligibleAtMs).toISOString(),
    nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
    referenceDays,
    eligible: overdue,
    priority: (rareGender ? 10 : 0) + (rarePersonality ? 8 : 0) + Math.min(12, precise) - tooBroad * 2 - Math.max(0, tooNarrow - 8) + waitBoost - notYetPenalty,
    reason: reasons.join("；") || "画像分布适中"
  };
}

function frequencyMapFor(profiles, matches, settings) {
  const history = matchHistory(matches);
  const now = Date.now();
  return new Map(profiles.map(profile => [profile.id, profileFrequency(profile, profiles, history, settings, now)]));
}

function mbtiMetricScore(a, b) {
  const keys = ["ei", "sn", "tf", "jp"];
  let score = 0;
  for (const key of keys) {
    const aIdeal = Number(a.idealMbtiMetrics?.[key]);
    const bIdeal = Number(b.idealMbtiMetrics?.[key]);
    const aActual = Number(a.mbtiMetrics?.[key]);
    const bActual = Number(b.mbtiMetrics?.[key]);
    if (Number.isInteger(aIdeal) && Number.isInteger(bActual) && Math.abs(aIdeal - bActual) <= 1) score += 1;
    if (Number.isInteger(bIdeal) && Number.isInteger(aActual) && Math.abs(bIdeal - aActual) <= 1) score += 1;
  }
  return score;
}

function scorePair(a, b) {
  if (a.id === b.id || !genderCompatible(a, b)) return null;

  let score = 45;
  const reasons = [];
  if (a.intent && b.intent && a.intent === b.intent) {
    score += 6;
    reasons.push(`都偏向「${a.intent}」`);
  }
  const intentScore = mutualPreferenceScore(a.intent, a.idealIntent, b.intent, b.idealIntent, 6);
  if (intentScore) {
    score += intentScore;
    reasons.push("关系期待互相符合");
  }
  const tempoScore = mutualPreferenceScore(a.tempo, a.idealTempo, b.tempo, b.idealTempo, 5);
  if (tempoScore) {
    score += tempoScore;
    reasons.push("沟通节奏互相接受");
  }
  const intimacyScore = mutualPreferenceScore(a.intimacy, a.idealIntimacy, b.intimacy, b.idealIntimacy, 4)
    + mutualPreferenceScore(a.intimacyTiming, a.idealIntimacyTiming, b.intimacyTiming, b.idealIntimacyTiming, 3);
  if (intimacyScore) {
    score += intimacyScore;
    reasons.push("亲密边界互相尊重");
  }
  const sharedLocation = Array.isArray(a.location) && Array.isArray(b.location)
    ? a.location.some(item => b.location.includes(item))
    : a.location && b.location && a.location === b.location;
  if (sharedLocation || (a.city && b.city && a.city === b.city)) {
    score += 8;
    reasons.push(`常驻地相同`);
  }
  score += mutualPreferenceScore(a.identity || a.stage, a.idealIdentities, b.identity || b.stage, b.idealIdentities, 4);
  score += mutualPreferenceScore(a.schoolType, a.idealSchoolTypes, b.schoolType, b.idealSchoolTypes, 3);
  score += mutualPreferenceScoreAny(a.location || a.city, a.idealLocations, b.location || b.city, b.idealLocations, 4);
  score += mutualPreferenceScore(regionForProvince(a.hometownProvince), a.idealHometownRegions, regionForProvince(b.hometownProvince), b.idealHometownRegions, 2);
  score += mutualPreferenceScore(a.homeArea, a.idealHomeAreas, b.homeArea, b.idealHomeAreas, 2);
  score += mutualPreferenceScore(a.discipline || a.department, a.idealDisciplines, b.discipline || b.department, b.idealDisciplines, 3);
  if (a.school && b.school && a.school === b.school) {
    score += 4;
    reasons.push(`学校信息接近`);
  }
  const weekend = overlapScore(b.selfWeekends || b.weekend, a.idealWeekends || [], 3)
    + overlapScore(a.selfWeekends || a.weekend, b.idealWeekends || [], 3)
    + overlapScore(a.selfWeekends || a.weekend, b.selfWeekends || b.weekend, 2);
  const values = overlapScore(b.selfValues || b.values, a.idealValues || [], 4)
    + overlapScore(a.selfValues || a.values, b.idealValues || [], 4)
    + overlapScore(a.selfValues || a.values, b.selfValues || b.values, 2);
  score += weekend + values;
  if (weekend) reasons.push(`周末偏好有交集`);
  if (values) reasons.push(`关系价值观相似`);
  const styleScore = overlapScore(b.selfStyle, a.idealStyle, 2) + overlapScore(a.selfStyle, b.idealStyle, 2);
  if (styleScore) {
    score += styleScore;
    reasons.push("日常审美互相接受");
  }
  score += mutualPreferenceScore(a.hair, a.idealHair, b.hair, b.idealHair, 2);
  score += mutualPreferenceScore(a.glasses, a.idealGlasses, b.glasses, b.idealGlasses, 1);
  score += mutualPreferenceScore(a.appearanceFeel, a.idealAppearanceFeel, b.appearanceFeel, b.idealAppearanceFeel, 2);
  const heightFit = heightScore(a, b);
  if (heightFit) {
    score += heightFit;
    reasons.push("身高接近期待");
  }
  const metric = metricScore(a, b);
  score += metric.score;
  reasons.push(...metric.reasons);
  const mbtiSliderScore = mbtiMetricScore(a, b);
  if (mbtiSliderScore) {
    score += mbtiSliderScore;
    reasons.push("MBTI 四维倾向接近期待");
  }
  if (a.mbti && b.mbti && a.mbti[0] === b.mbti[0]) score += 2;
  const aYear = a.birthYear || (a.age ? new Date().getFullYear() - a.age : null);
  const bYear = b.birthYear || (b.age ? new Date().getFullYear() - b.age : null);
  const yearRangeScore = mutualYearRangeScore(aYear, a.idealBirthYearMin, a.idealBirthYearMax, bYear, b.idealBirthYearMin, b.idealBirthYearMax);
  if (yearRangeScore) {
    score += yearRangeScore;
    reasons.push("出生年落在期待范围");
  }
  if (aYear && bYear) score -= Math.min(8, Math.abs(aYear - bYear));

  return {
    score: Math.max(0, Math.min(99, Math.round(score))),
    reasons: reasons.slice(0, 4)
  };
}

function bestMatchesFor(profile, profiles) {
  return profiles
    .map(candidate => {
      const result = scorePair(profile, candidate);
      return result ? { profile: candidate, ...result } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => ({
      score: item.score,
      reasons: item.reasons,
      profile: publicProfile(item.profile),
      contact: item.score >= 58 ? {
        type: item.profile.contactType,
        value: item.profile.contactValue
      } : null
    }));
}

function generateRoundMatches(profiles, roundId, matches = [], settings = defaultData.settings) {
  const pool = profiles.filter(profile => profile.consent);
  const history = matchHistory(matches);
  const frequencies = frequencyMapFor(pool, matches, settings);
  const activePool = pool;
  const used = new Set();
  const candidates = [];
  const pairs = [];
  const batchId = `${roundId}-${Date.now().toString(36)}`;
  for (let i = 0; i < activePool.length; i += 1) {
    for (let j = i + 1; j < activePool.length; j += 1) {
      const scored = scorePair(activePool[i], activePool[j]);
      if (!scored) continue;
      const key = pairKey(activePool[i].id, activePool[j].id);
      const repeatedCount = history.pairCounts.get(key) || 0;
      const lastRepeat = history.lastPartners.get(activePool[i].id) === activePool[j].id || history.lastPartners.get(activePool[j].id) === activePool[i].id;
      const leftFrequency = frequencies.get(activePool[i].id) || { priority: 0 };
      const rightFrequency = frequencies.get(activePool[j].id) || { priority: 0 };
      const schedulePenalty = (leftFrequency.eligible ? 0 : 18) + (rightFrequency.eligible ? 0 : 18);
      const adjustedScore = scored.score + leftFrequency.priority + rightFrequency.priority - schedulePenalty - repeatedCount * 22 - (lastRepeat ? 34 : 0);
      candidates.push({ left: activePool[i], right: activePool[j], adjustedScore, repeatedCount, lastRepeat, ...scored });
    }
  }
  candidates.sort((a, b) => b.adjustedScore - a.adjustedScore);
  for (const best of candidates) {
    if (used.has(best.left.id) || used.has(best.right.id)) continue;
    used.add(best.left.id);
    used.add(best.right.id);
    const leftFrequency = frequencies.get(best.left.id);
    const rightFrequency = frequencies.get(best.right.id);
    pairs.push({
      id: crypto.randomUUID(),
      roundId,
      batchId,
      leftId: best.left.id,
      rightId: best.right.id,
      score: best.score,
      adjustedScore: Math.round(best.adjustedScore),
      reasons: [
        ...best.reasons,
        best.lastRepeat ? "已避让上次搭档后仍为当前最优" : "已参考历史搭档避重",
        `${best.left.displayName}：${leftFrequency?.label || "标准频率"}`,
        `${best.right.displayName}：${rightFrequency?.label || "标准频率"}`,
        leftFrequency?.eligible && rightFrequency?.eligible ? "双方均已到参考分配时间" : "已参考个人分配时间作降权"
      ].slice(0, 8),
      status: "draft",
      notes: "",
      frequency: {
        [best.left.id]: leftFrequency,
        [best.right.id]: rightFrequency
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return pairs;
}

function publishedMatchesFor(profile, profiles, matches) {
  const byId = new Map(profiles.map(item => [item.id, item]));
  return matches
    .filter(match => match.status === "published" && (match.leftId === profile.id || match.rightId === profile.id))
    .sort((a, b) => matchTime(b) - matchTime(a))
    .slice(0, 2)
    .map(match => {
      const otherId = match.leftId === profile.id ? match.rightId : match.leftId;
      const other = byId.get(otherId);
      if (!other) return null;
      return {
        score: match.score,
        reasons: match.reasons || [],
        pushedAt: match.publishedAt || match.updatedAt || match.createdAt,
        profile: publicProfile(other),
        contact: {
          type: other.contactType,
          value: other.contactValue
        }
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function demoProfile(overrides) {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    token: overrides.token || crypto.randomBytes(24).toString("hex"),
    roundId: overrides.roundId,
    displayName: overrides.displayName,
    email: overrides.email,
    birthYear: overrides.birthYear,
    idealBirthYearMin: overrides.idealBirthYearMin || 1996,
    idealBirthYearMax: overrides.idealBirthYearMax || 2005,
    age: null,
    gender: overrides.gender,
    seeking: overrides.seeking,
    city: (overrides.location || []).join("、"),
    school: "北京大学",
    department: overrides.discipline,
    stage: overrides.identity,
    identity: overrides.identity,
    idealIdentities: overrides.idealIdentities || ["本科生", "硕士生", "博士生"],
    schoolType: "北京大学",
    idealSchoolTypes: [],
    location: overrides.location,
    idealLocations: overrides.idealLocations || ["燕园", "万柳", "学院路"],
    hometownProvince: overrides.hometownProvince,
    idealHometownRegions: overrides.idealHometownRegions || ["华北", "华东", "华中", "华南"],
    homeArea: overrides.homeArea || "直辖市/省会/首府/计划单列市",
    idealHomeAreas: overrides.idealHomeAreas || ["直辖市/省会/首府/计划单列市", "地级市/州府/公署驻地", "其他城市化地区"],
    discipline: overrides.discipline,
    idealDisciplines: overrides.idealDisciplines || ["理学", "工学", "人文", "社科", "经管法"],
    intent: overrides.intent,
    idealIntent: overrides.idealIntent || ["认真发展", "慢慢了解", overrides.intent].filter(Boolean),
    tempo: overrides.tempo,
    idealTempo: overrides.idealTempo || ["高频交流", "日常分享", "线下优先"],
    intimacy: overrides.intimacy || "自然走进",
    idealIntimacy: overrides.idealIntimacy || ["自然走进", "先定关系"],
    intimacyTiming: overrides.intimacyTiming || "有稳定好感后",
    idealIntimacyTiming: overrides.idealIntimacyTiming || ["有稳定好感后", "相熟一到三个月后", "顺其自然"],
    weekend: overrides.selfWeekends,
    values: overrides.selfValues,
    selfWeekends: overrides.selfWeekends,
    idealWeekends: overrides.idealWeekends || ["散步游览", "运动户外", "做饭探店", "自习工作"],
    selfValues: overrides.selfValues,
    idealValues: overrides.idealValues || ["坦诚表达", "情绪稳定", "共同成长", "边界清晰"],
    selfStyle: overrides.selfStyle,
    idealStyle: overrides.idealStyle || ["清冷", "学院", "正式", "随性"],
    hair: overrides.hair || "中长发",
    idealHair: overrides.idealHair || ["短发", "中长发", "长发"],
    glasses: overrides.glasses || "偶尔戴",
    idealGlasses: overrides.idealGlasses || ["不设偏好"],
    appearanceFeel: overrides.appearanceFeel || "同龄",
    idealAppearanceFeel: overrides.idealAppearanceFeel || ["不设偏好"],
    selfMetrics: overrides.selfMetrics || { warmth: 3, ambition: 1, decision: 1, novelty: 1, schedule: 1 },
    idealMetrics: overrides.idealMetrics || { warmth: 3, ambition: 3, decision: 3, novelty: 3, schedule: 3 },
    mbtiMetrics: overrides.mbtiMetrics || { ei: -1, sn: 1, tf: 1, jp: 1 },
    idealMbtiMetrics: overrides.idealMbtiMetrics || { ei: -1, sn: 1, tf: 1, jp: 1 },
    height: overrides.height,
    idealHeight: overrides.idealHeight,
    mbti: "",
    selfIntro: overrides.selfIntro || "MoonShade 本地测试用户。",
    contactType: "微信",
    contactValue: overrides.contactValue,
    consent: true,
    isDemo: true,
    updatedAt: now,
    createdAt: overrides.createdAt || now
  };
}

function seedDemoProfiles(data) {
  const roundId = currentRound(new Date(), data.settings).id;
  const demos = [
    demoProfile({ id: "demo-lina", roundId, displayName: "林夏", email: "2400000001@stu.pku.edu.cn", birthYear: 2002, gender: "女", seeking: ["男"], identity: "本科生", location: ["燕园"], hometownProvince: "北京", discipline: "人文", intent: "认真发展", tempo: "日常分享", selfWeekends: ["散步游览", "自习工作"], selfValues: ["坦诚表达", "情绪稳定"], selfStyle: ["学院", "清冷"], height: 165, idealHeight: 178, contactValue: "demo_linxia" }),
    demoProfile({ id: "demo-qinghe", roundId, displayName: "清和", email: "2400000002@stu.pku.edu.cn", birthYear: 2001, gender: "女", seeking: ["男"], identity: "硕士生", location: ["万柳", "燕园"], hometownProvince: "江苏", discipline: "社科", intent: "慢慢了解", tempo: "高频交流", selfWeekends: ["外出旅行", "散步游览"], selfValues: ["共同成长", "保持好奇"], selfStyle: ["随性", "学院"], height: 168, idealHeight: 179, contactValue: "demo_qinghe" }),
    demoProfile({ id: "demo-yunting", roundId, displayName: "云亭", email: "2400000003@stu.pku.edu.cn", birthYear: 2000, gender: "女", seeking: ["男"], identity: "博士生", location: ["学院路"], hometownProvince: "浙江", discipline: "理学", intent: "认真发展", tempo: "低频稳定", selfWeekends: ["自习工作", "做饭探店"], selfValues: ["生活有序", "边界清晰"], selfStyle: ["正式", "清冷"], height: 162, idealHeight: 176, contactValue: "demo_yunting" }),
    demoProfile({ id: "demo-mingyuan", roundId, displayName: "明远", email: "2400000004@pku.edu.cn", birthYear: 1999, gender: "男", seeking: ["女"], identity: "硕士生", location: ["燕园"], hometownProvince: "河北", discipline: "工学", intent: "认真发展", tempo: "日常分享", selfWeekends: ["运动户外", "散步游览"], selfValues: ["坦诚表达", "共同成长"], selfStyle: ["学院", "运动"], height: 180, idealHeight: 166, contactValue: "demo_mingyuan" }),
    demoProfile({ id: "demo-zichen", roundId, displayName: "子辰", email: "2400000005@pku.edu.cn", birthYear: 2001, gender: "男", seeking: ["女"], identity: "本科生", location: ["万柳"], hometownProvince: "广东", discipline: "经管法", intent: "慢慢了解", tempo: "高频交流", selfWeekends: ["外出旅行", "朋友聚会"], selfValues: ["保持好奇", "情绪稳定"], selfStyle: ["随性", "正式"], height: 176, idealHeight: 168, contactValue: "demo_zichen" }),
    demoProfile({ id: "demo-huaiyu", roundId, displayName: "怀玉", email: "2400000006@stu.pku.edu.cn", birthYear: 1998, gender: "男", seeking: ["女"], identity: "博士生", location: ["学院路", "燕园"], hometownProvince: "辽宁", discipline: "理学", intent: "快速转进", tempo: "低频稳定", selfWeekends: ["自习工作", "做饭探店"], selfValues: ["生活有序", "边界清晰"], selfStyle: ["正式", "中式"], height: 179, idealHeight: 165, contactValue: "demo_huaiyu" })
  ];
  const existing = new Map(data.profiles.map(profile => [profile.id, profile]));
  let added = 0;
  let updated = 0;
  for (const profile of demos) {
    if (existing.has(profile.id)) {
      Object.assign(existing.get(profile.id), profile, { createdAt: existing.get(profile.id).createdAt || profile.createdAt });
      updated += 1;
    } else {
      data.profiles.push(profile);
      added += 1;
    }
  }
  return { added, updated, totalDemo: demos.length };
}

function adminProfile(profile, context = {}) {
  const frequency = context.frequencyMap?.get(profile.id) || null;
  return {
    ...profile,
    matchFrequency: frequency,
    token: undefined
  };
}

function serializeAdminMatches(matches, profiles, settings = defaultData.settings, historyMatches = matches) {
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const frequencies = frequencyMapFor(profiles, historyMatches, settings);
  return [...matches].sort((a, b) => matchTime(b) - matchTime(a)).map(match => ({
    ...match,
    left: byId.get(match.leftId) ? publicProfile(byId.get(match.leftId), { frequencyMap: frequencies }) : null,
    right: byId.get(match.rightId) ? publicProfile(byId.get(match.rightId), { frequencyMap: frequencies }) : null
  }));
}

async function handleApi(req, res, url) {
  const data = await readJson(DATA_FILE);

  if (req.method === "POST" && url.pathname === "/api/auth/request-code") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    if (body.sliderPassed !== true) {
      return sendJson(res, 400, { error: "请先完成滑动安全验证。" });
    }
    if (!isAllowedEmail(email)) {
      return sendJson(res, 400, { error: "仅支持 10 位数字 + @stu.pku.edu.cn 或 10 位数字 + @pku.edu.cn 邮箱。" });
    }
    if (email === ADMIN_EMAIL || data.users.some(user => user.email === email && user.passwordHash)) {
      return sendJson(res, 409, { error: "该邮箱已注册，请使用密码登录。" });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    data.verifications = data.verifications.filter(item => item.email !== email);
    data.verifications.push({
      email,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: 0
    });
    const delivery = await sendVerificationEmail(email, code);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, {
      ok: true,
      message: delivery.delivered ? "验证码已发送，请查收邮箱。" : "本地开发模式：验证码已显示在页面上。",
      devCode: delivery.devCode
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/check-email") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    if (body.sliderPassed !== true) return sendJson(res, 400, { error: "请先完成滑动安全验证。" });
    if (!isAllowedEmail(email)) {
      return sendJson(res, 400, { error: "仅支持 10 位数字 + @stu.pku.edu.cn 或 10 位数字 + @pku.edu.cn 邮箱。" });
    }
    const exists = email === ADMIN_EMAIL || data.users.some(user => user.email === email && user.passwordHash);
    return sendJson(res, 200, { email, exists });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    if (email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD) {
      const token = makeToken();
      const adminToken = makeToken();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
      data.userSessions.push({ token, email, createdAt: now, expiresAt });
      data.adminSessions.push({ token: adminToken, email, createdAt: now, expiresAt });
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { token, adminToken, email, role: "admin" });
    }
    const user = data.users.find(item => item.email === email && item.passwordHash);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return sendJson(res, 401, { error: "邮箱或密码不正确。" });
    }
    const token = makeToken();
    data.userSessions.push({
      token,
      email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
    });
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/verify") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    const code = cleanText(body.code, 12);
    const password = String(body.password || "");
    if (password.length < 8) {
      return sendJson(res, 400, { error: "请设置至少 8 位密码。" });
    }
    const record = data.verifications.find(item => item.email === email);
    if (!record || new Date(record.expiresAt) <= new Date()) {
      return sendJson(res, 400, { error: "验证码不存在或已过期。" });
    }
    record.attempts += 1;
    if (record.attempts > 5 || record.codeHash !== hashCode(code)) {
      await writeJson(DATA_FILE, data);
      return sendJson(res, 400, { error: "验证码不正确。" });
    }
    const user = data.users.find(item => item.email === email) || { id: crypto.randomUUID(), email, createdAt: new Date().toISOString() };
    user.verifiedAt = new Date().toISOString();
    user.passwordHash = hashPassword(password);
    if (!data.users.some(item => item.email === email)) data.users.push(user);
    const token = makeToken();
    data.userSessions.push({
      token,
      email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
    });
    data.verifications = data.verifications.filter(item => item.email !== email);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getUserBySession(data, url.searchParams.get("authToken"));
    return sendJson(res, 200, { user: user ? { email: user.email, verifiedAt: user.verifiedAt } : null });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = JSON.parse(await readBody(req) || "{}");
    if (normalizeEmail(body.email) !== ADMIN_EMAIL || body.password !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { error: "管理员账号或密码不正确。" });
    }
    const token = makeToken();
    data.adminSessions.push({
      token,
      email: ADMIN_EMAIL,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString()
    });
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email: ADMIN_EMAIL });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const adminBody = req.method === "GET" ? {} : JSON.parse(await readBody(req) || "{}");
    const token = req.method === "GET" ? url.searchParams.get("adminToken") : adminBody.adminToken;
    if (!requireAdmin(data, token)) return sendJson(res, 401, { error: "需要管理员登录。" });

    if (req.method === "GET" && url.pathname === "/api/admin/profiles") {
      const frequencyMap = frequencyMapFor(data.profiles, data.matches, data.settings);
      return sendJson(res, 200, { profiles: data.profiles.map(profile => adminProfile(profile, { frequencyMap })), users: data.users });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/matches") {
      return sendJson(res, 200, { matches: serializeAdminMatches(data.matches, data.profiles, data.settings), profiles: data.profiles.map(publicProfile) });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/settings") {
      return sendJson(res, 200, { settings: cleanSettings(data.settings), round: currentRound(new Date(), data.settings) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/settings") {
      data.settings = cleanSettings(adminBody.settings || adminBody);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { settings: data.settings, round: currentRound(new Date(), data.settings) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/generate") {
      const roundId = currentRound(new Date(), data.settings).id;
      const generated = generateRoundMatches(data.profiles, roundId, data.matches, data.settings);
      data.matches = data.matches.filter(match => !(match.roundId === roundId && match.status === "draft")).concat(generated);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { matches: serializeAdminMatches(generated, data.profiles, data.settings, data.matches) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/publish") {
      const roundId = currentRound(new Date(), data.settings).id;
      let published = 0;
      data.matches.forEach(match => {
        if (match.roundId === roundId && match.status === "draft") {
          match.status = "published";
          match.publishedAt = new Date().toISOString();
          match.updatedAt = new Date().toISOString();
          published += 1;
        }
      });
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { published, matches: serializeAdminMatches(data.matches, data.profiles, data.settings) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/demo-users") {
      const result = seedDemoProfiles(data);
      await writeJson(DATA_FILE, data);
      const frequencyMap = frequencyMapFor(data.profiles, data.matches, data.settings);
      return sendJson(res, 200, { ...result, profiles: data.profiles.map(profile => adminProfile(profile, { frequencyMap })) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/update") {
      const body = adminBody;
      const match = data.matches.find(item => item.id === body.matchId);
      if (!match) return sendJson(res, 404, { error: "匹配记录不存在。" });
      if (body.leftId) match.leftId = cleanText(body.leftId, 80);
      if (body.rightId) match.rightId = cleanText(body.rightId, 80);
      if (body.status) {
        const nextStatus = cleanText(body.status, 30);
        if (nextStatus === "published" && match.status !== "published") match.publishedAt = new Date().toISOString();
        match.status = nextStatus;
      }
      match.notes = cleanText(body.notes, 500);
      const left = data.profiles.find(item => item.id === match.leftId);
      const right = data.profiles.find(item => item.id === match.rightId);
      const scored = left && right ? scorePair(left, right) : null;
      if (scored) {
        match.score = scored.score;
        match.reasons = scored.reasons;
      }
      match.updatedAt = new Date().toISOString();
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { match: serializeAdminMatches([match], data.profiles, data.settings, data.matches)[0] });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/round") {
    const round = currentRound(new Date(), data.settings);
    const roundProfiles = data.profiles.filter(profile => profile.consent);
    return sendJson(res, 200, {
      round,
      settings: cleanSettings(data.settings),
      stats: {
        participants: roundProfiles.length,
        women: roundProfiles.filter(profile => profile.gender === "女").length,
        men: roundProfiles.filter(profile => profile.gender === "男").length
      },
      announcements: data.announcements || []
    });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const token = url.searchParams.get("token");
    const authUser = getUserBySession(data, url.searchParams.get("authToken"));
    const profile = authUser
      ? data.profiles.find(item => item.email === authUser.email)
      : data.profiles.find(item => item.token === token);
    const frequencyMap = frequencyMapFor(data.profiles, data.matches, data.settings);
    return sendJson(res, 200, {
      profile: profile ? {
        ...profile,
        matchFrequency: frequencyMap.get(profile.id) || null
      } : null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/profile") {
    const body = JSON.parse(await readBody(req) || "{}");
    const authUser = getUserBySession(data, body.authToken);
    if (!authUser) return sendJson(res, 401, { error: "请先完成北大邮箱验证。" });
    const existing = data.profiles.find(item => item.email === authUser.email);
    const profile = sanitizeProfile({ ...body, email: authUser.email }, existing, data.settings);
    const missing = validateProfile(profile);
    if (missing.length) {
      return sendJson(res, 400, { error: "问卷还没填完整", missing });
    }
    if (existing) {
      Object.assign(existing, profile);
    } else {
      data.profiles.push(profile);
    }
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { profile });
  }

  if (req.method === "GET" && url.pathname === "/api/matches") {
    const token = url.searchParams.get("token");
    const authUser = getUserBySession(data, url.searchParams.get("authToken"));
    const profile = authUser
      ? data.profiles.find(item => item.email === authUser.email)
      : data.profiles.find(item => item.token === token);
    if (!profile) return sendJson(res, 404, { error: "还没有找到你的问卷，请先提交。" });
    const frequencyMap = frequencyMapFor(data.profiles, data.matches, data.settings);
    const matches = publishedMatchesFor(profile, data.profiles.filter(item => item.consent), data.matches);
    return sendJson(res, 200, { profile: publicProfile(profile, { frequencyMap }), matches });
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    await stat(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

await ensureDataFile();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器错误" });
  }
});

server.listen(PORT, () => {
  console.log(`MoonShade is running at http://localhost:${PORT}`);
});
