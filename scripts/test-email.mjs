import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL("..", import.meta.url));

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
  const verbose = envBool(envValue("MOONSHADE_SMTP_VERBOSE", "SMTP_VERBOSE"), true);

  if (!host || !from || !to) {
    throw new Error("请设置 MOONSHADE_SMTP_HOST、MOONSHADE_SMTP_FROM 和 TEST_EMAIL_TO。");
  }

  const log = message => {
    if (verbose) console.log(message);
  };

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

  log(`正在连接 SMTP：${host}:${port} (${secure ? "SSL/TLS" : "plain + STARTTLS"})`);
  await new Promise((resolve, reject) => {
    const nextSocket = secure
      ? tls.connect({ host, port, servername: host }, resolve)
      : net.createConnection({ host, port }, resolve);
    nextSocket.on("error", reject);
    attachSocket(nextSocket);
  });

  try {
    expect(await readResponse(), 220, "CONNECT");
    log("SMTP 已连接。");
    await command(`EHLO ${helloName}`, 250);

    if (!secure && startTls) {
      log("正在升级到 STARTTLS...");
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
      log(`正在认证 SMTP 用户：${user}`);
      await command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64")}`, [235, 503]);
      log("SMTP 认证成功。");
    }

    log(`正在设置发件人：${from}`);
    await command(`MAIL FROM:<${from}>`, 250);
    log(`正在设置收件人：${to}`);
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
    log("正在提交邮件内容...");
    socket.write(`${message}\r\n.\r\n`);
    await expect(await readResponse(), 250, "DATA body");
    log("SMTP 服务器已接受邮件。");
    await command("QUIT", 221).catch(() => {});
  } finally {
    socket.end();
  }
}

const to = envValue("TEST_EMAIL_TO", "MOONSHADE_TEST_EMAIL_TO");
const subject = envValue("TEST_EMAIL_SUBJECT") || "MoonShade 邮件发送测试";
const text = envValue("TEST_EMAIL_TEXT") || `如果你收到这封邮件，说明 MoonShade 的 SMTP 配置已经可以正常发送邮件。\n\n时间：${new Date().toISOString()}`;

try {
  await sendSmtpMail({ to, subject, text });
  console.log(`邮件已发送到 ${to}。`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
