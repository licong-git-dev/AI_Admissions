<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3d846a6e-0a91-40b6-bbf0-97f1f019da03

## Run Locally

**Prerequisites:** Node.js

### Frontend
1. Install dependencies:
   `npm install`
2. Start frontend:
   `npm run dev`
3. Visit:
   `http://localhost:3000`

### Backend
1. Create `server/.env` based on `server/.env.example`
2. Set `GEMINI_API_KEY`
3. Set `JWT_SECRET`（>= 16 位随机字符，必需）
4. 首次启动前：`ENABLE_DB_SEED=true npm run server:dev` 注入默认账号和配置数据
5. 正常启动：`npm run server:dev`
6. Health check：`http://localhost:8787/api/health`

### 默认账号（首次 seed 时注入）
| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123456 | 甲方管理员 |
| tenant_admin | tenant123456 | 乙方老板 |
| zhangsan / lisi / wangwu | specialist123 | 招生专员 |

默认密码可通过 `BOOTSTRAP_ADMIN_PASSWORD`、`BOOTSTRAP_TENANT_PASSWORD`、`BOOTSTRAP_SPECIALIST_PASSWORD` 环境变量覆盖。**生产部署必须改默认密码**。

### RPA Worker (Phase 2c)
独立进程，负责 RPA 发布/私信扫描任务的实际执行。主服务与 Worker 通过共享 SQLite 通信，互不依赖。

#### 一次性准备（仅目标环境需要）
```bash
# 1) 安装 Playwright（轻量服务器可跳过；真实跑 RPA 的机器必须装）
npm install
npx playwright install chromium

# 2) 在 server/.env 配置 cookies 加密密钥（长度 >= 16）
echo "RPA_COOKIES_SECRET=<16位以上随机字符串>" >> server/.env
```

#### 启动 Worker
```bash
npm run worker:dev
```

#### 环境变量
- `RPA_COOKIES_SECRET` (必需) — cookies AES-256-GCM 加密密钥
- `RPA_TICK_INTERVAL_MS` (默认 30000) — 任务扫描频率
- `RPA_SCHEDULER_INTERVAL_MS` (默认 600000) — 每 10 分钟为已登录账号生成 fetch_dm 任务
- `RPA_HEALTH_CHECK_INTERVAL_MS` (默认 86400000) — 每 24h 对已登录账号做登录态健康检查
- `RPA_HEADLESS` (默认 true) — 浏览器无头模式；登录 CLI 自动设为 false
- `RPA_AUTO_SUBMIT` (默认 false) — 发布任务是否自动点"发布"按钮（初期建议关闭，人工最后确认）
- `GEMINI_API_KEY` (与主服务共用) — Worker 调用 Gemini 做意向分级

#### 账号健康度自检（Phase 3）
Worker 每 24h 为已登录账号访问平台创作者中心，检测：
- cookies 能否解密
- 能否成功加载平台页面
- 登录后元素（「创作中心」「发布笔记」等）是否可见
失败账号自动设 status=cooldown、写入 `risk_note`，需要人工重新登录。恢复正常的账号自动清除 risk_note。

#### 账号登录（两种方式）

**方式 1：CLI 扫码（推荐，最干净）**

在有图形界面的机器上跑：
```bash
npm run worker:login -- <accountId>
```
会弹出浏览器，扫码登录成功后，cookies 自动加密写库。

**方式 2：粘贴 cookies（无 GUI 机器适用）**

在浏览器里登录目标平台 → 用 EditThisCookie 等扩展导出 cookies JSON → 在管理后台「AI 获客 → 发布矩阵」找到对应账号 → 点「登录」→ 切换到「粘贴 cookies」Tab → 粘贴保存。

#### Playwright 未安装时的行为
Worker 仍能启动，但所有发布/抓取任务会优雅降级为 stub 并标记失败，数据库不会坏。轻量服务器可以先只跑主服务和前端验证 UI，真正跑 RPA 前再部署一台 2G+ 内存机器做 Worker。

#### 当前支持平台
- `xiaohongshu`（发布 + 私信抓取）
- `douyin`（发布 + 私信抓取，选择器可能随平台改版调整）
- `kuaishou`（发布 + 私信抓取，选择器可能随平台改版调整）

### 内容工厂自动发布联动（Sprint 3）
内容工厂审核通过时，后端会：
1. 读取 `content_items.platforms_json` 中选中的平台（xhs/dy/ks）
2. 为每个平台自动挑选一个「已登录 + active + 今日未达配额」的账号（品牌号优先）
3. 创建 `rpa_tasks`（type=publish），`scheduled_at` 随机延迟 5-30 分钟
4. Worker 按时间取出任务，调用对应平台适配器完成真实发布
5. 发布成功时回写 `content_items.status='published'` 和 `published_at`

### 采集器（Sprint 3）
- Worker 每小时触发一次 `runCrawlOnce`
- 仅访问 `crawler_sources` 白名单中 `is_enabled=1` 的源
- 每个源按自己的 `frequency_hours` 节流
- 抓取的条目经违规词过滤（含个人信息的直接丢弃），写入 `crawler_items`
- 环境变量：`CRAWLER_INTERVAL_MS`（默认 3600000 = 1 小时）

### 微信支付定金（Phase 2a M2）
学员 H5 测评完成后显示「锁定名额」入口，走 500 元定金支付。商户未配置时自动降级为 stub（返回 fake code_url，展示演示提示）。

#### 环境变量（真实生效需全部配置）
- `WECHATPAY_MCHID` — 商户号
- `WECHATPAY_APPID` — 应用 ID
- `WECHATPAY_API_V3_KEY` — APIv3 密钥（32 位）
- `WECHATPAY_SERIAL_NO` — 商户证书序列号
- `WECHATPAY_PRIVATE_KEY_PATH` — 商户私钥 PEM 文件路径
- `WECHATPAY_NOTIFY_URL` — 支付回调 URL，建议 `https://<你的域名>/api/deposits/webhook/notify`

#### 关键端点
- `POST /api/deposits` — 创建订单（返回 code_url 供前端渲染二维码）
- `GET /api/deposits/:outTradeNo` — 查询订单状态（前端轮询）
- `POST /api/deposits/webhook/notify` — 微信支付回调（自动解密 + 验证 + 更新订单）
- `POST /api/deposits/:outTradeNo/refund` — 申请退款（合同第 3.2 条定金退还）
- `GET /api/deposits` — 订单列表（可按 status/phone/leadId 筛选）

### 成交登记 + 月度分成结算（Phase 2a M3）
合同第 3.1 条约定甲方按乙方实际招生成交学费的 30% 收取分成。系统已实现成交登记、月度聚合、异常检测、CSV 导出。

#### 关键端点
- `POST /api/deals` — 登记成交（自动检测"无跟进/近 30 天无跟进"疑似绕单）
- `GET /api/deals?status=&period=YYYY-MM` — 成交列表
- `GET /api/deals/summary` — 分成汇总（按月）
- `PATCH /api/deals/:id` — 更新已缴学费 / 已结分成 / 状态（仅 admin/tenant_admin 可改分成字段）
- `POST /api/settlement/reports/generate` — 生成/刷新指定月份的结算报表
- `GET /api/settlement/reports` — 月报列表
- `GET /api/settlement/reports/:period/csv` — 下载 CSV（包含每条成交的明细）

### 审计日志 + 异常成交检测（Phase 2b）
所有敏感写操作（POST/PATCH/PUT/DELETE）自动写入 `audit_logs`，含用户 ID / 操作 / 资源 / IP / UA / 请求体快照（敏感字段已脱敏）。

- `GET /api/audit?userId=&resourceType=&since=&until=` — 审计日志查询（仅 admin/tenant_admin）
- `GET /api/audit/suspicious-deals` — 疑似异常成交列表

### 企业微信集成（Phase 2a 扩展）
支持新成交通知甲方管理员、测试消息、外部消息回调记录。未配置时 stub 降级。

#### 环境变量
- `WECHAT_WORK_CORP_ID` — 企业微信 CorpID
- `WECHAT_WORK_AGENT_ID` — 应用 AgentID
- `WECHAT_WORK_APP_SECRET` — 应用 Secret
- `WECHAT_WORK_CONTACT_SECRET` — 通讯录 Secret（可选，用于客户联系功能）

#### 关键端点
- `GET /api/wechat-work/status` — 配置状态
- `POST /api/wechat-work/send-test` — 发送测试文本消息
- `POST /api/wechat-work/webhook/message` — 外部消息回调（公开，由企业微信调用，审计入库）

#### 用户绑定
- 在 `users.wechat_work_userid` 字段填入企业微信 userid 后，该用户才能接收通知
- 可通过 `PATCH /api/auth/users/:id { wechatWorkUserId }` 绑定

### 登录与权限（Phase 2a M1）
- JWT HS256，`JWT_SECRET` 必须 >= 16 位
- 密码 scrypt（N=2^15）加盐哈希
- 4 种角色：`admin`（甲方管理员）/ `tenant_admin`（乙方管理员）/ `specialist`（招生专员）/ `student`（学员）
- 公开路由：`/api/health`、`/api/auth/login`、`/api/lead-forms/*`、`/api/deposits`（POST/GET 单个 + webhook）、`/api/wechat-work/webhook/message`
- 其他路由均需 Bearer Token

#### 关键端点
- `POST /api/auth/login { username, password }` — 登录，返回 JWT
- `GET /api/auth/me` — 当前用户信息
- `POST /api/auth/change-password` — 修改密码
- `GET /api/auth/users` — 用户列表（admin 看全部，tenant_admin 看本租户）
- `POST /api/auth/users` — 创建用户
- `PATCH /api/auth/users/:id` — 更新用户（含 wechat_work_userid 绑定）

### 独立 H5 测评工具
访问 `http://localhost:3000/assessment?formId=1` 进入专业匹配测评（移动端优先）。
留资入口的链接也可以在「AI 获客 → 留资入口」一键复制。

### 学员自助端（手机号登录）
访问 `http://localhost:3000/portal` 进入学员自助端：
- 学员输入手机号 → 收到 6 位验证码（stub 模式：打印到服务器日志）
- 系统自动关联已有的 lead 记录，展示报读信息、缴费、材料、定金订单
- JWT token 存 sessionStorage（关闭浏览器后失效），与管理员 token 完全隔离
- 环境变量 `SMS_GATEWAY` 未设置时为 stub 模式；真实部署需接入阿里/腾讯短信 SDK（预留集成点）

### 多租户（Phase 3）
系统已在核心表（`users` / `deals` / `settlement_reports` / `leads` / `content_items` / `deposits` / `rpa_accounts` / `lead_forms`）补上 `tenant` 字段，默认 'default'。
- tenant_admin / specialist / student 角色查询与写入均按自己的 tenant 自动过滤
- admin 角色（甲方平台管理员，`tenant=platform`）可跨租户查看全局
- 接入新乙方的流程：创建 tenant_admin 用户（指定 tenant 名），乙方注册后的数据自动隔离
- 各业务写入自动继承当前用户的 tenant：
  - `POST /api/leads` — 继承调用者 tenant
  - `POST /api/content/reviews` — 继承调用者 tenant
  - `POST /api/deposits` — 继承关联 lead 的 tenant（或学员提交时关联的 lead）
  - `POST /api/lead-forms/:id/submit` — 留资 lead 继承表单 tenant
  - Worker fetch_dm 创建的 lead 继承 rpa_account tenant

### 平台总控台（仅 platform admin 可见）
甲方管理员（`role=admin + tenant=platform`）登录后，侧边栏会多出「平台总控台」入口：
- 各乙方对比卡片（线索 / 成交 / 应分成 / 未结 / 疑似异常 / RPA 账号状态）
- 近 30 天线索 + 成交趋势图
- 系统健康面板（内容待审、RPA 任务失败、24h 审计写量、合规未复审数）
- 全部数据只读，不用于操作，专为甲方决策使用

#### 相关端点
- `GET /api/platform/overview` — 聚合数据（仅 admin）
- `GET /api/platform/trend` — 近 30 天趋势

### 电话辅助 AI（Spec 模块三落地）
线索转化工作台的右侧浮层，切到「电话联系」后新增**电话前 AI 准备区**：
- 一键调用 `/api/ai/student-profile` 生成：
  - 学员画像：意向专业 / 主要顾虑 / 当前阶段 / 决策关键
  - 电话准备：开场话题 / 沟通要点 / 异议处理（Q&A 对） / 收尾动作
- 通话结束后录入「通话结果」文本，一键填入跟进记录表单，保留下来的电话记录会成为下次 AI 画像的历史输入

### 企业微信客户联系（Phase 4）
当配置了 `WECHAT_WORK_CONTACT_SECRET` 后，可以从企业微信批量同步外部联系人到 leads 表：
- 前端入口：经营管理 → 企业微信 Tab → 外部联系人同步
- 选择「全部授权员工」或指定员工
- 后端调用 `externalcontact/get_follow_user_list` + `externalcontact/list` + `externalcontact/get`
- 已存在（按 `source='企微客户' + contact=externalUserid + tenant` 去重）的跳过
- 新建 leads 自动继承调用者 tenant，`source='企微客户'`，`intent='medium'`，`assignee` 为对应企微员工 userid

#### 相关端点
- `GET /api/wechat-work/follow-users` — 列出已授权的员工 userid
- `POST /api/wechat-work/contacts/sync` — 批量同步（可选 userId 指定单个员工）

### Docker 部署（v2.2）
本仓库根目录提供了完整的容器化方案：三阶段构建（server / worker / frontend-nginx）。

#### 快速启动（目标部署机器，≥ 2G 内存）
```bash
cp .env.docker.example .env
# 填入 GEMINI_API_KEY / JWT_SECRET / RPA_COOKIES_SECRET（必填）

# 首次启动要注入 seed
ENABLE_DB_SEED=true docker compose up -d
sleep 10  # 等待 server 健康检查通过

# 正常模式（关掉 seed 避免重复注入）
sed -i '' 's/ENABLE_DB_SEED=true/ENABLE_DB_SEED=false/' .env
docker compose restart
```

#### 服务拓扑
- `admissions-frontend`（nginx:alpine）对外 80 端口，提供前端静态文件 + `/api/*` 反代
- `admissions-server` 只对 frontend 暴露 8787，healthcheck 30s
- `admissions-worker` 只连 SQLite，处理作业队列
- 共享 `./docker/data`（SQLite 库）、`./docker/logs`（日志）、`./docker/certs`（微信支付证书）三个卷

### CI（GitHub Actions）
`.github/workflows/ci.yml` 在 PR 和 main 推送时运行：
- TypeScript 类型检查（`npm run lint`）
- 三个 Docker 镜像构建（不推送，仅验证 Dockerfile 可 build）
- 所有步骤带 GHA 缓存，首次 10 分钟，后续 2-3 分钟

### Prometheus + Grafana 监控（v2.2）
- `GET /api/metrics` 暴露 Prometheus 文本格式指标（可选 `METRICS_BEARER_TOKEN` 环境变量保护）
- 指标包括：作业队列（按 name/status）、RPA 任务（按 platform/status）、线索（按 tenant/status）、成交分成（按 tenant/status）、AI 调用频次、定金订单、账号登录态、审计写入速率

#### 接入示例
```yaml
# prometheus.yml 片段（完整模板见 docker/prometheus.yml）
scrape_configs:
  - job_name: admissions
    metrics_path: /api/metrics
    static_configs:
      - targets: ["server:8787"]
```

Grafana dashboard JSON 模板见 `docker/grafana-dashboard.json`，**直接导入即可**。

### 定金催付（v2.2）
学员通过 H5 测评留资后，系统自动入队一个 24h 后的催付提醒作业：
- 若学员已支付定金 → 自动跳过（status=paid 校验）
- 若未支付 → 通过企业微信推送给该 lead 的 assignee（没有则广播甲方管理员）
- 每轮提醒后自动入队下一轮，节点：**1 天 / 3 天 / 7 天 / 14 天**
- 第 4 次提醒后停止（避免骚扰）
- 任一时刻学员支付后所有未来提醒自动终止

### SMS 网关（v2.2）
学员自助端登录的验证码现在可接真实短信：
- 默认 stub 模式（打印到日志）
- 配置 `ALIYUN_SMS_*` 环境变量后自动切到阿里云 SMS（HTTP API + HMAC-SHA1 签名，Node 原生实现无 SDK 依赖）

#### 环境变量
- `ALIYUN_SMS_ACCESS_KEY_ID`
- `ALIYUN_SMS_ACCESS_KEY_SECRET`
- `ALIYUN_SMS_SIGN_NAME` — 已备案的签名
- `ALIYUN_SMS_TEMPLATE_CODE_OTP` — 验证码模板 ID，变量 `${code}` 与 `${ttl}`

### AI 数字员工（Phase 5 · v3.0）
对标 **Manus AI / Claude Cowork / ChatGPT Agent**。告别「你按按钮我干活」，进化成「你下指令 AI 自己干」。

#### 使用流程
1. 管理后台 → 🤖 AI 员工 → 新建任务
2. 选择预置模板（每日内容冲刺 / 高意向线索扫描 / 周度经营报表）
3. Agent 自动拉数据 → 生成方案 → 合规扫描 → 提交审核队列
4. 关键动作（发布内容 / 发企微消息 / 更新状态）会**暂停等待审批**
5. 审批通过 → 继续执行；拒绝 → 任务取消

#### 预置模板
- **daily_content_sprint** 每日内容冲刺：生成 N 条内容、合规扫描、入审核队列
- **lead_followup_sweep** 线索扫描：找高意向未跟进 → 生成话术 → 推送专员
- **weekly_report** 周度报表：聚合数据 → AI 摘要 → 推送管理员

#### 架构
- **Agent Runtime**：Gemini Function Calling + ReAct 循环 + 15 个 tools
- **硬约束**：20 步 / 30 分钟 / 5 次审批 / 10 万 token
- **轨迹全留痕**：`agent_steps` 表记录每一步 role/tool_call/tool_result/approval

详见 [Execute_Plan/Agent-Architecture.md](../Execute_Plan/Agent-Architecture.md)。

#### 关键端点
- `GET /api/missions/templates` — 任务模板
- `POST /api/missions` — 创建任务
- `GET /api/missions/:id/steps` — 任务轨迹
- `POST /api/missions/:id/approve` — 批准待审批步骤
- `POST /api/missions/:id/reject` — 拒绝并取消任务
- `POST /api/missions/:id/cancel` — 手动取消

### 异步作业队列（Phase 4）
Worker 现在基于通用 `jobs` 表运行：
- 周期性任务通过 `scheduleRecurringJobs()` 每 60 秒自动入队（带 singletonKey 防重复）
- 作业执行失败自动指数回退重试（最多 3 次，最大间隔 30 分钟）
- 注册的 handler：
  - `schedule.fetch_dm` — 每 10 分钟为已登录账号生成 fetch_dm 任务
  - `crawler.run_once` — 每 1 小时采集政策白名单
  - `rpa.health_check` — 每 24 小时检查 RPA 账号登录态
  - `browser.cleanup_idle` — 每 5 分钟回收空闲浏览器
  - `audit.cleanup` — 每 24 小时清理 60 天以上审计日志
  - `jobs.cleanup` — 每 24 小时清理 7 天以上已完成作业

#### 环境变量
- `JOB_TICK_INTERVAL_MS` (默认 10000) — 作业取出频率
- `RECURRING_SCHEDULE_INTERVAL_MS` (默认 60000) — 周期性任务入队检查频率

#### 监控端点
- `GET /api/platform/jobs` — 作业统计（queued/running/failed/succeeded24h）+ 最近 50 条历史（仅 admin）

### 内容日历 · 发布任务排期
内容工厂「内容日历」tab 顶部新增「待发布任务队列」：
- 列出所有 `status=queued` 且关联 content_id 的 RPA 发布任务
- 每个任务支持 ±1h / ±3h 微调时间（PATCH `/api/content/tasks/:taskId/schedule`）
- 过期任务高亮提示 Worker 会立刻执行

### Notes
- Frontend proxies `/api` requests to `http://localhost:8787`
- SQLite database defaults to `server/data/admissions.db`
- If AI features fail, first check `GEMINI_API_KEY` and whether the backend is running
- Seed data (协议、测试账号、采集源、测评表单) 在 `ENABLE_DB_SEED=true` 且对应表为空时注入
