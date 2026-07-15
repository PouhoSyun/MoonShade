const adminKey = "moonshade.adminToken";
const state = {
  token: localStorage.getItem(adminKey) || "",
  email: "",
  sliderVerified: false,
  authCheckTimer: null,
  profiles: [],
  matches: [],
  settings: null,
  round: null,
  selectedProfileId: ""
};

const $ = selector => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function profileLabel(profile) {
  return [profile.displayName, profile.email, profile.gender, formatValue(profile.location), profile.discipline].filter(Boolean).join(" · ");
}

function formatValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined && item !== "")
      .map(([key, item]) => `${key}:${Array.isArray(item) ? item.join("/") : item}`)
      .join("、");
  }
  return value ?? "";
}

function detailBlock(title, items) {
  return `
    <section class="detail-block">
      <h3>${escapeHtml(title)}</h3>
      <dl>
        ${items.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(formatValue(value) || "未填写")}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function statusLabel(status) {
  return ({ draft: "待审核", published: "已发布", held: "暂缓" })[status] || status;
}

function frequencyText(frequency) {
  if (!frequency) return "标准频率";
  const gap = frequency.daysSinceLastMatch === null || frequency.daysSinceLastMatch === undefined
    ? "暂无成功匹配"
    : `距上次 ${frequency.daysSinceLastMatch} 天`;
  return `${frequency.label} · ${gap}`;
}

function appendAdminLog(message) {
  const log = $("[data-admin-local-log]");
  if (!log) return;
  log.hidden = false;
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  log.innerHTML = `<p><strong>${time}</strong> ${escapeHtml(message)}</p>` + log.innerHTML;
}

async function checkAdminEmailAfterSlide() {
  const email = $("[data-admin-email]").value.trim();
  const message = $("[data-admin-message]");
  if (!state.sliderVerified) {
    message.textContent = "请先完成滑动安全验证。";
    return;
  }
  if (!email) {
    message.textContent = "请输入管理员邮箱。";
    return;
  }
  message.textContent = "正在检查管理员账号...";
  try {
    const result = await api("/api/auth/check-email", { method: "POST", body: JSON.stringify({ email, sliderPassed: true }) });
    state.email = result.email;
    if (!result.exists) {
      $("[data-admin-password-mode]").hidden = true;
      message.textContent = "该邮箱尚未注册，管理员后台只允许已存在的管理员账号登录。";
      appendAdminLog(`未检测到账号：${result.email}`);
      return;
    }
    $("[data-admin-password-mode]").hidden = false;
    message.textContent = "账号已存在，请输入管理员密码。";
    appendAdminLog(`已检测到账号：${result.email}`);
    $("[data-admin-password]").focus();
  } catch (error) {
    $("[data-admin-password-mode]").hidden = true;
    message.textContent = error.message;
    appendAdminLog(error.message);
  }
}

async function login() {
  const email = $("[data-admin-email]").value.trim();
  const password = $("[data-admin-password]").value;
  const message = $("[data-admin-message]");
  message.textContent = "正在登录...";
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (result.role !== "admin" || !result.adminToken) throw new Error("该账号没有管理员权限。");
    state.token = result.adminToken;
    localStorage.setItem(adminKey, result.adminToken);
    message.textContent = "";
    appendAdminLog(`管理员登录成功：${result.email}`);
    await loadAdmin();
  } catch (error) {
    message.textContent = error.message;
    appendAdminLog(error.message);
  }
}

function bindAdminSliderVerify() {
  const root = $("[data-admin-slide-verify]");
  const handle = $("[data-admin-slide-handle]");
  const fill = $("[data-admin-slide-fill]");
  const label = $("[data-admin-slide-label]");
  let dragging = false;
  let startX = 0;
  let max = 0;

  function complete() {
    max = root.querySelector(".slide-track").clientWidth - handle.clientWidth - 4;
    state.sliderVerified = true;
    root.classList.add("is-complete");
    handle.style.transform = `translateX(${Math.max(0, max)}px)`;
    fill.style.width = `${Math.max(46, max + 46)}px`;
    label.textContent = "验证完成，正在检查账号";
    dragging = false;
    checkAdminEmailAfterSlide();
  }

  function setProgress(value) {
    const clamped = Math.max(0, Math.min(max, value));
    const percent = max ? clamped / max : 0;
    handle.style.transform = `translateX(${clamped}px)`;
    fill.style.width = `${Math.max(46, clamped + 46)}px`;
    if (percent > 0.98) {
      complete();
    }
  }

  root.addEventListener("click", () => {
    if (!state.sliderVerified) complete();
  });
  handle.addEventListener("pointerdown", event => {
    if (state.sliderVerified) return;
    dragging = true;
    startX = event.clientX;
    max = root.querySelector(".slide-track").clientWidth - handle.clientWidth - 4;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!dragging || state.sliderVerified) return;
    setProgress(event.clientX - startX);
  });
  handle.addEventListener("pointerup", () => {
    if (!dragging || state.sliderVerified) return;
    dragging = false;
    handle.style.transform = "translateX(0)";
    fill.style.width = "46px";
  });
}

function bindAdminAuthReset() {
  $("[data-admin-email]").addEventListener("input", () => {
    $("[data-admin-password-mode]").hidden = true;
    if (state.sliderVerified) {
      clearTimeout(state.authCheckTimer);
      $("[data-admin-message]").textContent = "邮箱变更，正在重新检查...";
      state.authCheckTimer = setTimeout(checkAdminEmailAfterSlide, 450);
    } else {
      $("[data-admin-message]").textContent = "输入管理员邮箱，完成滑动验证后自动检查账号。";
    }
  });
  $("[data-admin-password]").addEventListener("keydown", event => {
    if (event.key === "Enter") login();
  });
}

function logout() {
  localStorage.removeItem(adminKey);
  localStorage.removeItem("moonshade.authToken");
  localStorage.removeItem("moonshade.token");
  state.token = "";
  window.location.reload();
}

async function loadAdmin() {
  if (!state.token) return;
  const [profilesPayload, matchesPayload, settingsPayload] = await Promise.all([
    api(`/api/admin/profiles?adminToken=${encodeURIComponent(state.token)}`),
    api(`/api/admin/matches?adminToken=${encodeURIComponent(state.token)}`),
    api(`/api/admin/settings?adminToken=${encodeURIComponent(state.token)}`)
  ]);
  state.profiles = profilesPayload.profiles;
  state.matches = matchesPayload.matches;
  state.settings = settingsPayload.settings;
  state.round = settingsPayload.round;
  if (!state.selectedProfileId && state.profiles.length) state.selectedProfileId = state.profiles[0].id;
  $("[data-admin-login]").hidden = true;
  $("[data-admin-console]").hidden = false;
  renderSettings();
  renderProfiles();
  renderProfileDetail();
  renderMatches();
}

function renderSettings() {
  if (!state.settings) return;
  $("[data-match-interval]").value = String(state.settings.matchIntervalDays || 3);
  $("[data-match-note-input]").value = state.settings.matchWindowNote || "";
  $("[data-admin-round-title]").textContent = state.round?.id || "本轮";
  $("[data-admin-profile-count]").textContent = String(state.profiles.length);
  $("[data-admin-match-count]").textContent = String(state.matches.length);
  $("[data-admin-interval]").textContent = String(state.settings.matchIntervalDays || 3);
  $("[data-admin-round-note]").textContent = state.round
    ? `${state.round.label}，原则上每 ${state.settings.matchIntervalDays} 天生成一次候选匹配。`
    : "轮次信息加载中。";
}

function renderProfiles() {
  const table = $("[data-profile-table]");
  table.innerHTML = `
    <thead><tr><th>查看</th><th>邮箱</th><th>展示名</th><th>性别</th><th>频率</th><th>身份</th><th>校区</th><th>方向</th><th>期待</th><th>更新时间</th></tr></thead>
    <tbody>
      ${state.profiles.map(profile => `
        <tr class="${profile.id === state.selectedProfileId ? "is-selected" : ""}">
          <td><button class="table-action" type="button" data-view-profile="${escapeHtml(profile.id)}">查看</button></td>
          <td>${escapeHtml(profile.email)}</td>
          <td>${escapeHtml(profile.displayName)}</td>
          <td>${escapeHtml(profile.gender)}</td>
          <td><span class="frequency-badge">${escapeHtml(frequencyText(profile.matchFrequency))}</span></td>
          <td>${escapeHtml(profile.identity)}</td>
          <td>${escapeHtml(formatValue(profile.location))}</td>
          <td>${escapeHtml(profile.discipline)}</td>
          <td>${escapeHtml(profile.intent)}</td>
          <td>${escapeHtml(profile.updatedAt ? new Date(profile.updatedAt).toLocaleString("zh-CN") : "")}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderProfileDetail() {
  const target = $("[data-profile-detail]");
  const profile = state.profiles.find(item => item.id === state.selectedProfileId);
  if (!profile) {
    target.innerHTML = `<p class="empty-state">还没有提交的问卷。</p>`;
    return;
  }
  target.innerHTML = `
    <div class="profile-detail-head">
      <strong>${escapeHtml(profile.displayName || "未命名")}</strong>
      <span>${escapeHtml(profile.email)}</span>
    </div>
    ${detailBlock("基本信息", [
      ["性别", profile.gender],
      ["希望认识的性别", profile.seeking],
      ["出生年", profile.birthYear],
      ["可接受出生年", [profile.idealBirthYearMin || "不限", profile.idealBirthYearMax || "不限"].join(" - ")],
      ["身份", profile.identity],
      ["院校背景", profile.schoolType],
      ["所在校区", profile.location],
      ["可接受校区", profile.idealLocations],
      ["家乡省份", profile.hometownProvince],
      ["可接受家乡地区", profile.idealHometownRegions],
      ["成长环境", profile.homeArea],
      ["可接受成长环境", profile.idealHomeAreas],
      ["专业方向", profile.discipline],
      ["可接受专业方向", profile.idealDisciplines]
    ])}
    ${detailBlock("相处节奏", [
      ["匹配期待", profile.intent],
      ["希望对方的期待", profile.idealIntent],
      ["沟通节奏", profile.tempo],
      ["可接受沟通节奏", profile.idealTempo],
      ["亲密关系接受程度", profile.intimacy],
      ["可接受亲密边界", profile.idealIntimacy],
      ["亲密关系发生时间", profile.intimacyTiming],
      ["可接受发生时间", profile.idealIntimacyTiming],
      ["MBTI 四维", profile.mbtiMetrics],
      ["期待 MBTI 四维", profile.idealMbtiMetrics],
      ["自我气质量表", profile.selfMetrics],
      ["期待对方气质量表", profile.idealMetrics]
    ])}
    ${detailBlock("内外特征", [
      ["周末场景", profile.selfWeekends],
      ["希望对方喜欢", profile.idealWeekends],
      ["关系里会带来的东西", profile.selfValues],
      ["希望对方重视", profile.idealValues],
      ["穿着气质", profile.selfStyle],
      ["吸引自己的穿着气质", profile.idealStyle],
      ["身高", profile.height ? `${profile.height} cm` : ""],
      ["理想伴侣身高", profile.idealHeight ? `${profile.idealHeight} cm` : ""],
      ["外在年龄感", profile.appearanceFeel],
      ["可接受年龄感", profile.idealAppearanceFeel],
      ["头发长度", profile.hair],
      ["可接受头发长度", profile.idealHair],
      ["眼镜状态", profile.glasses],
      ["可接受眼镜状态", profile.idealGlasses]
    ])}
    ${detailBlock("联系确认", [
      ["联系方式", `${profile.contactType || ""} ${profile.contactValue || ""}`],
      ["自我介绍", profile.selfIntro],
      ["授权参与", profile.consent ? "是" : "否"]
    ])}
    ${detailBlock("匹配频率", [
      ["频率标签", profile.matchFrequency?.label],
      ["建议间隔", profile.matchFrequency?.intervalDays ? `${profile.matchFrequency.intervalDays} 天` : ""],
      ["距上次成功匹配", profile.matchFrequency?.daysSinceLastMatch === null || profile.matchFrequency?.daysSinceLastMatch === undefined ? "暂无成功匹配" : `${profile.matchFrequency.daysSinceLastMatch} 天`],
      ["判断依据", profile.matchFrequency?.reason]
    ])}
  `;
}

function profileOptions(selectedId) {
  return state.profiles.map(profile => `<option value="${profile.id}" ${profile.id === selectedId ? "selected" : ""}>${escapeHtml(profileLabel(profile))}</option>`).join("");
}

function renderMatches() {
  const editor = $("[data-match-editor]");
  if (!state.matches.length) {
    editor.innerHTML = `<p class="empty-state">还没有生成本轮匹配。</p>`;
    return;
  }
  editor.innerHTML = state.matches.map(match => `
    <article class="admin-match" data-match-id="${match.id}">
      <div class="match-admin-head">
        <strong>${escapeHtml(match.score)} 分</strong>
        ${match.adjustedScore ? `<small>调度分 ${escapeHtml(match.adjustedScore)}</small>` : ""}
        <span>${escapeHtml(statusLabel(match.status))}</span>
        ${match.batchId ? `<em>${escapeHtml(match.batchId)}</em>` : ""}
      </div>
      <label>Moon
        <select data-left-id>${profileOptions(match.leftId)}</select>
      </label>
      <label>Shade
        <select data-right-id>${profileOptions(match.rightId)}</select>
      </label>
      <label>状态
        <select data-status>
          ${["draft", "published", "held"].map(status => `<option value="${status}" ${match.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
        </select>
      </label>
      <label>备注
        <textarea data-notes rows="2">${escapeHtml(match.notes || "")}</textarea>
      </label>
      <p>${(match.reasons || []).map(reason => `· ${escapeHtml(reason)}`).join("<br>")}</p>
      <div class="match-frequency-notes">
        ${match.left?.matchFrequency ? `<span>${escapeHtml(match.left.displayName)}：${escapeHtml(frequencyText(match.left.matchFrequency))}</span>` : ""}
        ${match.right?.matchFrequency ? `<span>${escapeHtml(match.right.displayName)}：${escapeHtml(frequencyText(match.right.matchFrequency))}</span>` : ""}
      </div>
      <button class="secondary-action" data-save-match>保存调整</button>
    </article>
  `).join("");
}

async function generateMatches() {
  await api("/api/admin/matches/generate", { method: "POST", body: JSON.stringify({ adminToken: state.token }) });
  await loadAdmin();
}

async function publishMatches() {
  await api("/api/admin/matches/publish", { method: "POST", body: JSON.stringify({ adminToken: state.token }) });
  await loadAdmin();
}

async function seedDemoUsers() {
  await api("/api/admin/demo-users", { method: "POST", body: JSON.stringify({ adminToken: state.token }) });
  await loadAdmin();
}

async function saveSettings() {
  const message = $("[data-settings-message]");
  message.textContent = "正在保存...";
  try {
    const payload = await api("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        adminToken: state.token,
        settings: {
          matchIntervalDays: $("[data-match-interval]").value,
          matchWindowNote: $("[data-match-note-input]").value
        }
      })
    });
    state.settings = payload.settings;
    state.round = payload.round;
    renderSettings();
    message.textContent = "设置已保存。";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function saveMatch(card) {
  await api("/api/admin/matches/update", {
    method: "POST",
    body: JSON.stringify({
      adminToken: state.token,
      matchId: card.dataset.matchId,
      leftId: card.querySelector("[data-left-id]").value,
      rightId: card.querySelector("[data-right-id]").value,
      status: card.querySelector("[data-status]").value,
      notes: card.querySelector("[data-notes]").value
    })
  });
  await loadAdmin();
}

bindAdminSliderVerify();
bindAdminAuthReset();
$("[data-admin-login-button]").addEventListener("click", login);
$("[data-admin-logout]").addEventListener("click", logout);
$("[data-refresh-admin]").addEventListener("click", loadAdmin);
$("[data-generate-matches]").addEventListener("click", generateMatches);
$("[data-publish-matches]").addEventListener("click", publishMatches);
$("[data-seed-demo-users]").addEventListener("click", seedDemoUsers);
$("[data-save-settings]").addEventListener("click", saveSettings);
document.addEventListener("click", event => {
  const profileButton = event.target.closest("[data-view-profile]");
  if (profileButton) {
    state.selectedProfileId = profileButton.dataset.viewProfile;
    renderProfiles();
    renderProfileDetail();
    return;
  }
  const button = event.target.closest("[data-save-match]");
  if (button) saveMatch(button.closest("[data-match-id]"));
});

loadAdmin().catch(() => {
  localStorage.removeItem(adminKey);
  state.token = "";
});
