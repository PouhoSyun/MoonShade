# 月影 MoonShade

MoonShade 是一个面向小范围内测的问卷匹配交友平台。当前项目包含用户注册、邮箱验证码、分卷问卷、管理员候选匹配、公告管理、发布/撤回匹配结果和 JSON 文件持久化。

## 功能概览

- 首页状态栏：展示当天日期、已匹配人次、问卷完整度、问卷精准度、个人权重分和预计匹配日期。
- 北大邮箱注册：支持 `@pku.edu.cn`、`@stu.pku.edu.cn`、`@alumni.pku.edu.cn`。
- 问卷系统：按卷填写，必填项不完整时提示需要更新的卷序号，兴趣爱好卷为选填。
- 用户端匹配结果：只有管理员发布后的匹配会展示给用户，并附带对方资料、共同兴趣和联系方式。
- 管理员后台：查看已提交问卷、管理公告、生成测试用户、查看候选匹配、推送匹配、撤回已发布匹配。
- 匹配算法：按个人权重、布尔门槛、兴趣取向、重复降权综合排序。
- 数据存储：默认使用 `data/moonshade.json`，无需数据库即可部署。

## 本地运行

项目需要 Node.js 18 或以上。

```bash
npm start
```

默认地址：

- 用户首页：`http://localhost:3000`
- 管理员后台：`http://localhost:3000/admin.html`

默认管理员账号可以通过环境变量覆盖：

```bash
MOONSHADE_ADMIN_EMAIL=你的管理员邮箱
MOONSHADE_ADMIN_PASSWORD=你的管理员密码
npm start
```

如果没有设置环境变量，开发模式会使用代码里的默认管理员账号。正式部署前务必改成自己的管理员邮箱和强密码。

## 部署

复制环境变量模板并编辑：

```bash
cp .env.example .env
nano .env
npm start
```

常用环境变量：

```bash
PORT=3000
TZ=Asia/Shanghai
MOONSHADE_DATA_FILE=data/moonshade.json
MOONSHADE_ADMIN_EMAIL=你的管理员邮箱
MOONSHADE_ADMIN_PASSWORD=你的管理员密码
```

Docker 部署：

```bash
docker build -t moonshade .
docker run --env-file .env -p 3000:3000 -v moonshade-data:/app/data moonshade
```

服务器正式开放前建议同时配置 HTTPS、反向代理、定期备份 `data/moonshade.json`，并确保 `.env` 不提交到 git。

## 邮件验证码

默认开发模式会把验证码输出到服务端日志，便于本地测试。正式部署时推荐使用 Brevo SMTP Relay。

Brevo 后台路径：

1. 进入 Brevo 后台的 `SMTP & API`
2. 打开 `SMTP` 标签页
3. 复制 SMTP login，并生成 SMTP key
4. 确认发件人邮箱已经在 Brevo 里验证

`.env` 示例：

```bash
MOONSHADE_MAIL_TRANSPORT=smtp
MOONSHADE_SMTP_HOST=smtp-relay.brevo.com
MOONSHADE_SMTP_PORT=465
MOONSHADE_SMTP_SECURE=true
MOONSHADE_SMTP_USER=你的Brevo SMTP login
MOONSHADE_SMTP_PASS=你的Brevo SMTP key
MOONSHADE_SMTP_FROM=你的已验证发件人邮箱
MOONSHADE_SMTP_FROM_NAME=MoonShade
```

本地发送测试：

```bash
MOONSHADE_SMTP_HOST=smtp-relay.brevo.com \
MOONSHADE_SMTP_PORT=465 \
MOONSHADE_SMTP_SECURE=true \
MOONSHADE_SMTP_USER=你的Brevo SMTP login \
MOONSHADE_SMTP_PASS=你的Brevo SMTP key \
MOONSHADE_SMTP_FROM=你的已验证发件人邮箱 \
MOONSHADE_SMTP_FROM_NAME=MoonShade \
TEST_EMAIL_TO=你的收件邮箱 \
npm run test:email
```

注意：

- `MOONSHADE_SMTP_PASS` 要填 Brevo 的 SMTP key，不是 Brevo API key，也不是网页登录密码。
- `MOONSHADE_SMTP_FROM` 必须是 Brevo 里已验证的 sender 或已认证域名下的邮箱。
- 当前项目推荐 `465 + SSL/TLS`，配置最明确。

如果服务器已经配置了 `sendmail` 或 `msmtp`，也可以使用：

```bash
MOONSHADE_MAIL_TRANSPORT=sendmail SENDMAIL_PATH=/usr/sbin/sendmail npm start
```

## 问卷逻辑

问卷分卷保存到用户 profile 中。必填项用于计算问卷完整度，选填项主要提升画像精准度和匹配解释。

必填完整度目前覆盖：

- 基础身份：展示名、性别、希望匹配性别、出生年、身份、北大身份、校区。
- 关系期待：匹配期待、沟通节奏、恋爱接受程度、亲密关系时间、恋爱后交际圈边界。
- 双向期待：对方亲密边界、对方亲密关系时间、对方交际圈边界。
- 量表题：本人和期待对方的婚姻意向、生育意向。
- 发布必要信息：联系方式和授权参与匹配。

兴趣爱好卷为选填。每个分类最多选五项，用于计算共同兴趣和成功匹配后的共同爱好展示。最末的未涉及爱好填空会在匹配成功后展示给匹配对象，并参与文本兴趣命中。

## 管理员流程

管理员后台的核心流程是“候选匹配 -> 推送 -> 已发布 -> 可撤回”。

1. 候选匹配每天自动生成草稿，也可以在后台手动刷新候选。
2. 候选列表只显示 `draft` 状态，并排除本轮已经发布匹配的用户，避免同一批次里重复推送同一个人。
3. 管理员点击候选卡片上的“推送”后，该条匹配变为 `published`，用户端才会看到结果和联系方式。
4. 推送成功后，同轮草稿中涉及这两个人的其他候选会被清理，管理员列表会刷新。
5. 已发布匹配被单独放在已发布页面，不再显示备注和状态选择。
6. 点击“撤回”会直接删除该条发布记录，用户端不再显示，也不计入上次成功匹配、重复降权和历史匹配次数。

公告可以在管理员后台新增、修改、删除。用户首页会读取当前公告列表展示。

## 匹配算法

算法入口主要在 `server.mjs`：

- `profileCompleteness(profile)`：计算必填问卷完整度。
- `profileClarity(profile)`：计算画像精准度，包含更多选填字段。
- `profileWeightFactors(profile, profiles, history)`：计算个人权重。
- `scorePair(a, b)`：计算两人之间的布尔门槛和取向权重。
- `generateRoundMatches(profiles, roundId, matches, settings)`：生成管理员候选列表。
- `matchPreview(left, right, matches, settings, profiles)`：管理员调整或推送前重新计算权重。

### 个人权重

个人权重用于决定每个人进入候选池的优先级：

```text
personalWeight
= completenessCoefficient
  * precisionCoefficient
  * gapCoefficient
  * genderRatioCoefficient
  * scarcityCoefficient
```

其中：

- `completenessCoefficient = -c^2 + 2c`，`c` 是必填问卷完整度。
- `precisionCoefficient = -p^2 + 2p`，`p` 由关键多选偏好宽窄计算，偏好越清楚越高。
- `gapCoefficient` 根据距上次成功匹配的天数计算。2 天内为 0，3 到 7 天按 `1.15^(days - 3)` 增加，未匹配过按 7 天处理。
- `genderRatioCoefficient` 根据当前性别供需修正，范围限制在 `0.55` 到 `1.8`。
- `scarcityCoefficient = -s^2 + 2s`，`s` 表示画像中较稀缺属性的平均稀缺度。

只有 `published` 状态的匹配会进入历史统计。草稿、撤回和未推送方案不会改变上次成功匹配时间，也不会触发重复降权。

### 预计匹配日期

预计匹配日期先按性别比例给出基础间隔，再用个人权重做小幅偏移：

```text
maleDays = 4 * sqrt(women / men)
femaleDays = 4 / sqrt(women / men)
intervalDays = clamp(baseDays - clamp((personalWeight - 1) * 0.45, -0.75, 0.75), 1, 7)
expectedAt = (lastPublishedAt || today) + intervalDays
```

当男女比例接近 1:1 时，基础间隔约为 4 天。比例偏移时，人数更稀缺的一侧间隔会更短；总间隔最多不超过 7 天。

### 双人交叉权重

两人配对先计算布尔门槛，再计算兴趣取向：

```text
booleanGate = 0                         如果存在硬性不符合
booleanGate = 0.95 ^ softViolationCount 否则按软性不符合项降权

orientationWeight = 1 + interestBonus + freeTextBonus
interestBonus = floor(max(0, sharedInterestCount - 7) / 2) * 0.1
freeTextBonus = freeTextInterestHits * 0.07
```

硬性不符合项包括性别、出生年范围、校区。硬性不符合不会过滤掉记录本身，而是把布尔门槛设为 0，方便管理员看到“零权重候选”的原因。

软性不符合项包括第一卷和后续问卷中所有“可接受”字段，例如院校背景、家乡地区、成长环境、专业方向、关系期待、沟通节奏、亲密边界、交际圈边界、周末偏好、穿着气质、头发长度、眼镜状态等。管理员界面会列出全部不符合项，不折叠。

### 最终排序

候选配对的权重计算为：

```text
personalWeightProduct = left.personalWeight * right.personalWeight
crossWeight = personalWeightProduct * booleanGate * orientationWeight
repeatFactor = 0.72 ^ repeatedCount * (lastRepeat ? 0.65 : 1)
finalWeight = crossWeight * repeatFactor
```

候选列表按 `crossWeight` 优先排序，再按 `finalWeight` 排序，取前 10 个给管理员确认。重复降权只参考已发布历史；管理员在推送前更换方案不会污染历史参数。

## 常改位置

- 首页和问卷结构：`public/index.html`
- 用户端交互和问卷校验：`public/app.js`
- 管理员界面：`public/admin.js`
- 视觉样式：`public/styles.css`
- 匹配算法和 API：`server.mjs`
- 邮件发送测试：`scripts/test-email.mjs`
- 数据文件：`data/moonshade.json`

正式长期运行前建议继续补充数据导出、管理员操作日志、访问频率限制、验证码重发冷却、隐私开关和自动备份。
