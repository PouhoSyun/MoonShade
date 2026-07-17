const tokenKey = "moonshade.token";
const authKey = "moonshade.authToken";
window.__MOONSHADE_APP_VERSION__ = "20260716-hero-logo";

const optionSets = {
  genders: ["女", "男", "非二元", "暂不透露"],
  seeking: ["女", "男", "非二元", "不限"],
  years: Array.from({ length: 21 }, (_, index) => String(1990 + index)),
  identities: ["本科生", "硕士生", "博士生", "毕业工作", "自由探索"],
  schoolTypes: ["北京大学"],
  locations: ["燕园", "马池口", "学院路", "大兴", "万柳", "西山口", "统军庄", "人民医院", "第一医院", "第三医院", "第六医院", "国际医院", "深圳", "牛津", "校外"],
  provinces: ["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "香港", "澳门", "台湾", "海外"],
  regions: ["华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台"],
  homeAreas: ["直辖市/省会/首府/计划单列市", "地级市/州府/公署驻地", "其他城市化地区", "乡村", "流动成长"],
  disciplines: ["理学", "工学", "人文", "社科", "医学", "经管", "艺术体育", "其他"],
  intents: ["快速转进", "认真发展", "先交朋友", "慢慢了解"],
  tempos: ["高频交流", "日常分享", "低频稳定", "线下优先"],
  intimacy: ["开放态度", "关系决定", "暂无打算", "柏拉图式"],
  intimacyTiming: ["不接受", "婚后", "关系稳定后", "相熟数月后", "可以自然发生"],
  weekends: ["外出旅行", "散步游览", "朋友聚会", "运动户外", "自习工作", "做饭探店", "球番剧竞"],
  dietaryPreferences: ["喜辣", "喜甜", "喜咸", "清淡", "清真"],
  values: ["坦诚表达", "边界清晰", "共同成长", "情绪稳定", "生活有序", "保持好奇"],
  styles: ["清冷", "学院", "运动", "中式", "正式", "随性"],
  hair: ["短发", "中长发", "长发", "不设偏好"],
  glasses: ["常戴", "偶尔戴", "基本不戴", "不设偏好"],
  appearanceFeel: ["成熟", "同龄", "少年", "不明显", "不设偏好"],
  sportsInterests: ["徒步", "跑步", "攀岩", "自行车", "足球", "篮球", "排球", "羽毛球", "乒乓球", "台球", "棒垒球", "壁球", "地板球", "网球", "游泳", "潜水", "冲浪", "赛艇", "桨板", "滑雪", "滑冰", "轮滑", "花滑", "体操", "舞蹈", "武术", "健身健美", "拳击", "瑜伽", "登山", "射箭", "定向", "养生", "太极拳", "围棋", "中国象棋", "国际象棋", "电竞"],
  musicInterests: ["流行", "摇滚", "古典", "爵士", "民谣", "说唱", "电音", "国风", "纯音乐", "小语种"],
  movieInterests: ["科幻", "悬疑", "动作", "剧情", "文艺", "喜剧", "恐怖", "纪录", "动漫", "华语", "欧美", "日韩", "港台", "小众"],
  travelInterests: ["自由行", "度假", "自驾游", "一人行", "骑游", "户外", "特种兵", "穷游", "旅居", "跟团", "露营", "京郊", "国内", "海岸", "山水", "都市", "文保", "荒野", "境外", "环球"],
  readingInterests: ["小说", "散文", "诗歌", "纪实", "哲学", "心理", "财经", "艺术", "语言", "社会", "技术"],
  skillInterests: ["驾驶", "摄影", "平面设计", "剪辑", "绘画", "声乐", "钢琴", "管弦乐", "打击乐", "书法", "写作", "演讲", "辩论", "编程", "硬件", "模玩", "手作", "烹饪", "甜品", "养宠", "绿植", "外语", "方言", "编织", "音乐制作", "数字艺术"],
  gameInterests: ["竞技", "射击", "策略", "沙盒", "角色扮演", "乙游", "休闲", "经营", "塔防", "页游", "手游", "端游", "主机", "桌游", "密室", "剧本杀"],
  otherInterests: ["美妆", "穿搭", "探店", "收纳", "冥想", "同人", "追星", "木工", "陶艺", "无人机"]
};

const scaleQuestions = [
  { key: "warmth", title: "相处时，我更靠近", left: "冷静高效", right: "真诚温暖" },
  { key: "ambition", title: "面对学业或事业，我更像", left: "顺其自然", right: "持续进取" },
  { key: "decision", title: "遇到问题和选择时，我更依赖", left: "直觉感受", right: "逻辑证据" },
  { key: "novelty", title: "日常选择里，我更常", left: "沿用熟悉方式", right: "尝试新鲜事物" },
  { key: "schedule", title: "我的作息节律更接近", left: "夜间活跃", right: "早起清醒" },
  { key: "marriage", title: "面对婚姻，我目前更接近", left: "不以婚姻为目标", right: "期待稳定婚姻" },
  { key: "fertility", title: "面对生育，我目前更接近", left: "不考虑生育", right: "期待养育孩子" }
];

const mbtiDimensions = [
  { key: "ei", left: "E 外向", right: "I 内向" },
  { key: "sn", left: "S 实感", right: "N 直觉" },
  { key: "tf", left: "T 思考", right: "F 情感" },
  { key: "jp", left: "J 计划", right: "P 弹性" }
];

const pages = [
  {
    title: "第一卷：基本信息",
    short: "基本信息",
    desc: "左栏选择可匹配的人群范围，右栏可多选划定可以接受的范围。",
    pairs: [
      [{ type: "input", name: "displayName", label: "展示名", placeholder: "例如：月影" }, null],
      [{ type: "chips", name: "gender", label: "我的性别", options: optionSets.genders }, { type: "chips", multi: true, name: "seeking", label: "希望认识的性别", options: optionSets.seeking }],
      [{ type: "select", name: "birthYear", label: "出生年", options: optionSets.years }, { type: "yearRange", name: "idealBirthYear", label: "可接受出生年区间", options: optionSets.years }],
      [{ type: "chips", name: "identity", label: "目前身份", options: optionSets.identities }, { type: "chips", multi: true, name: "idealIdentities", label: "可接受身份", options: optionSets.identities }],
      [{ type: "chips", name: "schoolType", label: "院校背景", options: optionSets.schoolTypes }, null],
      [{ type: "chips", multi: true, name: "location", label: "所在校区", options: optionSets.locations }, { type: "chips", multi: true, name: "idealLocations", label: "可接受校区", options: optionSets.locations }],
      [{ type: "select", name: "hometownProvince", label: "家乡省份", options: optionSets.provinces }, { type: "chips", multi: true, name: "idealHometownRegions", label: "可接受家乡地区", options: optionSets.regions }],
      [{ type: "chips", name: "homeArea", label: "城市 / 乡村", options: optionSets.homeAreas }, { type: "chips", multi: true, name: "idealHomeAreas", label: "可接受成长环境", options: optionSets.homeAreas }],
      [{ type: "chips", name: "discipline", label: "专业方向", options: optionSets.disciplines }, { type: "chips", multi: true, name: "idealDisciplines", label: "可接受专业方向", options: optionSets.disciplines }]
    ]
  },
  {
    title: "第二卷：相处节奏",
    short: "相处节奏",
    desc: "左栏选择自己更符合的描述，右栏选择期待对方更靠近哪一侧。已提交过问卷的用户请补充更新后的亲密关系、婚姻和生育意向。",
    pairs: [
      [{ type: "chips", name: "intent", label: "这次更期待", options: optionSets.intents }, { type: "chips", multi: true, name: "idealIntent", label: "希望对方的期待", options: optionSets.intents }],
      [{ type: "chips", name: "tempo", label: "舒服的沟通节奏", options: optionSets.tempos }, { type: "chips", multi: true, name: "idealTempo", label: "可接受沟通节奏", options: optionSets.tempos }],
      [{ type: "chips", name: "intimacy", label: "恋爱接受程度", options: optionSets.intimacy }, { type: "chips", multi: true, name: "idealIntimacy", label: "希望对方的边界", options: optionSets.intimacy }],
      [{ type: "chips", name: "intimacyTiming", label: "对亲密关系态度", options: optionSets.intimacyTiming }, { type: "chips", multi: true, name: "idealIntimacyTiming", label: "可接受发生时间", options: optionSets.intimacyTiming }],
      [{ type: "mbtiSliders", name: "mbtiMetrics", label: "MBTI 四维倾向" }, { type: "mbtiSliders", name: "idealMbtiMetrics", label: "希望对方的 MBTI 倾向" }],
      ...scaleQuestions.map(item => [
        { ...item, type: "scale", name: `selfMetrics.${item.key}` },
        { ...item, type: "binaryScale", title: "期待对方的样子", name: `idealMetrics.${item.key}` }
      ])
    ]
  },
  {
    title: "第三卷：内外特征",
    short: "内外特征",
    desc: "左栏选择自己外观与内在的画像，右栏可多选划定可以接受的范围。",
    pairs: [
      [{ type: "chips", multi: true, name: "selfWeekends", label: "周末常出现的场景", options: optionSets.weekends }, { type: "chips", multi: true, name: "idealWeekends", label: "希望对方也喜欢", options: optionSets.weekends }],
      [{ type: "chips", multi: true, name: "dietaryPreferences", label: "饮食口味喜好", options: optionSets.dietaryPreferences }, null],
      [{ type: "expenseSlider", name: "monthlyExpense", label: "参考月生活开支", min: 1000, max: 5000, step: 100, defaultValue: 3000 }, null],
      [{ type: "chips", multi: true, name: "selfValues", label: "关系里我会主动带来的东西", options: optionSets.values }, { type: "chips", multi: true, name: "idealValues", label: "希望对方重视", options: optionSets.values }],
      [{ type: "chips", multi: true, name: "selfStyle", label: "日常穿着气质", options: optionSets.styles }, { type: "chips", multi: true, name: "idealStyle", label: "容易吸引你的穿着气质", options: optionSets.styles }],
      [{ type: "heightSlider", name: "height", label: "我的身高", min: 140, max: 210, defaultValue: 170 }, { type: "heightSlider", name: "idealHeight", label: "最理想的伴侣身高", min: 140, max: 210, defaultValue: 170 }],
      [{ type: "chips", name: "appearanceFeel", label: "别人通常觉得我", options: optionSets.appearanceFeel.filter(item => item !== "不设偏好") }, { type: "chips", multi: true, exclusive: "不设偏好", name: "idealAppearanceFeel", label: "外在年龄感可接受", options: optionSets.appearanceFeel }],
      [{ type: "chips", name: "hair", label: "头发长度", options: optionSets.hair.filter(item => item !== "不设偏好") }, { type: "chips", multi: true, exclusive: "不设偏好", name: "idealHair", label: "头发长度可接受", options: optionSets.hair }],
      [{ type: "chips", name: "glasses", label: "眼镜状态", options: optionSets.glasses.filter(item => item !== "不设偏好") }, { type: "chips", multi: true, exclusive: "不设偏好", name: "idealGlasses", label: "眼镜状态可接受", options: optionSets.glasses }]
    ]
  },
  {
    title: "第四卷：兴趣爱好",
    short: "兴趣爱好",
    desc: "本卷所有题均为选择性作答，每个分类最多选五项，用于进一步筛选匹配对象。标签集并不保证分立和覆盖，仅用于提供兴趣方向参考。未涉及的部分可以在最末的填空栏输入，输入的结果将展示给匹配对象。",
    pairs: [],
    singleFields: [
      { type: "chips", multi: true, max: 5, name: "sportsInterests", label: "体育", options: optionSets.sportsInterests },
      { type: "chips", multi: true, max: 5, name: "musicInterests", label: "音乐", options: optionSets.musicInterests },
      { type: "chips", multi: true, max: 5, name: "movieInterests", label: "电影", options: optionSets.movieInterests },
      { type: "chips", multi: true, max: 5, name: "travelInterests", label: "旅行", options: optionSets.travelInterests },
      { type: "chips", multi: true, max: 5, name: "readingInterests", label: "读书", options: optionSets.readingInterests },
      { type: "chips", multi: true, max: 5, name: "skillInterests", label: "技术", options: optionSets.skillInterests },
      { type: "chips", multi: true, max: 5, name: "gameInterests", label: "游戏", options: optionSets.gameInterests },
      { type: "chips", multi: true, max: 5, name: "otherInterests", label: "其他", options: optionSets.otherInterests },
      { type: "textarea", name: "otherInterestText", label: "未涉及到的爱好填空", placeholder: "这部分内容会在匹配成功后推送给匹配对象。" }
    ]
  },
  {
    title: "第五卷：联系确认",
    short: "联系确认",
    desc: "留下匹配成功后可展示的联系方式，你之后仍然可以回到问卷更新答案。",
    pairs: [],
    contact: true
  }
];

const state = {
  route: "home",
  token: localStorage.getItem(tokenKey) || "",
  authToken: localStorage.getItem(authKey) || "",
  email: "",
  sliderVerified: false,
  authMode: "email",
  profile: null,
  round: null,
  pageIndex: 0,
  selected: {},
  authCheckTimer: null
};

const selfToIdealField = {
  intent: "idealIntent",
  tempo: "idealTempo",
  intimacy: "idealIntimacy",
  intimacyTiming: "idealIntimacyTiming",
  selfWeekends: "idealWeekends",
  selfValues: "idealValues",
  selfStyle: "idealStyle",
  appearanceFeel: "idealAppearanceFeel",
  hair: "idealHair",
  glasses: "idealGlasses"
};

const interestFields = [
  ["sportsInterests", "体育"],
  ["musicInterests", "音乐"],
  ["movieInterests", "电影"],
  ["travelInterests", "旅行"],
  ["readingInterests", "读书"],
  ["skillInterests", "技术"],
  ["gameInterests", "游戏"],
  ["otherInterests", "其他"]
];

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function formatDateTime(value) {
  if (!value) return "待定";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.missing ? `${payload.error}：${payload.missing.join("、")}` : payload.error);
  return payload;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function getByPath(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function setByPath(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  keys.slice(0, -1).forEach(key => {
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  });
  cursor[keys.at(-1)] = value;
}

function selectedValue(name) {
  return getByPath(state.selected, name);
}

function addSyncedIdealValue(field, value) {
  const target = selfToIdealField[field];
  if (!target || value === undefined || value === null || value === "") return;
  const current = Array.isArray(selectedValue(target)) ? selectedValue(target) : [];
  const next = current.filter(item => item !== "不设偏好");
  if (!next.map(String).includes(String(value))) next.push(value);
  setByPath(state.selected, target, next);
}

function hasAuthToken() {
  const stored = localStorage.getItem(authKey) || "";
  if (stored) state.authToken = stored;
  return Boolean(state.authToken);
}

function schedulePhrase(frequency) {
  if (!frequency) return "提交问卷后生成";
  const days = Number(frequency.referenceDays);
  if (Number.isFinite(days) && days <= 0) return "当前可参与下一轮分配";
  if (Number.isFinite(days)) return `约 ${days} 天后`;
  return `约 ${frequency.intervalDays || state.round?.intervalDays || 3} 天`;
}

function renderPersonalSchedule() {
  const el = $("[data-countdown]");
  const frequency = state.profile?.matchFrequency;
  const interval = frequency?.intervalDays || state.round?.intervalDays || state.round?.settings?.matchIntervalDays || 3;
  if (el) {
    if (frequency) {
      const days = Number(frequency.referenceDays);
      el.innerHTML = Number.isFinite(days) && days <= 0
        ? `<span><strong>可参与</strong><small>下一轮</small></span>`
        : `<span><strong>${Number.isFinite(days) ? days : interval}</strong><small>天左右</small></span>`;
    } else if (hasAuthToken()) {
      el.innerHTML = `<span><strong>待生成</strong><small>提交问卷后</small></span>`;
    } else {
      el.innerHTML = `<span><strong>${interval}</strong><small>天参考</small></span>`;
    }
  }
  const note = $("[data-round-note]");
  if (note) {
    note.textContent = frequency?.reason || "匹配频率会随画像分布、性别比例与偏好宽窄浮动";
  }
  const closeTime = $("[data-close-time]");
  if (closeTime) {
    const expected = frequency?.expectedNextAllocationAt ? `（${formatDateTime(frequency.expectedNextAllocationAt)}）` : "";
    closeTime.textContent = frequency
      ? `个人下次分配参考：${schedulePhrase(frequency)}${expected}`
      : "个人下次分配参考：提交问卷后生成";
  }
  const matchFrequency = $("[data-match-frequency]");
  if (matchFrequency) {
    matchFrequency.textContent = frequency
      ? `${frequency.label} · 参考间隔 ${frequency.intervalDays} 天`
      : `基础参考间隔 ${interval} 天`;
  }
}

function normalizeRoute(route) {
  return ["home", "dashboard", "survey", "results"].includes(route) ? route : "home";
}

function routeFromHash() {
  return normalizeRoute(window.location.hash.replace("#", "") || "home");
}

function navigate(route, options = {}) {
  route = normalizeRoute(route);
  if (route === "survey" && !hasAuthToken()) route = "home";
  state.route = route;
  if (options.syncHash !== false && window.location.hash !== `#${route}`) {
    history.replaceState(null, "", `#${route}`);
  }
  if (route === "survey") renderSurveyPage();
  $$(".view").forEach(view => view.classList.toggle("is-visible", view.id === route));
  $$(".nav-button").forEach(button => button.classList.toggle("is-active", button.dataset.nav === route));
  if (route === "results") loadMatches();
  if (["dashboard", "survey", "results"].includes(route)) focusView(route);
}

function bindNavigation() {
  document.addEventListener("click", event => {
    const item = event.target.closest("[data-nav]");
    if (!item) return;
    event.preventDefault();
    navigate(item.dataset.nav);
  });
  window.addEventListener("hashchange", () => navigate(routeFromHash(), { syncHash: false }));
}

function renderRound(payload) {
  state.round = payload.round;
  const interval = payload.settings?.matchIntervalDays || payload.round.intervalDays || 3;
  const note = payload.settings?.matchWindowNote || payload.round.note || "原则上每三天进行一次匹配；实际频率会受用户画像分布、性别比例与偏好宽窄影响。";
  $("[data-round-note]").textContent = `原则上每 ${interval} 天匹配一次，具体会随画像分布浮动`;
  $("[data-round-id]").textContent = payload.round.id;
  $("[data-participants]").textContent = `${payload.stats.participants} 人参与 · 女生 ${payload.stats.women} · 男生 ${payload.stats.men}`;
  $("[data-dashboard-title]").textContent = `${payload.round.id} 画像池更新中`;
  $("[data-close-time]").textContent = `下次匹配参考：${formatDateTime(payload.round.closesAt)}`;
  $("[data-result-time]").textContent = "发布：管理员审核后可见";
  const frequency = $("[data-match-frequency]");
  if (frequency) frequency.textContent = `原则上每 ${interval} 天一次`;
  const matchNote = $("[data-match-note]");
  if (matchNote) matchNote.textContent = note;
  const balanceNote = $("[data-balance-note]");
  if (balanceNote) {
    balanceNote.textContent = payload.stats.participants < 2
      ? "目前样本还少，系统会先保存画像；当可互相接受的人数增加后，匹配会更稳定。"
      : "同类画像越多，越容易稳定匹配；性别比例失衡、偏好过宽或过窄时，匹配频率和结果都会出现变化。";
  }
  $("[data-announcements]").innerHTML = payload.announcements.map(item => `
    <article class="announcement"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></article>
  `).join("");
  renderPersonalSchedule();
}

function optionButton(value, selected, fieldName, multi = false, label = value) {
  return `
    <label class="option-pill ${selected ? "is-selected" : ""}">
      <input type="${multi ? "checkbox" : "radio"}" name="${escapeHtml(fieldName)}" value="${escapeHtml(value)}" data-option-field="${escapeHtml(fieldName)}" ${selected ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function focusView(route) {
  const view = $(`#${route}`);
  if (!view) return;
  requestAnimationFrame(() => {
    view.scrollIntoView({ behavior: "smooth", block: "start" });
    view.focus?.({ preventScroll: true });
  });
}

function renderField(field) {
  if (!field) return `<div class="mirror-field empty-field" aria-hidden="true"></div>`;
  const current = selectedValue(field.name);
  if (field.type === "input") {
    return `<label class="mirror-field"><span>${escapeHtml(field.label)}</span><input name="${field.name}" value="${escapeHtml(current || "")}" placeholder="${escapeHtml(field.placeholder || "")}" /></label>`;
  }
  if (field.type === "textarea") {
    return `
      <label class="mirror-field">
        <span>${escapeHtml(field.label)}</span>
        <textarea name="${field.name}" rows="${field.rows || 4}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(current || "")}</textarea>
      </label>
    `;
  }
  if (field.type === "select") {
    return `
      <label class="mirror-field">
        <span>${escapeHtml(field.label)}</span>
        <select name="${field.name}" data-select-field="${field.name}">
          <option value="">请选择</option>
          ${field.options.map(option => `<option value="${escapeHtml(option)}" ${String(current ?? "") === String(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (field.type === "yearRange") {
    const min = selectedValue(`${field.name}Min`) || "";
    const max = selectedValue(`${field.name}Max`) || "";
    return `
      <div class="mirror-field">
        <span>${escapeHtml(field.label)}</span>
        <div class="range-selects">
          <label>
            <small>从</small>
            <select name="${field.name}Min" data-select-field="${field.name}Min">
              <option value="">不限</option>
              ${field.options.map(option => `<option value="${escapeHtml(option)}" ${String(min) === String(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
            </select>
          </label>
          <label>
            <small>到</small>
            <select name="${field.name}Max" data-select-field="${field.name}Max">
              <option value="">不限</option>
              ${field.options.map(option => `<option value="${escapeHtml(option)}" ${String(max) === String(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
    `;
  }
  if (field.type === "mbtiSliders") {
    return `
      <div class="mirror-field mbti-field">
        <span>${escapeHtml(field.label)}</span>
        <div class="mbti-sliders">
          ${mbtiDimensions.map(item => {
            const value = Number(selectedValue(`${field.name}.${item.key}`) ?? 0);
            return `
              <label>
                <small>${escapeHtml(item.left)}</small>
                <input type="range" min="-3" max="3" step="1" value="${value}" data-range-field="${escapeHtml(`${field.name}.${item.key}`)}" />
                <small>${escapeHtml(item.right)}</small>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }
  if (field.type === "heightSlider") {
    const value = Number(selectedValue(field.name) ?? field.defaultValue ?? 170);
    return `
      <div class="mirror-field height-field">
        <span>${escapeHtml(field.label)}</span>
        <div class="height-slider">
          <input name="${escapeHtml(field.name)}" type="range" min="${field.min}" max="${field.max}" step="1" value="${value}" data-range-field="${escapeHtml(field.name)}" data-range-unit="cm" />
          <strong>${value} cm</strong>
        </div>
      </div>
    `;
  }
  if (field.type === "expenseSlider") {
    const value = Number(selectedValue(field.name) ?? field.defaultValue ?? 3000);
    return `
      <div class="mirror-field expense-field">
        <span>${escapeHtml(field.label)}</span>
        <div class="height-slider expense-slider">
          <input name="${escapeHtml(field.name)}" type="range" min="${field.min}" max="${field.max}" step="${field.step || 100}" value="${value}" data-range-field="${escapeHtml(field.name)}" data-range-unit="元/月" />
          <strong>${value} 元/月</strong>
        </div>
      </div>
    `;
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(current) ? current.map(String) : [];
    const summary = selected.length ? selected.join("、") : "请选择，可多选";
    return `
      <div class="mirror-field">
        <span>${escapeHtml(field.label)}</span>
        <div class="multi-select" data-multiselect-field="${escapeHtml(field.name)}">
          <button type="button" class="multi-select-toggle" data-multiselect-toggle aria-expanded="false">
            <span>${escapeHtml(summary)}</span>
            <em>${selected.length ? `${selected.length} 项` : "多选"}</em>
          </button>
          <div class="multi-select-menu">
            ${field.options.map(option => `
              <button type="button" class="${selected.includes(String(option)) ? "is-selected" : ""}" data-multiselect-option data-value="${escapeHtml(option)}">
                ${escapeHtml(option)}
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }
  if (field.type === "scale") {
    const values = [-3, -2, -1, 1, 2, 3];
    return `
      <div class="mirror-field scale-field">
        <span>${escapeHtml(field.title)}</span>
        <div class="scale-labels"><small>${escapeHtml(field.left)}</small><small>${escapeHtml(field.right)}</small></div>
        <div class="segmented scale-options ${field.multi ? "multi" : ""}" data-field="${field.name}">
          ${values.map(value => optionButton(value, Array.isArray(current) ? current.includes(value) : current === value, field.name, field.multi)).join("")}
        </div>
      </div>
    `;
  }
  if (field.type === "binaryScale") {
    const values = [
      { value: -3, label: field.left },
      { value: 3, label: field.right }
    ];
    return `
      <div class="mirror-field scale-field">
        <span>${escapeHtml(field.title)}</span>
        <div class="segmented scale-options binary-scale" data-field="${field.name}">
          ${values.map(item => optionButton(item.value, Number(current) === item.value, field.name, false, item.label)).join("")}
        </div>
      </div>
    `;
  }
  const selected = Array.isArray(current) ? current.map(String) : [];
  return `
    <div class="mirror-field">
      <span>${escapeHtml(field.label)}</span>
      <div class="segmented ${field.multi ? "multi" : ""}" data-field="${field.name}" data-exclusive="${escapeHtml(field.exclusive || "")}" data-max="${field.max || ""}">
        ${field.options.map(option => optionButton(option, field.multi ? selected.includes(String(option)) : String(current ?? "") === String(option), field.name, field.multi)).join("")}
      </div>
    </div>
  `;
}

function renderSurveyPage() {
  const page = pages[state.pageIndex];
  const authed = hasAuthToken();
  renderAuthState();
  $(".survey-sidebar").hidden = !authed;
  $(".form-title").hidden = !authed;
  $(".mirror-frame").classList.toggle("is-single", Boolean(page.singleFields));
  $("[data-page-title]").textContent = page.title;
  $("[data-page-desc]").textContent = page.desc;
  $("[data-survey-progress]").textContent = `${state.pageIndex + 1} / ${pages.length} ${page.short}`;
  $("[data-paired-fields]").innerHTML = page.singleFields
    ? `<div class="single-fields">${page.singleFields.map(field => `<div class="mirror-cell moon-cell single-field-row">${renderField(field)}</div>`).join("")}</div>`
    : page.pairs.map(([self, ideal]) => `
      <div class="mirror-pair-row">
        <div class="mirror-cell moon-cell">${renderField(self)}</div>
        <div class="mirror-cell shade-cell">${renderField(ideal)}</div>
      </div>
    `).join("");
  $("[data-contact-page]").hidden = !authed || !page.contact;
  $(".mirror-frame").hidden = !authed || page.contact;
  $("[data-prev-page]").disabled = state.pageIndex === 0;
  $("[data-prev-page]").hidden = !authed;
  $("[data-next-page]").hidden = !authed || state.pageIndex === pages.length - 1;
  $("[data-submit-button]").hidden = !authed || state.pageIndex !== pages.length - 1;
  $("[data-survey-steps]").innerHTML = pages.map((item, index) => `
    <button type="button" class="${index === state.pageIndex ? "is-active" : ""}" data-page="${index}"><span>${index + 1}</span>${escapeHtml(item.short)}</button>
  `).join("");
  renderBoundary();
}

function renderAuthState() {
  const stored = localStorage.getItem(authKey) || "";
  if (stored) state.authToken = stored;
  const authed = Boolean(stored || state.authToken);
  window.__MOONSHADE_AUTH_DEBUG__ = {
    authed,
    hasStoredToken: Boolean(stored),
    hasStateToken: Boolean(state.authToken),
    route: state.route
  };
  const authPanel = $("[data-auth-panel]");
  const homeEntry = $("[data-home-entry]");
  if (authPanel) authPanel.hidden = authed;
  if (homeEntry) homeEntry.hidden = !authed;
  $$("[data-force-logout]").forEach(button => { button.hidden = !authed; });
  const homeEmail = $("[data-home-email]");
  if (homeEmail) homeEmail.textContent = state.email
    ? `${state.email} 已验证，${schedulePhrase(state.profile?.matchFrequency)}。`
    : "已登录，可以继续填写或更新问卷。";
  renderPersonalSchedule();
}

function bindControls() {
  document.addEventListener("click", event => {
    const multiOption = event.target.closest("[data-multiselect-option]");
    if (multiOption) {
      event.preventDefault();
      event.stopPropagation();
      const root = multiOption.closest("[data-multiselect-field]");
      const field = root.dataset.multiselectField;
      const value = multiOption.dataset.value;
      const list = new Set((selectedValue(field) || []).map(String));
      list.has(value) ? list.delete(value) : list.add(value);
      setByPath(state.selected, field, [...list]);
      $$(".multi-select.is-open").forEach(item => {
        item.classList.remove("is-open");
        item.querySelector("[data-multiselect-toggle]")?.setAttribute("aria-expanded", "false");
      });
      renderSurveyPage();
      return;
    }

    const multiToggle = event.target.closest("[data-multiselect-toggle]");
    if (multiToggle) {
      event.preventDefault();
      event.stopPropagation();
      const root = multiToggle.closest("[data-multiselect-field]");
      const wasOpen = root.classList.contains("is-open");
      $$(".multi-select.is-open").forEach(item => {
        item.classList.remove("is-open");
        item.querySelector("[data-multiselect-toggle]")?.setAttribute("aria-expanded", "false");
      });
      root.classList.toggle("is-open", !wasOpen);
      multiToggle.setAttribute("aria-expanded", String(!wasOpen));
      return;
    }

    if (!event.target.closest(".multi-select")) {
      $$(".multi-select.is-open").forEach(item => {
        item.classList.remove("is-open");
        item.querySelector("[data-multiselect-toggle]")?.setAttribute("aria-expanded", "false");
      });
    }

    const button = event.target.closest(".segmented button[data-value]");
    if (!button) return;
    event.preventDefault();
    const group = button.closest(".segmented");
    const field = group.dataset.field;
    const multi = group.classList.contains("multi");
    const exclusive = group.dataset.exclusive;
    const raw = button.dataset.value;
    const value = /^-?\d$/.test(raw) ? Number(raw) : raw;
    if (multi) {
      const list = new Set(selectedValue(field) || []);
      list.has(value) ? list.delete(value) : list.add(value);
      const max = Number(group.dataset.max || 0);
      if (max && list.size > max) {
        list.delete(value);
        const message = $("[data-form-message]");
        if (message) message.textContent = "每个兴趣分类最多选择 5 个。";
      }
      if (exclusive && value === exclusive && list.has(exclusive)) setByPath(state.selected, field, [exclusive]);
      else {
        if (exclusive) list.delete(exclusive);
        setByPath(state.selected, field, [...list]);
      }
    } else {
      setByPath(state.selected, field, value);
    }
    renderSurveyPage();
  });
  document.addEventListener("change", event => {
    const option = event.target.closest("[data-option-field]");
    if (option) {
      const field = option.dataset.optionField;
      const group = option.closest(".segmented");
      const exclusive = group?.dataset.exclusive;
      const raw = option.value;
      const value = /^-?\d$/.test(raw) ? Number(raw) : raw;
      if (option.type === "checkbox") {
        const checkedValues = Array.from(group.querySelectorAll("[data-option-field]:checked"))
          .filter(item => item.dataset.optionField === field)
          .map(item => /^-?\d$/.test(item.value) ? Number(item.value) : item.value);
        const max = Number(group?.dataset.max || 0);
        if (max && checkedValues.length > max) {
          option.checked = false;
          const message = $("[data-form-message]");
          if (message) message.textContent = "每个兴趣分类最多选择 5 个。";
          return;
        }
        const list = new Set(checkedValues);
        if (exclusive && value === exclusive && list.has(exclusive)) setByPath(state.selected, field, [exclusive]);
        else {
          if (exclusive) list.delete(exclusive);
          setByPath(state.selected, field, [...list]);
        }
        if (option.checked) addSyncedIdealValue(field, value);
      } else {
        setByPath(state.selected, field, value);
        addSyncedIdealValue(field, value);
      }
      renderSurveyPage();
      return;
    }
    const range = event.target.closest("[data-range-field]");
    if (range) {
      setByPath(state.selected, range.dataset.rangeField, Number(range.value));
      return;
    }
    const select = event.target.closest("[data-select-field]");
    if (!select) return;
    const value = select.multiple ? Array.from(select.selectedOptions).map(option => option.value) : select.value;
    setByPath(state.selected, select.dataset.selectField, value);
    renderBoundary();
  });
}

function bindSurveyPaging() {
  $("[data-prev-page]").addEventListener("click", () => {
    state.pageIndex = Math.max(0, state.pageIndex - 1);
    renderSurveyPage();
  });
  $("[data-next-page]").addEventListener("click", () => {
    state.pageIndex = Math.min(pages.length - 1, state.pageIndex + 1);
    renderSurveyPage();
  });
  $("[data-survey-steps]").addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    state.pageIndex = Number(button.dataset.page);
    renderSurveyPage();
  });
}

function renderBoundary() {
  const chips = [
    selectedValue("gender"),
    ...(selectedValue("seeking") || []).map(item => `想认识${item}`),
    selectedValue("identity"),
    ...(Array.isArray(selectedValue("location")) ? selectedValue("location") : [selectedValue("location")]),
    selectedValue("discipline"),
    selectedValue("intent")
  ].filter(Boolean);
  const target = $("[data-boundary-preview]");
  if (target) target.innerHTML = chips.length ? chips.map(item => `<span>${escapeHtml(item)}</span>`).join("") : `<span>尚未确定</span>`;
}

function collectForm() {
  const form = $("[data-survey-form]");
  const formData = Object.fromEntries(new FormData(form).entries());
  return { ...formData, ...state.selected, authToken: state.authToken, token: state.token, consent: form.elements.consent.checked };
}

function valueInOptions(value, options) {
  return options.includes(value);
}

function listInOptions(value, options) {
  return Array.isArray(value) && value.length > 0 && value.every(item => options.includes(item));
}

function intimacyAnswersCurrent(source) {
  return valueInOptions(source?.intimacy, optionSets.intimacy)
    && listInOptions(source?.idealIntimacy, optionSets.intimacy)
    && valueInOptions(source?.intimacyTiming, optionSets.intimacyTiming)
    && listInOptions(source?.idealIntimacyTiming, optionSets.intimacyTiming);
}

function needsSurveySupplement(profile) {
  return !intimacyAnswersCurrent(profile)
    || !Number.isInteger(profile?.selfMetrics?.marriage)
    || !Number.isInteger(profile?.idealMetrics?.marriage)
    || !Number.isInteger(profile?.selfMetrics?.fertility)
    || !Number.isInteger(profile?.idealMetrics?.fertility);
}

function cleanProfileFieldValue(key, value) {
  if (key === "intimacy") return valueInOptions(value, optionSets.intimacy) ? value : "";
  if (key === "idealIntimacy") return Array.isArray(value) ? value.filter(item => optionSets.intimacy.includes(item)) : [];
  if (key === "intimacyTiming") return valueInOptions(value, optionSets.intimacyTiming) ? value : "";
  if (key === "idealIntimacyTiming") return Array.isArray(value) ? value.filter(item => optionSets.intimacyTiming.includes(item)) : [];
  return value;
}

function fillForm(profile) {
  if (!profile) return;
  state.profile = profile;
  state.selected = {};
  const supplementNeeded = needsSurveySupplement(profile);
  if (supplementNeeded && state.pageIndex === 0) state.pageIndex = 1;
  [
    "displayName", "gender", "birthYear", "identity", "schoolType", "location", "discipline", "seeking",
    "idealBirthYearMin", "idealBirthYearMax", "idealIdentities", "idealLocations", "hometownProvince", "idealHometownRegions",
    "homeArea", "idealHomeAreas", "idealDisciplines", "intent", "idealIntent", "tempo", "idealTempo",
    "intimacy", "idealIntimacy", "intimacyTiming", "idealIntimacyTiming",
    "mbti", "mbtiMetrics", "idealMbtiMetrics", "selfMetrics", "idealMetrics", "selfWeekends", "idealWeekends", "selfValues", "idealValues",
    "dietaryPreferences", "monthlyExpense",
    "sportsInterests", "musicInterests", "movieInterests", "travelInterests", "readingInterests", "skillInterests", "gameInterests", "otherInterests", "otherInterestText",
    "selfStyle", "idealStyle", "height", "idealHeight", "appearanceFeel", "idealAppearanceFeel", "hair", "idealHair", "glasses", "idealGlasses"
  ].forEach(key => {
    if (profile[key] !== undefined && profile[key] !== null) setByPath(state.selected, key, cleanProfileFieldValue(key, profile[key]));
  });
  const form = $("[data-survey-form]");
  ["contactType", "contactValue", "selfIntro"].forEach(name => {
    if (form.elements[name]) form.elements[name].value = profile[name] || "";
  });
  form.elements.consent.checked = profile.consent === true;
  $("[data-submit-state]").textContent = supplementNeeded
    ? "问卷有新增题目待补充"
    : "本轮问卷已提交";
  const message = $("[data-form-message]");
  if (message) {
    message.textContent = supplementNeeded
      ? "亲密关系题目已更新，请在第二卷补充这两题后重新提交。其他已填写内容已为你保留。"
      : "";
  }
  renderSurveyPage();
}

function bindForm() {
  const form = $("[data-survey-form]");
  form.addEventListener("input", event => {
    const input = event.target;
    if (input.matches("[data-range-field]")) {
      setByPath(state.selected, input.dataset.rangeField, Number(input.value));
      input.closest(".height-slider")?.querySelector("strong")?.replaceChildren(`${input.value} ${input.dataset.rangeUnit || ""}`.trim());
      return;
    }
    if (input.name && input.closest(".mirror-field")) setByPath(state.selected, input.name, input.value.trim());
    renderBoundary();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("[data-form-message]");
    message.textContent = "正在提交...";
    try {
      const payload = await api("/api/profile", { method: "POST", body: JSON.stringify(collectForm()) });
      state.token = payload.profile.token;
      localStorage.setItem(tokenKey, state.token);
      fillForm(payload.profile);
      message.textContent = "已提交。你可以继续修改，也可以去结果页查看当前匹配。";
      await loadRound();
      await loadMe();
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

function appendAuthLog(message) {
  const log = $("[data-local-log]");
  if (!log) return;
  log.hidden = false;
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  log.innerHTML = `<p><strong>${time}</strong> ${escapeHtml(message)}</p>` + log.innerHTML;
}

async function checkEmailAfterSlide() {
    const email = $("[data-email-input]").value.trim();
    const status = $("[data-auth-status]");
    if (!state.sliderVerified) {
      status.textContent = "请先完成滑动安全验证。";
      return;
    }
    if (!email) {
      status.textContent = "请输入北大邮箱。";
      return;
    }
    status.textContent = "正在检查账号...";
    try {
      const result = await api("/api/auth/check-email", { method: "POST", body: JSON.stringify({ email, sliderPassed: true }) });
      state.email = result.email;
      state.authMode = result.exists ? "login" : "register";
      $("[data-login-mode]").hidden = !result.exists;
      $("[data-register-mode]").hidden = result.exists;
      status.textContent = result.exists ? "该邮箱已注册，请输入密码登录。" : "该邮箱未注册，请发送验证码并设置密码。";
      appendAuthLog(result.exists ? `已检测到已有账号：${result.email}` : `未检测到账号：${result.email}，进入验证码注册。`);
    } catch (error) {
      status.textContent = error.message;
      appendAuthLog(error.message);
    }
}

function bindAuth() {
  const logoutButton = $("[data-logout]");
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      localStorage.removeItem(authKey);
      localStorage.removeItem(tokenKey);
      localStorage.removeItem("moonshade.adminToken");
      window.location.reload();
    });
  }
  const deleteButton = $("[data-delete-account]");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!state.authToken) return;
      const confirmed = confirm("永久注销账户将删除账号、问卷和匹配记录，无法恢复。确定继续吗？");
      if (!confirmed) return;
      deleteButton.disabled = true;
      try {
        await api("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ authToken: state.authToken }) });
        localStorage.removeItem(authKey);
        localStorage.removeItem(tokenKey);
        localStorage.removeItem("moonshade.adminToken");
        window.location.replace("/");
      } catch (error) {
        appendAuthLog(error.message);
        alert(error.message);
        deleteButton.disabled = false;
      }
    });
  }
  $("[data-request-code]").addEventListener("click", async () => {
    const email = $("[data-email-input]").value.trim();
    const status = $("[data-auth-status]");
    const button = $("[data-request-code]");
    if (!state.sliderVerified) {
      status.textContent = "请先完成滑动安全验证。";
      return;
    }
    status.textContent = "正在发送验证码...";
    button.disabled = true;
    try {
      const result = await api("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email, sliderPassed: true }) });
      status.textContent = result.devCode
        ? `${result.message} 验证码：${result.devCode}`
        : (result.message || "验证码已发送。");
      appendAuthLog(result.devCode ? `本地验证码：${result.devCode}` : "验证码发送请求已提交。");
    } catch (error) {
      status.textContent = error.message;
      appendAuthLog(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("[data-login-button]").addEventListener("click", async () => {
    const email = $("[data-email-input]").value.trim();
    const password = $("[data-login-password]").value;
    const status = $("[data-auth-status]");
    status.textContent = "正在登录...";
    try {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      state.authToken = result.token;
      state.email = result.email;
      localStorage.setItem(authKey, result.token);
      status.textContent = `已登录：${result.email}`;
      appendAuthLog(`登录成功：${result.email}`);
      renderAuthState();
      await loadMe();
      navigate("survey");
    } catch (error) {
      status.textContent = error.message;
      appendAuthLog(error.message);
    }
  });
  $("[data-verify-code]").addEventListener("click", async () => {
    const email = $("[data-email-input]").value.trim();
    const code = $("[data-code-input]").value.trim();
    const password = $("[data-register-password]").value;
    const status = $("[data-auth-status]");
    status.textContent = "正在注册...";
    try {
      const result = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code, password }) });
      state.authToken = result.token;
      state.email = result.email;
      localStorage.setItem(authKey, result.token);
      status.textContent = `已验证：${result.email}`;
      appendAuthLog(`注册并登录成功：${result.email}`);
      renderAuthState();
      await loadMe();
      navigate("survey");
    } catch (error) {
      status.textContent = error.message;
      appendAuthLog(error.message);
    }
  });
}

function bindSliderVerify() {
  const root = $("[data-slide-verify]");
  const handle = $("[data-slide-handle]");
  const fill = $("[data-slide-fill]");
  const label = $("[data-slide-label]");
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
    checkEmailAfterSlide();
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

function bindAuthReset() {
  $("[data-email-input]").addEventListener("input", () => {
    state.authMode = "email";
    $("[data-login-mode]").hidden = true;
    $("[data-register-mode]").hidden = true;
    if (state.sliderVerified) {
      clearTimeout(state.authCheckTimer);
      $("[data-auth-status]").textContent = "邮箱变更，正在重新检查...";
      state.authCheckTimer = setTimeout(checkEmailAfterSlide, 450);
    } else {
      $("[data-auth-status]").textContent = "请输入北大邮箱，完成滑动验证后继续。";
    }
  });
}

async function loadRound() {
  renderRound(await api("/api/round"));
}

async function loadAuth() {
  if (!state.authToken) return;
  const result = await api(`/api/auth/me?authToken=${encodeURIComponent(state.authToken)}`);
  if (result.user) {
    state.email = result.user.email;
    $("[data-email-input]").value = result.user.email;
    $("[data-auth-status]").textContent = `已验证：${result.user.email}`;
    renderAuthState();
  } else {
    localStorage.removeItem(authKey);
    state.authToken = "";
    renderAuthState();
  }
}

async function loadMe() {
  const query = state.authToken ? `authToken=${encodeURIComponent(state.authToken)}` : `token=${encodeURIComponent(state.token)}`;
  if (!state.authToken && !state.token) return;
  const payload = await api(`/api/me?${query}`);
  if (payload.profile) {
    fillForm(payload.profile);
  } else {
    state.profile = null;
    renderPersonalSchedule();
  }
}

async function loadMatches() {
  const list = $("[data-match-list]");
  if (!state.authToken && !state.token) {
    list.innerHTML = `<div class="empty-state">还没有提交问卷。先验证北大邮箱并填写问卷。</div>`;
    return;
  }
  list.innerHTML = `<div class="empty-state">正在计算匹配结果...</div>`;
  try {
    const query = state.authToken ? `authToken=${encodeURIComponent(state.authToken)}` : `token=${encodeURIComponent(state.token)}`;
    const payload = await api(`/api/matches?${query}`);
    if (!payload.matches.length) {
      list.innerHTML = `<div class="empty-state results-empty">管理员还没有发布本轮匹配。生成后的匹配表会先进入后台审核，发布后才会在这里显示。</div>`;
      return;
    }
    list.innerHTML = payload.matches.map(item => renderMatch(item, payload.profile)).join("");
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function commonInterestTags(selfProfile = {}, otherProfile = {}) {
  return interestFields.flatMap(([field, label]) => {
    const own = new Set(Array.isArray(selfProfile[field]) ? selfProfile[field] : []);
    const common = (Array.isArray(otherProfile[field]) ? otherProfile[field] : []).filter(value => own.has(value));
    return common.map(value => `${label}：${value}`);
  });
}

function renderMatch(item, selfProfile) {
  const profile = item.profile;
  const location = Array.isArray(profile.location) ? profile.location.join("、") : (profile.location || profile.city);
  const profileMeta = [profile.birthYear ? `${profile.birthYear} 年` : "", profile.gender, profile.identity || profile.stage, location, profile.discipline || profile.department].filter(Boolean).join(" · ");
  const pushedAt = item.pushedAt ? formatDateTime(item.pushedAt) : "待确认";
  const commonInterests = commonInterestTags(selfProfile, profile);
  const interestBlock = commonInterests.length || profile.otherInterestText
    ? `<div class="interest-match">
        ${commonInterests.length ? `<strong>共同爱好</strong><div class="reason-list">${commonInterests.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        ${profile.otherInterestText ? `<p><strong>TA补充的爱好：</strong>${escapeHtml(profile.otherInterestText)}</p>` : ""}
      </div>`
    : "";
  const contact = item.contact
    ? `<div class="contact-box"><strong>${escapeHtml(item.contact.type || "联系方式")}</strong><br>${escapeHtml(item.contact.value)}</div>`
    : `<div class="contact-box">管理员发布后展示联系方式。</div>`;
  return `<article class="match-card"><div class="match-score">${item.score}</div><div><p class="eyebrow">MoonShade Match</p><h3>${escapeHtml(profile.displayName)}</h3><p class="match-time">匹配时间：${escapeHtml(pushedAt)}</p><p class="match-meta">${escapeHtml(profileMeta)}</p></div><p>${escapeHtml(profile.selfIntro || "对方还没有写自我介绍。")}</p><div class="reason-list">${item.reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join("")}</div>${interestBlock}${contact}</article>`;
}

function bindResults() {
  $("[data-refresh-results]").addEventListener("click", loadMatches);
}

async function init() {
  state.authToken = localStorage.getItem(authKey) || state.authToken;
  bindNavigation();
  bindControls();
  bindSurveyPaging();
  bindForm();
  bindAuth();
  bindAuthReset();
  bindSliderVerify();
  bindResults();
  renderSurveyPage();
  navigate(routeFromHash());
  await loadRound();
  await loadAuth();
  await loadMe();
  renderSurveyPage();
  navigate(routeFromHash());
  renderAuthState();
  setInterval(renderAuthState, 500);
}

init().catch(error => {
  console.error(error);
  $("[data-countdown]").textContent = "加载失败";
});
