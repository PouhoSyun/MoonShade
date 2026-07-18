const adminKey = "moonshade.adminToken";
const state = {
  token: localStorage.getItem(adminKey) || "",
  email: "",
  sliderVerified: false,
  authCheckTimer: null,
  profiles: [],
  matches: [],
  announcements: [],
  settings: null,
  round: null,
  selectedProfileId: "",
  view: "dashboard"
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
  return ({ draft: "推送", published: "已推送", held: "暂缓" })[status] || status;
}

function formatDateTime(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function scheduleText(frequency) {
  if (!frequency) return "暂无";
  return formatDateOnly(frequency.expectedNextAllocationAt);
}

function frequencyText(frequency) {
  if (!frequency) return "暂无权重";
  const gap = frequency.daysSinceLastMatch === null || frequency.daysSinceLastMatch === undefined
    ? "暂无成功匹配"
    : `距上次 ${frequency.daysSinceLastMatch} 天`;
  return `${frequency.label} · 个人权重 ${frequency.personalWeight ?? frequency.priority ?? 0} · ${gap}`;
}

function studentIdFromEmail(email) {
  return String(email || "").match(/^(\d{10})@/)?.[1] || "-";
}

function formatWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function personalWeightValue(frequency) {
  return formatWeight(frequency?.personalWeight ?? frequency?.priority ?? 0);
}

function lastMatchText(frequency) {
  if (!frequency || frequency.daysSinceLastMatch === null || frequency.daysSinceLastMatch === undefined) return "暂无";
  return `${frequency.daysSinceLastMatch}天前`;
}

function weightText(frequency) {
  if (!frequency) return "完整 0 / 精确 0 / 空窗 0 / 性别 0 / 稀缺 0 / 个人 0";
  const clarityPercent = Number.isFinite(Number(frequency.clarityRatio)) ? Math.round(Number(frequency.clarityRatio) * 100) : 0;
  return `完整 ${formatWeight(frequency.completenessCoefficient)} · 精确 ${formatWeight(frequency.precisionCoefficient)} · 空窗 ${formatWeight(frequency.gapCoefficient)} · 性别 ${formatWeight(frequency.genderRatioCoefficient)} · 稀缺 ${formatWeight(frequency.scarcityCoefficient)} · 个人 ${personalWeightValue(frequency)} · 精准 ${clarityPercent}% · 性别序 ${frequency.genderRank || "-"}`;
}

function renderBoundaryWarnings(warnings = []) {
  if (!warnings.length) return `<div class="match-boundary-ok">所有可接受范围未发现不符合项</div>`;
  const visible = warnings.slice(0, 2);
  const rest = warnings.length - visible.length;
  return `
    <div class="match-boundary-warnings">
      ${visible.map(item => `
        <span>
          <strong>${escapeHtml(item.strict ? "严格" : "软性")}</strong>
          ${escapeHtml(item.label)}：${escapeHtml(item.message)}
        </span>
      `).join("")}
      ${rest > 0 ? `<span>另有 ${rest} 项不符合，进入详情可逐项核对。</span>` : ""}
    </div>
  `;
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
  const [profilesPayload, matchesPayload, settingsPayload, announcementsPayload] = await Promise.all([
    api(`/api/admin/profiles?adminToken=${encodeURIComponent(state.token)}`),
    api(`/api/admin/matches?adminToken=${encodeURIComponent(state.token)}`),
    api(`/api/admin/settings?adminToken=${encodeURIComponent(state.token)}`),
    api(`/api/admin/announcements?adminToken=${encodeURIComponent(state.token)}`)
  ]);
  state.profiles = profilesPayload.profiles;
  state.matches = matchesPayload.matches;
  state.announcements = announcementsPayload.announcements || [];
  state.settings = settingsPayload.settings;
  state.round = settingsPayload.round;
  if (!state.selectedProfileId && state.profiles.length) state.selectedProfileId = state.profiles[0].id;
  $("[data-admin-login]").hidden = true;
  $("[data-admin-console]").hidden = false;
  renderSettings();
  renderAdminView();
}

function candidateMatches() {
  return state.matches.filter(match => match.status !== "published");
}

function publishedMatches() {
  return state.matches.filter(match => match.status === "published");
}

function renderAdminView() {
  const dashboard = $("[data-admin-dashboard]");
  const publishedPage = $("[data-published-page]");
  if (dashboard) dashboard.hidden = state.view !== "dashboard";
  if (publishedPage) publishedPage.hidden = state.view !== "published";
  renderProfiles();
  renderProfileDetail();
  renderMatches();
  renderPublishedMatches();
  renderAnnouncements();
}

function renderSettings() {
  if (!state.settings) return;
  $("[data-match-interval]").value = String(state.settings.matchIntervalDays || 3);
  $("[data-match-note-input]").value = state.settings.matchWindowNote || "";
  $("[data-admin-round-title]").textContent = state.round?.id || "本轮";
  $("[data-admin-profile-count]").textContent = String(state.profiles.length);
  $("[data-admin-match-count]").textContent = String(candidateMatches().length);
  $("[data-admin-interval]").textContent = String(state.settings.matchIntervalDays || 3);
  $("[data-admin-round-note]").textContent = state.round
    ? `${state.round.label}。每日按个人权重与交叉权重刷新候选，管理员选择推送或暂缓。`
    : "轮次信息加载中。";
}

function renderAnnouncements() {
  const target = $("[data-announcement-admin-list]");
  if (!target) return;
  if (!state.announcements.length) {
    target.innerHTML = `<p class="empty-state">暂无网站公告。</p>`;
    return;
  }
  target.innerHTML = state.announcements.map(item => `
    <article class="announcement-admin-item" data-announcement-id="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.body)}</p>
      </div>
      <div class="admin-inline-actions">
        <button class="table-action" type="button" data-edit-announcement="${escapeHtml(item.id)}">编辑</button>
        <button class="table-action danger-action" type="button" data-delete-announcement="${escapeHtml(item.id)}">删除</button>
      </div>
    </article>
  `).join("");
}

function resetAnnouncementForm() {
  $("[data-announcement-id]").value = "";
  $("[data-announcement-title]").value = "";
  $("[data-announcement-body]").value = "";
  $("[data-announcement-message]").textContent = "";
}

async function saveAnnouncement() {
  const message = $("[data-announcement-message]");
  message.textContent = "正在保存...";
  try {
    const payload = await api("/api/admin/announcements/save", {
      method: "POST",
      body: JSON.stringify({
        adminToken: state.token,
        announcement: {
          id: $("[data-announcement-id]").value,
          title: $("[data-announcement-title]").value,
          body: $("[data-announcement-body]").value
        }
      })
    });
    state.announcements = payload.announcements || [];
    renderAnnouncements();
    resetAnnouncementForm();
    message.textContent = "公告已保存。";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function deleteAnnouncement(id) {
  if (!confirm("确定删除这条公告吗？")) return;
  const payload = await api("/api/admin/announcements/delete", {
    method: "POST",
    body: JSON.stringify({ adminToken: state.token, id })
  });
  state.announcements = payload.announcements || [];
  renderAnnouncements();
  resetAnnouncementForm();
}

function renderProfiles() {
  const table = $("[data-profile-table]");
  table.innerHTML = `
    <thead><tr><th>学号</th><th>展示名</th><th>性别</th><th>个人权重</th><th>上次匹配</th><th>身份</th></tr></thead>
    <tbody>
      ${state.profiles.map(profile => `
        <tr class="${profile.id === state.selectedProfileId ? "is-selected" : ""}" data-view-profile="${escapeHtml(profile.id)}">
          <td>${escapeHtml(studentIdFromEmail(profile.email))}</td>
          <td>${escapeHtml(profile.displayName)}</td>
          <td>${escapeHtml(profile.gender)}</td>
          <td><span class="frequency-badge">${escapeHtml(personalWeightValue(profile.matchFrequency))}</span></td>
          <td>${escapeHtml(lastMatchText(profile.matchFrequency))}</td>
          <td>${escapeHtml(profile.identity)}</td>
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
      ["恋爱后交际圈边界", profile.socialBoundary],
      ["可接受对方交际圈边界", profile.idealSocialBoundary],
      ["饮食口味喜好", profile.dietaryPreferences],
      ["参考月生活开支", profile.monthlyExpense ? `${profile.monthlyExpense} 元/月` : ""],
      ["MBTI 四维", profile.mbtiMetrics],
      ["期待 MBTI 四维", profile.idealMbtiMetrics],
      ["自我气质量表", profile.selfMetrics],
      ["期待对方气质量表", profile.idealMetrics]
    ])}
    ${detailBlock("内外特征", [
      ["周末场景", profile.selfWeekends],
      ["希望对方喜欢", profile.idealWeekends],
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
    ${detailBlock("兴趣爱好", [
      ["体育", profile.sportsInterests],
      ["音乐", profile.musicInterests],
      ["电影", profile.movieInterests],
      ["旅行", profile.travelInterests],
      ["读书", profile.readingInterests],
      ["技术", profile.skillInterests],
      ["游戏", profile.gameInterests],
      ["其他", profile.otherInterests],
      ["未涉及到的爱好", profile.otherInterestText]
    ])}
    ${detailBlock("联系确认", [
      ["联系方式", `${profile.contactType || ""} ${profile.contactValue || ""}`],
      ["自我介绍", profile.selfIntro],
      ["授权参与", profile.consent ? "是" : "否"]
    ])}
    ${detailBlock("匹配权重", [
      ["权重标签", profile.matchFrequency?.label],
      ["完整度系数", formatWeight(profile.matchFrequency?.completenessCoefficient)],
      ["精确度系数", formatWeight(profile.matchFrequency?.precisionCoefficient)],
      ["空窗期系数", formatWeight(profile.matchFrequency?.gapCoefficient)],
      ["性别比例系数", formatWeight(profile.matchFrequency?.genderRatioCoefficient)],
      ["稀缺度系数", formatWeight(profile.matchFrequency?.scarcityCoefficient)],
      ["个人权重", personalWeightValue(profile.matchFrequency)],
      ["同性别排序", profile.matchFrequency?.genderRank],
      ["画像清晰度", profile.matchFrequency?.clarityRatio ? `${Math.round(profile.matchFrequency.clarityRatio * 100)}%（${profile.matchFrequency.clarityFilled}/${profile.matchFrequency.clarityTotal}）` : ""],
      ["问卷完整度", profile.matchFrequency?.completenessRatio ? `${Math.round(profile.matchFrequency.completenessRatio * 100)}%（${profile.matchFrequency.completenessFilled}/${profile.matchFrequency.completenessTotal}）` : ""],
      ["距上次成功匹配", profile.matchFrequency?.daysSinceLastMatch === null || profile.matchFrequency?.daysSinceLastMatch === undefined ? "暂无成功匹配" : `${profile.matchFrequency.daysSinceLastMatch} 天`],
      ["上次成功匹配时间", formatDateTime(profile.matchFrequency?.lastSuccessfulMatchAt)],
      ["预计下次分配时间", scheduleText(profile.matchFrequency)],
      ["判断依据", profile.matchFrequency?.reason]
    ])}
  `;
}

function profileOptions(selectedId) {
  return state.profiles.map(profile => `<option value="${profile.id}" ${profile.id === selectedId ? "selected" : ""}>${escapeHtml(profileLabel(profile))}</option>`).join("");
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function yearInRange(year, min, max) {
  if (!year) return false;
  const lower = Number.isInteger(min) ? min : 1900;
  const upper = Number.isInteger(max) ? max : 2100;
  return year >= Math.min(lower, upper) && year <= Math.max(lower, upper);
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && String(value ?? "") !== "" ? number : null;
}

function profileYear(profile) {
  return Number(profile.birthYear) || (profile.age ? new Date().getFullYear() - Number(profile.age) : null);
}

function locationAccepted(actualLocation, idealLocations) {
  const actual = asList(actualLocation);
  const ideal = asList(idealLocations);
  if (!actual.length || !ideal.length) return true;
  return actual.some(item => ideal.includes(item));
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

function acceptableHit(actualValue, acceptableValues) {
  const actual = asList(actualValue);
  const acceptable = asList(acceptableValues);
  if (!actual.length || !acceptable.length || acceptable.includes("不限")) return true;
  return actual.some(item => acceptable.includes(item));
}

function firstVolumeCompatible(left, right) {
  return acceptableHit(right.identity || right.stage, left.idealIdentities)
    && acceptableHit(left.identity || left.stage, right.idealIdentities)
    && acceptableHit(right.schoolType, left.idealSchoolTypes)
    && acceptableHit(left.schoolType, right.idealSchoolTypes)
    && acceptableHit(regionForProvince(right.hometownProvince), left.idealHometownRegions)
    && acceptableHit(regionForProvince(left.hometownProvince), right.idealHometownRegions)
    && acceptableHit(right.homeArea, left.idealHomeAreas)
    && acceptableHit(left.homeArea, right.idealHomeAreas)
    && acceptableHit(right.discipline || right.department, left.idealDisciplines)
    && acceptableHit(left.discipline || left.department, right.idealDisciplines);
}

function hardCompatible(left, right) {
  if (!left || !right || left.id === right.id) return false;
  const leftSeeking = asList(left.seeking);
  const rightSeeking = asList(right.seeking);
  const genderOk = (leftSeeking.includes("不限") || leftSeeking.includes(right.gender))
    && (rightSeeking.includes("不限") || rightSeeking.includes(left.gender));
  const leftYear = profileYear(left);
  const rightYear = profileYear(right);
  const leftMin = integerOrNull(left.idealBirthYearMin);
  const leftMax = integerOrNull(left.idealBirthYearMax);
  const rightMin = integerOrNull(right.idealBirthYearMin);
  const rightMax = integerOrNull(right.idealBirthYearMax);
  const leftHasRange = Number.isInteger(leftMin) || Number.isInteger(leftMax);
  const rightHasRange = Number.isInteger(rightMin) || Number.isInteger(rightMax);
  const ageOk = (!leftHasRange || !rightYear || yearInRange(rightYear, leftMin, leftMax))
    && (!rightHasRange || !leftYear || yearInRange(leftYear, rightMin, rightMax));
  const locationOk = locationAccepted(right.location || right.city, left.idealLocations)
    && locationAccepted(left.location || left.city, right.idealLocations);
  return genderOk && ageOk && locationOk && firstVolumeCompatible(left, right);
}

function compatibleProfileOptions(selectedId, counterpartId) {
  const counterpart = state.profiles.find(profile => profile.id === counterpartId);
  return state.profiles
    .filter(profile => !counterpart || hardCompatible(profile, counterpart))
    .map(profile => `<option value="${profile.id}" ${profile.id === selectedId ? "selected" : ""}>${escapeHtml(profileLabel(profile))}</option>`)
    .join("");
}

function renderMatchDiagnostics(match) {
  const reasons = (match.reasons || []).slice(0, 3);
  const hiddenReasonCount = Math.max(0, (match.reasons || []).length - reasons.length);
  return `
    <div class="match-diagnostics" data-match-diagnostics>
      <p>${reasons.map(reason => `· ${escapeHtml(reason)}`).join("<br>")}${hiddenReasonCount ? `<br>· 另有 ${hiddenReasonCount} 条参考依据` : ""}</p>
      ${renderBoundaryWarnings(match.boundaryWarnings)}
      <div class="match-frequency-notes">
        ${match.left?.matchFrequency ? `<span>${escapeHtml(match.left.displayName)}：个人 ${escapeHtml(personalWeightValue(match.left.matchFrequency))}</span>` : ""}
        ${match.right?.matchFrequency ? `<span>${escapeHtml(match.right.displayName)}：个人 ${escapeHtml(personalWeightValue(match.right.matchFrequency))}</span>` : ""}
        <span>个人乘积 ${escapeHtml(formatWeight(match.personalWeight))}</span>
        <span>布尔门槛 ${escapeHtml(formatWeight(match.booleanGate ?? match.weightBreakdown?.booleanGate ?? 1))}</span>
        <span>取向权重 ${escapeHtml(formatWeight(match.orientationWeight ?? match.weightBreakdown?.orientationWeight ?? 1))}</span>
        <span>交叉权重 ${escapeHtml(formatWeight(match.crossWeight ?? match.score))}</span>
        ${match.weightBreakdown ? `<span>重复降权系数：${escapeHtml(formatWeight(match.weightBreakdown.repeatFactor ?? 1))}</span>` : ""}
      </div>
    </div>
  `;
}

function updateSelectOptions(select, selectedId, counterpartId) {
  select.innerHTML = compatibleProfileOptions(selectedId, counterpartId);
  if (Array.from(select.options).some(option => option.value === selectedId)) {
    select.value = selectedId;
  } else if (select.options.length) {
    select.value = select.options[0].value;
  }
}

async function previewMatch(card) {
  const leftSelect = card.querySelector("[data-left-id]");
  const rightSelect = card.querySelector("[data-right-id]");
  updateSelectOptions(leftSelect, leftSelect.value, rightSelect.value);
  updateSelectOptions(rightSelect, rightSelect.value, leftSelect.value);
  const leftId = leftSelect.value;
  const rightId = rightSelect.value;
  const diagnostics = card.querySelector("[data-match-diagnostics]");
  if (diagnostics) diagnostics.innerHTML = `<p>正在刷新权重...</p>`;
  try {
    const payload = await api("/api/admin/matches/preview", {
      method: "POST",
      body: JSON.stringify({
        adminToken: state.token,
        leftId,
        rightId
      })
    });
    const preview = payload.preview;
    card.querySelector(".match-admin-head strong").textContent = `最终权重 ${formatWeight(preview.adjustedScore ?? preview.weightBreakdown?.finalWeight ?? preview.score)}`;
    card.querySelector(".match-admin-head small").textContent = `交叉 ${formatWeight(preview.crossWeight ?? preview.score)} · 个人乘积 ${formatWeight(preview.personalWeight)} · 布尔 ${formatWeight(preview.booleanGate)} · 取向 ${formatWeight(preview.orientationWeight)}`;
    if (diagnostics) diagnostics.outerHTML = renderMatchDiagnostics(preview);
  } catch (error) {
    if (diagnostics) diagnostics.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function renderMatches() {
  const editor = $("[data-match-editor]");
  const matches = candidateMatches();
  if (!matches.length) {
    editor.innerHTML = `<p class="empty-state">今天还没有可用候选匹配。人数不足或性别/偏好边界不兼容时可能为空。</p>`;
    return;
  }
  editor.innerHTML = matches.map(match => `
    <article class="admin-match" data-match-id="${match.id}">
      <div class="match-admin-head">
        <strong>最终权重 ${escapeHtml(formatWeight(match.adjustedScore ?? match.weightBreakdown?.finalWeight ?? match.score))}</strong>
        <small>交叉 ${escapeHtml(formatWeight(match.crossWeight ?? match.score))} · 个人乘积 ${escapeHtml(formatWeight(match.personalWeight))} · 布尔 ${escapeHtml(formatWeight(match.booleanGate ?? match.weightBreakdown?.booleanGate ?? 1))} · 取向 ${escapeHtml(formatWeight(match.orientationWeight ?? match.weightBreakdown?.orientationWeight ?? 1))}</small>
        <span>${escapeHtml(statusLabel(match.status))}</span>
        ${match.generatedFor ? `<em>${escapeHtml(match.generatedFor)}</em>` : (match.batchId ? `<em>${escapeHtml(match.batchId)}</em>` : "")}
      </div>
      <label>Moon
        <select data-left-id>${compatibleProfileOptions(match.leftId, match.rightId)}</select>
      </label>
      <label>Shade
        <select data-right-id>${compatibleProfileOptions(match.rightId, match.leftId)}</select>
      </label>
      <label>状态
        <select data-status>
          ${["draft", "held"].map(status => `<option value="${status}" ${match.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
        </select>
      </label>
      <label>备注
        <textarea data-notes rows="2">${escapeHtml(match.notes || "")}</textarea>
      </label>
      ${renderMatchDiagnostics(match)}
      <button class="secondary-action" data-save-match>保存调整</button>
    </article>
  `).join("");
}

function renderPublishedMatches() {
  const target = $("[data-published-match-list]");
  if (!target) return;
  const matches = publishedMatches();
  if (!matches.length) {
    target.innerHTML = `<p class="empty-state">还没有已发布匹配。</p>`;
    return;
  }
  target.innerHTML = matches.map(match => `
    <article class="admin-match published-match" data-match-id="${match.id}">
      <div class="match-admin-head">
        <strong>${escapeHtml(match.left?.displayName || "Moon")} × ${escapeHtml(match.right?.displayName || "Shade")}</strong>
        <small>最终权重 ${escapeHtml(formatWeight(match.adjustedScore ?? match.weightBreakdown?.finalWeight ?? match.score))} · 交叉 ${escapeHtml(formatWeight(match.crossWeight ?? match.score))} · ${escapeHtml(formatDateTime(match.publishedAt || match.updatedAt))}</small>
        <span>${escapeHtml(statusLabel(match.status))}</span>
      </div>
      <label>Moon
        <select data-left-id>${compatibleProfileOptions(match.leftId, match.rightId)}</select>
      </label>
      <label>Shade
        <select data-right-id>${compatibleProfileOptions(match.rightId, match.leftId)}</select>
      </label>
      <label>状态
        <select data-status>
          ${["published", "held"].map(status => `<option value="${status}" ${match.status === status ? "selected" : ""}>${status === "published" ? "推送" : statusLabel(status)}</option>`).join("")}
        </select>
      </label>
      <label>备注
        <textarea data-notes rows="2">${escapeHtml(match.notes || "")}</textarea>
      </label>
      ${renderMatchDiagnostics(match)}
      <button class="secondary-action" data-save-match>保存调整</button>
    </article>
  `).join("");
}

async function publishMatches() {
  await api("/api/admin/matches/publish", { method: "POST", body: JSON.stringify({ adminToken: state.token }) });
  await loadAdmin();
}

async function seedDemoUsers() {
  await api("/api/admin/demo-users", { method: "POST", body: JSON.stringify({ adminToken: state.token }) });
  await loadAdmin();
}

async function deleteDemoUsers() {
  if (!confirm("确定删除所有测试用户及其相关匹配记录吗？")) return;
  await api("/api/admin/demo-users/delete", { method: "POST", body: JSON.stringify({ adminToken: state.token }) });
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
  const nextStatus = card.querySelector("[data-status]").value;
  await api("/api/admin/matches/update", {
    method: "POST",
    body: JSON.stringify({
      adminToken: state.token,
      matchId: card.dataset.matchId,
      leftId: card.querySelector("[data-left-id]").value,
      rightId: card.querySelector("[data-right-id]").value,
      status: nextStatus,
      notes: card.querySelector("[data-notes]").value
    })
  });
  if (nextStatus === "held") state.view = "dashboard";
  await loadAdmin();
}

bindAdminSliderVerify();
bindAdminAuthReset();
$("[data-admin-login-button]").addEventListener("click", login);
$("[data-admin-logout]").addEventListener("click", logout);
$("[data-refresh-admin]").addEventListener("click", loadAdmin);
$("[data-publish-matches]").addEventListener("click", publishMatches);
$("[data-seed-demo-users]").addEventListener("click", seedDemoUsers);
$("[data-delete-demo-users]").addEventListener("click", deleteDemoUsers);
$("[data-save-settings]").addEventListener("click", saveSettings);
$("[data-save-announcement]").addEventListener("click", saveAnnouncement);
$("[data-new-announcement]").addEventListener("click", resetAnnouncementForm);
document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-admin-view]");
  if (viewButton) {
    state.view = viewButton.dataset.adminView;
    renderAdminView();
    return;
  }
  const profileButton = event.target.closest("[data-view-profile]");
  if (profileButton) {
    state.selectedProfileId = profileButton.dataset.viewProfile;
    renderProfiles();
    renderProfileDetail();
    return;
  }
  const editAnnouncement = event.target.closest("[data-edit-announcement]");
  if (editAnnouncement) {
    const item = state.announcements.find(announcement => announcement.id === editAnnouncement.dataset.editAnnouncement);
    if (item) {
      $("[data-announcement-id]").value = item.id;
      $("[data-announcement-title]").value = item.title || "";
      $("[data-announcement-body]").value = item.body || "";
      $("[data-announcement-message]").textContent = "正在编辑已有公告。";
    }
    return;
  }
  const deleteAnnouncementButton = event.target.closest("[data-delete-announcement]");
  if (deleteAnnouncementButton) {
    deleteAnnouncement(deleteAnnouncementButton.dataset.deleteAnnouncement);
    return;
  }
  const button = event.target.closest("[data-save-match]");
  if (button) saveMatch(button.closest("[data-match-id]"));
});
document.addEventListener("change", event => {
  const select = event.target.closest("[data-left-id], [data-right-id]");
  if (!select) return;
  previewMatch(select.closest("[data-match-id]"));
});

loadAdmin().catch(() => {
  localStorage.removeItem(adminKey);
  state.token = "";
});
