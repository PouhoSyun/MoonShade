# 月影 MoonShade

MoonShade 是一个小型问卷匹配交友平台原型，当前版本包含：

- 首页倒计时与本轮状态
- 问卷填写、更新和本地 token 识别
- 北大邮箱验证码注册：支持 `@pku.edu.cn`、`@stu.pku.edu.cn`、`@alumni.pku.edu.cn`
- 管理员后台：查看用户、生成每周匹配、手动微调匹配结果
- JSON 文件持久化
- 基础匹配算法
- 匹配结果与联系方式展示
- 零外部依赖 Node.js 服务，可直接部署

## 本地运行

```bash
npm start
```

默认地址是 `http://localhost:3000`。

管理员后台是 `http://localhost:3000/admin.html`。

默认管理员：

- 账号：`moodylitchee@stu.pku.edu.cn`
- 密码：`moodylitchee`

## 部署

服务器需要 Node.js 18 或以上：

```bash
cp .env.example .env
nano .env
npm start
```

也可以使用 Docker：

```bash
docker build -t moonshade .
docker run --env-file .env -p 3000:3000 -v moonshade-data:/app/data moonshade
```

## 之后最常改的地方

- 问卷界面：`public/index.html`
- 问卷交互：`public/app.js`
- 匹配权重：`server.mjs` 里的 `scorePair`
- 数据文件：默认写入 `data/moonshade.json`

当前版本适合小范围内测。正式开放前建议继续补充数据导出、HTTPS、访问频率限制、验证码重发冷却和更细的隐私开关。

## 邮件验证码

默认开发模式会把验证码输出到服务端日志，便于本地测试。正式部署时推荐使用 Brevo SMTP Relay。

Brevo 后台路径：

1. 进入 Brevo 后台的 `SMTP & API`
2. 打开 `SMTP` 标签页
3. 复制 SMTP login，并生成 SMTP key
4. 确认发件人邮箱已经在 Brevo 里验证

```bash
MOONSHADE_MAIL_TRANSPORT=smtp \
MOONSHADE_SMTP_HOST=smtp-relay.brevo.com \
MOONSHADE_SMTP_PORT=465 \
MOONSHADE_SMTP_SECURE=true \
MOONSHADE_SMTP_USER=你的Brevo SMTP login \
MOONSHADE_SMTP_PASS=你的Brevo SMTP key \
MOONSHADE_SMTP_FROM=你的已验证发件人邮箱 \
MOONSHADE_SMTP_FROM_NAME=MoonShade \
npm start
```

如果已经在项目根目录写好了 `.env`，也可以直接：

```bash
npm start
```

服务启动时会自动读取 `.env`。真实 SMTP key 不要提交到 git，项目已经在 `.gitignore` 里忽略 `.env`。

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

- `MOONSHADE_SMTP_PASS` 要填 Brevo 的 SMTP key，不是 Brevo API key，也不是网页登录密码
- `MOONSHADE_SMTP_FROM` 必须是 Brevo 里已验证的 sender 或已认证域名下的邮箱
- Brevo 也提供 `587`/`2525`，但当前项目推荐直接用 `465 + SSL/TLS`，配置最明确

如果服务器已经配置了 `sendmail`/`msmtp`，也可以继续使用：

```bash
MOONSHADE_MAIL_TRANSPORT=sendmail SENDMAIL_PATH=/usr/sbin/sendmail npm start
```

生产环境建议同时开启 HTTPS，并把管理员密码改成环境变量或数据库配置。
