# 变更记录

## [v3.4] - 2026-04-25 · 一线战斗力 + 续费保卫战 + 智能自愈

> **业务洞察**：v3.3 把甲方/乙方/学员视角都做厚了，但「专员」这个一线角色还是只有一个孤零零的待办列表。同时 v3.3.b 的健康分只是"显示"，没有"行动"。
> **本迭代一句话**：让系统从「显示数据」升级到「基于数据采取行动」。

### v3.4.a · 专员业绩仪表盘（一线战斗力）

- **后端 API**（`server/src/routes/dashboard.ts`）：`GET /api/dashboard/specialist-performance`
  - 拉本租户全部 specialist + tenant_admin 的业绩
  - 8 个维度：本月成交单数 / 学费总额 / 预估提成（默认 8%）/ 上月对比 / 环比 % / 本周成绩 / 高意向数 / 转化率
  - 提成率可配（`SPECIALIST_COMMISSION_RATE` 环境变量，0-1 之间，默认 0.08）
- **前端页面**（`src/components/SpecialistPerformance.tsx`）：
  - 顶部「我的本月」+「本月排名 #N」双卡，含 🥇🥈🥉 冠军 / 亚军 / 季军徽章
  - 团队总计 + 完整排行榜（按学费降序，本人行高亮 emerald）
  - 环比 % 红绿色变（增长 → emerald，下滑 → red）
- **HomePanel 升级**：specialist 角色登录后，顶部新增「本月预估提成 + 排名」teaser 卡片，可点跳转完整业绩榜
- **新增 NAV**：`业绩榜`（Trophy 图标）

### v3.4.b · 续费临界自动干预（续费保卫战）

- **新增定时 job**（`server/worker/job-handlers.ts`）：
  - `renewal.health_check_tick`：每月 15 号 09:00 触发（每小时 tick 检查日期+小时）
  - 扫每个租户最新 `monthly_value_statements`，`health_score < 55` 即入队 `renewal.push_intervention`
  - 阈值由常量 `RENEWAL_HEALTH_THRESHOLD = 55` 控制
- **干预内容**（`renewal.push_intervention`）：
  - 用「📊 小报」persona 第一人称写客户成功提醒
  - 根据 healthBreakdown 分项分诊：AI 调用低 / 转化率低 / 活跃天数低 / 线索环比下滑 → 各对应一条具体建议
  - 推送到该租户 admin/tenant_admin 的企微 userid
- **闭环逻辑**：v3.3.b 月初 1 号生成账单 → v3.4.b 月中 15 号若健康分 < 55 主动干预，给老板 2 周时间挽救

### v3.4.c · 智能重试（mission 自愈）

- **错误分类器**（`server/worker/error-classifier.ts`）：
  - `transient`：429 / rate limit / quota / 超时 / 网络抖动 / 5xx → 退避重试
  - `permanent`：4xx / 不存在 / 非法 / 未配置 / 未知 tool → 立即标失败，不浪费重试预算
  - 偏保守：未匹配模式默认 transient（错判 transient 多重试一次，错判 permanent 会让真实可恢复错误失败）
- **job-queue 联动**（`server/worker/job-queue.ts`）：
  - `markFailed` 调 `classifyError`，permanent 直接 `status='failed'` 即使还有 attempts 余量
  - 日志多打 `category` 字段，便于排查
- **agent.run_mission 改造**：
  - 之前 catch 后吞掉错误返回 success → 现在 transient 抛出让 job-queue 退避重试，permanent 标 failed 返回
  - `maxAttempts` 全部从 1 → 3（quick-start / mission 创建 / 定时调度三处）
- **效果**：Gemini 限流、网络抖动这种偶发故障从「mission failed 老板手动重启」变成「系统自动退避重试 → 多数 5 分钟内自愈」

### 度量目标

- **v3.4.a**：60 天后专员人均 mission 触发数 ≥ 上月 1.5 倍（业绩榜激发竞争）
- **v3.4.b**：触发干预的租户中 ≥ 30% 在下个月健康分提升 ≥ 1 个等级
- **v3.4.c**：mission 失败率（永久失败 / 总执行）≤ 2%，原始失败的 ≥ 70% 通过自动重试自愈

---

## [v3.3.c] - 2026-04-25 · 学员转介绍裂变（教育行业最大杠杆）

> **业务洞察**：教育行业获客最贵，但已成交学员推荐朋友的成本接近 0、转化率往往是冷流量的 5-10 倍。系统过去对推荐链路一无所知。
> **本迭代一句话**：让一个学员的成交，自动触发裂变机会。

### 新增

- **推荐码体系**（`server/src/services/referral-service.ts`）：
  - 8 位大写字母数字（去除 0/O/1/I 等易混淆字符），冲突重试 5 次
  - 仅 enrolled 学员可签发；同一 lead 永远复用同一推荐码（`issueOrGetReferralCode`）
  - `bindReferralOnLead` 在新 lead 创建时绑定 `referred_by_code`，含自荐保护
  - `triggerRewardOnDeal` 在成交时自动写入两条 reward 记录（推荐人 ¥200 + 被推荐人 ¥100，金额由 env 可调）
- **三层路由**（`server/src/routes/referrals.ts`）：
  - 公开 `GET /api/referrals/public/by-code/:code` — H5 测评页面解码推荐人姓名
  - 学员 `GET /api/student/referrals/me` — 取自己的推荐码 + 邀请/转化/已得奖励
  - 后台 `GET /api/referrals/{stats,rewards,codes}` + `POST /rewards/:id/mark-paid` — 转介绍管理页
- **AssessmentTool 链路**（`src/components/AssessmentTool.tsx`）：
  - URL 参数 `?ref=CODE` 自动校验 + 解码出推荐人姓名
  - 顶部展示「你正被 XXX 邀请」鼓励横幅
  - 提交时附带 `referralCode` 字段
- **学员端「我的推荐码」**（`StudentPortalEntry` 新增 `ReferralWidget`）：
  - enrolled 学员看大字推荐码 + 一键复制邀请文案 + 邀请/转化/累计奖励三宫格
  - 未到 enrolled 时显示「待解锁」预告卡片
- **后台「转介绍」页面**（`src/components/ReferralCenter.tsx`）：
  - 6 大顶部指标 + 奖励流水/推荐码列表两个 tab
  - 奖励状态过滤（全部/待发放/已发放）+ 一键「标记已发」
  - 推荐码列表按转化数排序（看哪些学员"出货"最多）
- **deals 创建时自动钩子**：成交记录创建后调用 `triggerRewardOnDeal(dealId)`，失败不阻塞主流程
- **价值账单联动**：v3.3.b 的「上月价值账单」会单独标出「转介绍贡献 X 条线索（0 成本获客）」

### 数据库

新增三个表：

- `referral_codes`：tenant + code（唯一）+ referrer_lead_id + invited_count + converted_count
- `referral_rewards`：tenant + code_id + referrer/referee_lead_id + deal_id + reward_for + amount_fen + status (pending/paid/voided)
- `leads.referred_by_code`：被推荐人携带的码字符串（不强制 FK，允许冷数据导入）

### 开关与配置

- `REFERRAL_REFERRER_REWARD_FEN`：推荐人单笔奖励，默认 20000（¥200）
- `REFERRAL_REFEREE_REWARD_FEN`：被推荐人单笔奖励，默认 10000（¥100）

### 度量目标

- 上线 60 天后：转介绍线索数占新增线索 ≥ 15%
- 转介绍线索 → 成交转化率 ≥ 普通线索的 1.5 倍
- 已签发推荐码的成交学员占比 ≥ 70%（ReferralWidget 触达率）

---

## [v3.3.b] - 2026-04-25 · 月度价值账单（续费率防御工事）

> **业务洞察**：30% 分成是契约数字，但乙方每月看不到「我付了 X，平台给我创造了 Y」的对账。SaaS 续费率第一杀手是「价值不可见」。
> **本迭代一句话**：每月 1 号，系统自动给老板交一份「ROI 账单 + 续费健康分」。

### 新增

- **价值账单生成器**（`server/src/services/value-statement-generator.ts`）：
  - 聚合上月 12 项指标（线索 / 高意向 / 转介绍 / 成交 / 学费 / 分成应付已付 / 内容 / AI 任务 / 自动审批 / 节省人力 / 活跃天数）
  - 计算续费健康分（4 个加权维度，0-100）：
    - **增长 30%**（环比线索增长率）
    - **转化 25%**（线索→成交转化率，10% 即满分）
    - **AI 投入 20%**（mission 数量密度，封顶 100）
    - **活跃 25%**（本月有写入操作的天数）
  - 评级 S/A/B/C/D 分别有差异化的鼓励/警示话术
  - Gemini 可用走 AI 叙事（强调 ROI / 给"内容阅读"穿场景），不可用走规则模板兜底
  - UPSERT 同月幂等，可重算
- **三个 API**（`server/src/routes/dashboard.ts`）：
  - `GET /value-statement/latest` 取最新一月
  - `GET /value-statement/list?limit=12` 取最近 12 个月历史
  - `POST /value-statement/generate { period? }` 手动重算（默认上月）
- **月初自动推送**（`server/worker/job-handlers.ts`）：
  - 新增 recurring job `value_statement.monthly_tick`（每小时检查一次，命中 1 号 09:00 才入队）
  - 命中后为每个活跃租户入队 `value_statement.push_one` 单租户作业
  - 推送到该租户 admin/tenant_admin 的企微 userid，文本包含健康分 + 营收/分成 + 完整叙事
- **HomePanel 速览卡片**（`src/components/HomePanel.tsx`）：
  - 仅 tenant_admin 显示，从 BriefingCard 下方
  - 一行：「2026-03 · 营收 ¥XX · 应付分成 ¥YY · ROI N.Nx · 健康分 80 / A」
  - 整卡可点击 → 跳转 value-statement 详情页
- **价值账单详情页**（`src/components/ValueStatementPanel.tsx`）：
  - 顶部主卡片：渐变背景 + 健康分大徽章 + Gemini 叙事正文
  - 12 项数据指标卡（含环比箭头 + "0 成本"等小徽章）
  - 健康分四维度构成进度条
  - 历史账单列表（最多 12 个月，可点击切换查看任一月）
  - 一键「重算上月账单」按钮
- **新增 NAV**：`价值账单`（Receipt 图标）

### 数据库

新增 `monthly_value_statements` 表：tenant + period（YYYY-MM 唯一）+ 18 个聚合字段 + breakdown_json + narrative + pushed_at。

### 开关与配置

无新 env。复用 v3.0 的 `GEMINI_API_KEY`、v3.2 的 wechat-work 配置。

### 度量目标

- 月度账单送达率 ≥ 95%（成功推送企微的租户占活跃租户）
- 续费健康分 ≥ B 级的租户续费率 ≥ 90%
- 三个月内：80% 的租户至少打开过一次价值账单详情页（衡量"价值可见"是否真的传到位）

---

## [v3.3.a] - 2026-04-24 · AI 员工人格化 + 乙方老板视角

> **业务洞察**：v3.2 把系统压到 5 分钟/天，但乙方老板登录后看到的仍是技术视图（mission 列表、审核队列），视角错位。
> **本迭代一句话**：给 AI 员工起名字、给老板写第一人称战报、让 Day-1 空数据也有故事讲。

### 新增

- **AI 员工人格化体系**（`server/src/services/agent-personas.ts`）：
  - 三位数字同事：🎯 **小招**（招生内容官）/ 🕸️ **小线**（线索雷达员）/ 📊 **小报**（经营分析师）
  - 每位有 `name` / `avatar` / `role` / `tagline` / `tone` / `signature`，可驱动 Gemini prompt 和 UI 渲染
  - Mission template 新增 `personaId` 字段绑定岗位归属（`daily_content_sprint → xiaozhao` 等）
  - `getPersonaForMission(type)` 给任意 mission type 返回 persona，未匹配降级到 `xiaozhao`

- **今日战报生成器**（`server/src/services/briefing-generator.ts`）：
  - `collectTenantStats(tenant)` 聚合 24h 核心指标（12 项：leadsNew / leadsHighIntentNew / contentDrafted / contentApproved / contentPublished / missionsRun / missionsSucceeded / missionsFailed / autoApproved / dealsLast7d / rpaLoggedIn / dmsScanned）
  - `generateBriefing(tenant)` 用 Gemini 生成小报口吻的第一人称战报，80-200 字 Markdown
  - Gemini 不可用时自动降级到 `buildTemplate`（基于规则的模板化文案，保证 Day-1 就有故事）
  - UPSERT 到 `tenant_briefings` 表（tenant + date 唯一），同日只保留一份
  - 空数据时诚实汇报："今天数据是 0，我明天加把劲"，避免空洞的正向话术

- **新表 `tenant_briefings`**：
  - `id / tenant / date / narrative / stats_json / persona / source (ai|template) / pushed_at / generated_at`
  - `UNIQUE(tenant, date)` 保证同日幂等
  - 加了 `idx_tenant_briefings_tenant_date` 索引

- **新 API 端点**：
  - `GET /api/dashboard/tenant-briefing/latest` · 返回本租户最新战报 + 完整 persona 元数据
  - `POST /api/dashboard/tenant-briefing/generate` · 手动触发本租户战报生成
  - `GET /api/dashboard/agent-personas` · 返回所有 persona 元数据（前端用）

- **每日 19:00 自动推送战报到企微**：
  - 新 mission template `daily_briefing`（绑定 xiaobao）
  - `agent_schedule_configs` seed 第 4 条：`daily_briefing · 每日 19:00 · 默认禁用`
  - 对已有数据库有幂等迁移（`INSERT OR IGNORE`）
  - Worker 新增 job handler `agent.daily_briefing_push`：调用 `generateBriefing` + 推送到本租户 admin/tenant_admin 的 `wechat_work_userid`
  - `agent.daily_schedule_tick` 特判 `daily_briefing` 类型：不创建 `agent_missions` 行，直接入推送队列（不消耗 agent runtime 资源）

- **HomePanel 升级**（乙方老板视角）：
  - 顶部新增「BriefingCard」卡片：带小报头像、岗位徽章、AI/规则生成来源徽章、第一人称叙事正文、12 项关键数字摘要
  - 无战报时显示「让小报出一份」按钮，点击调用生成接口
  - QuickActions 的 mission 带 persona 头像前缀（🎯 小招：生成今日 3 条内容）
  - QuickActions 增加「出一份今日战报」入口（daily_briefing）

- **AgentWorkspace 升级**：
  - Mission 详情卡片左侧新增 persona 头像圆（10×10，emerald 边框）
  - 标题右侧新增 persona 徽章（如「小招」）
  - `MISSION_TYPE_LABELS` 加入 `daily_briefing: '今日战报'`

- **quick-start 路由特判 daily_briefing**：
  - 不走 agent runtime，直接入 `agent.daily_briefing_push` 队列
  - 返回 202 Accepted + `async: true`，告知前端几秒后刷新即可

### 修复
- `agent-tools.ts` 两处 `parameters` 枚举字段缺失 `description` 的 TS 错误（v3.2 遗留）

### 度量目标（v3.3.a）
- 乙方老板 Day-1 满意度：登录看到 AI 员工有名字 + 即使零数据也有友好汇报 → 首周流失率预期降 30%
- 续费参考：每日 19:00 的战报推送 → 被动触达率从 0 提升到 100%（有 wechat_work_userid 的租户）
- 产品情绪价值：mission 列表从"工具"升级为"同事"，差异化对标 Manus / Claude Cowork

---

## [v3.2] - 2026-04-24 · 准无人值守版

> 目标：把日常运营人力压到 **每天 5 分钟**，逼近"零人干预"但不违反合规底线。
> 对应文档：[Execute_Plan/Zero-Touch-Operations.md](./Execute_Plan/Zero-Touch-Operations.md) · [Execute_Plan/Post-Deploy-24h-Checklist.md](./Execute_Plan/Post-Deploy-24h-Checklist.md)

### 新增

- **方案 A · 自动审批白名单**：
  - `ToolDefinition` 新增 `autoApprove?: (args, ctx) => AutoApprovalDecision` 字段
  - 3 个 `write_high` tool 写了自动审批规则：
    - `submit_content_for_review`：合规扫描通过 + 标题长度合法 + 平台合法 → 自动通过（需 `AUTO_APPROVE_CONTENT=true`）
    - `send_wechat_notice`：内部 admins 广播 + 纯文本（无链接/手机号/微信号）→ 自动通过（需 `AUTO_APPROVE_WECHAT_INTERNAL=true`）
    - `update_lead_status`：仅前向迁移到 `contacted` / `following` → 自动通过（需 `AUTO_APPROVE_LEAD_STATUS=true`）
  - `agent-runtime.ts` 消费 autoApprove 决策：命中时跳过 `waiting_approval`，直接执行，step 标记 `approved_by=-1 + approved_at=now`
  - Step content 记录「[自动审批] 合规通过 + 平台合法」或「[规则未命中] 原因」用于审计
  - 前端 StepCard 显示「🤖 自动批准」蓝色徽章（人工批准是绿色「✓ 已批准」）

- **方案 B · AI 员工定时自启动**：
  - 新表 `agent_schedule_configs`（tenant / mission_type / cron_hour / cron_weekday / enabled / last_triggered_at）
  - 默认 seed 3 条（全部 **disabled**，用户手动开）：
    - daily_content_sprint · 每日 08:00
    - lead_followup_sweep · 每日 09:00
    - weekly_report · 每周一 20:00
  - Worker 新增 `agent.daily_schedule_tick` 作业，每 5 分钟检查配置命中情况；同一小时内不重复触发；支持星期过滤
  - 新增 `GET /api/missions/schedules/list` + `PATCH /api/missions/schedules/:id`（仅 admin/tenant_admin）
  - 前端 AgentWorkspace 底部新增「定时自动化」卡片：显示启用状态、cronHour 直接编辑、一键启用/禁用

- **部署后 24 小时自检清单** [Execute_Plan/Post-Deploy-24h-Checklist.md](./Execute_Plan/Post-Deploy-24h-Checklist.md)：
  - T+0 / T+2 / T+6 / T+12 / T+24 五个时点 + 每个时点要做什么
  - 红色警戒指标清单（5 项出现任一必排查）
  - 通过清单 10 项

- **零人力运营极限挑战方案** [Execute_Plan/Zero-Touch-Operations.md](./Execute_Plan/Zero-Touch-Operations.md)：
  - 三档运营模式（谨慎/平衡/激进）详细对比
  - 🟡 平衡档端到端日流程（每天 5 分钟）
  - 🔴 激进档额外配置候选（未实现项目录）
  - 3 条紧急刹车方案
  - 零人力健康度月度打分表（9 项 90 分制）

### 修改

- `server/src/services/agent-tools.ts`：ToolDefinition 类型扩展
- `server/worker/agent-runtime.ts`：tool_call step 路径加入 autoApprove 检查
- `server/worker/job-handlers.ts`：RECURRING_JOBS 新增 `agent.daily_schedule_tick`
- `src/components/AgentWorkspace.tsx`：顶部加 ScheduleSection；StepCard 识别 `approved_by=-1` 显示自动批准徽章
- `src/components/AgentWorkspace.tsx` 导入 CalendarClock 图标

### 安全

- 自动审批规则的条件是**白名单**形式，未命中规则默认走人工审批（失败更安全）
- 自动审批时记录完整决策原因到 step.content，便于事后审计
- `approved_by=-1` 是特殊标记，permanent admin 或真实用户 ID 均不可能等于 -1，不可伪造
- 定时触发命中后会检查"同一小时内是否已触发过"，避免 Worker 重启后重复入队
- 所有自动化触发的 mission 带「[定时]」前缀，在 UI 上一眼能看出来

### 原因

v3.1 解决了「体验」问题（HomePanel / 软转化 / 新手引导）。
v3.2 解决「时间」问题 —— 让系统**可以自己跑**，不依赖人站在系统前面点按钮。

但**故意保留审批护栏**：
- 外部消息发给学员仍需审批（怕发错）
- 迁到 enrolled/lost 状态仍需审批（影响分成统计）
- 退款 / 定金操作仍需审批（涉及钱）

合规底线不能让步，不能说"为了零人力就全开自动"。

### 度量目标

- 日常运营人力：v3.1 的 15 分钟 → v3.2 的 **5 分钟**（平衡档）
- 周运营总时长：105 分钟 → **35 分钟**
- AI 任务创建频率：3-5 次/周 → **21 次/周**（每天自动 3 次）
- 内容产出：从「人记得生成」升级到「8 点自动生成」，稳定性从 70% → 99%

---

## [v3.1] - 2026-04-24 · 产品打磨版（业务专家视角）

> 代入 4 种角色（甲方老板 / 乙方老板 / 招生专员 / 学员）把系统用了一遍，识别 Top 14 体验漏洞。本版落地其中 5 项高优先级打磨。
> 详见 [Execute_Plan/User-Journey-Playbook.md](./Execute_Plan/User-Journey-Playbook.md)。

### 新增

- **用户旅程手册 [Execute_Plan/User-Journey-Playbook.md](./Execute_Plan/User-Journey-Playbook.md)**：四角色深度代入 + Top 14 体验漏洞 + 打磨优先级
- **角色化 Home**（解决漏洞 #1 #2 #3 #8）：
  - 新端点 `GET /api/dashboard/home`：按 `platform_admin` / `tenant_admin` / `specialist` 三角色返回不同首屏结构
  - 字段：`headline / highlights / topActions / aiSummary / quickActions / todayTodos`
  - 专员首屏返回「今日要跟进 Top 10」，按意向等级 + 下次跟进时间排序
  - 乙方管理员首屏返回「高意向未转化 / 内容待审 / AI 待审批 / RPA 账号健康」四类行动卡
  - 甲方管理员首屏返回「应收分成 / 未结 / 疑似异常 / AI 员工日产出」
- **AI 任务快捷入口**（解决漏洞 #7 #10）：
  - 新端点 `POST /api/missions/quick-start`：用模板默认参数一键创建 mission，免填 JSON
  - Home 卡片 + AgentWorkspace 顶部显示 3 个一键按钮
- **H5 测评三档漏斗**（解决漏洞 #11 #12）：
  - 🥇 锁定定金 500 元（原有）
  - 🥈 加顾问微信领完整 PDF（软转化，记录到 followups + intent 自动升级为 high）
  - 🥉 订阅政策提醒（最弱转化，只写跟进记录）
  - 新端点 `POST /api/lead-forms/soft-cta`：记录软转化意向
- **内容效果回流**（解决漏洞 #4）：
  - 新端点 `PATCH /api/content/records/:id/metrics`：管理员手工/AI 录入浏览 / 点赞 / 评论 / 带来线索数
  - 租户隔离 + 仅 published 状态内容可编辑
- **乙方新手引导 checklist**（解决漏洞 #5）：
  - 新端点 `GET /api/dashboard/onboarding`：7 项完成度检查 + 每项带跳转路径
  - 前端 HomePanel 自动识别 tenant_admin 未完成时顶部显示渐变引导卡，带进度条

### 修改

- `src/components/HomePanel.tsx` 新组件：嵌入 dashboard tab 顶部，角色识别 + 指标卡 + topActions + AI 摘要 + 一键启动 + 专员今日待办
- `src/components/AgentWorkspace.tsx` 顶部新增「一键交给 AI」3 卡快捷区
- `src/components/AssessmentTool.tsx` 的报告页底部改为三档漏斗按钮（原来只有一个定金按钮）
- `src/App.tsx` HomePanel lazy 导入 + 嵌入 dashboard（保留原 stats grid 作为详细视图）
- 「新建任务」按钮文案改为「自定义任务」，突出快捷入口是主推

### 安全

- soft-cta 端点公开，但做了手机号格式 + action 枚举校验
- 效果指标 patch 需要登录 + 租户隔离
- onboarding 端点按 tenant 过滤检查项

### 原因

产品已经有 17+ 个一级导航、25+ 个 API、15 个前端组件。但四角色代入后发现：
- **老板要的是摘要，看到的是运营看板**
- **专员要的是今日待办，看到的是全部线索**
- **学员要的是下一步，看到的是 500 元支付按钮**
- **新乙方没有任何引导**

功能够了，缺的是「**每个角色打开系统后的第一眼，看到对自己最重要的东西**」。
v3.1 就是解决这件事。

### 度量目标

| 指标 | 目标 |
|------|------|
| 专员每日使用时长 | +100%（10-20min → 30-40min）|
| AI 任务创建频率 | +150%（1-2 次/周 → 3-5 次/周）|
| H5 测评 → 后续动作 | +500%（5% → 30%）|
| 乙方接入 7 天留存 | 80%+ |
| 内容 → 线索归因可见率 | +125%（40% → 90%）|

### 不做（留 v3.2+）

- 漏洞 #6：信息架构大重组（工程量大）
- 漏洞 #9：线索详情页 Tab 内嵌 AI（改动面大）
- 漏洞 #13 #14：学员端主动触达（Phase 6 公众号/短信）
- 漏洞 #2 AI 日报自动生成：依赖 weekly_report 跑出真实数据后再做

---

## [v3.0] - 2026-04-24 · AI 数字员工 MVP

**升级定位**：从「工具集合」升级到「AI 数字员工」。对标 Anthropic Claude Cowork（Computer Use）+ Manus AI（被 Meta 20-30 亿美金收购）+ OpenAI ChatGPT Agent 三大明星产品。

### 新增

- **Agent 架构文档** [Execute_Plan/Agent-Architecture.md](./Execute_Plan/Agent-Architecture.md)：分层图、数据模型、Tool 分类、ReAct 状态机、安全边界、与 Manus/Claude 的对标选型
- **Agent 数据模型**：
  - `agent_missions` 表（任务）：tenant / type / title / goal_json / status / step_count / approval_count / summary
  - `agent_steps` 表（轨迹）：role / tool_name / tool_args_json / tool_result_json / needs_approval / approved_by / rejected_reason
- **Tool 注册层** `server/src/services/agent-tools.ts`：15 个 tool 分 5 类
  - `read`（6 个）：query_leads / query_dashboard_summary / query_deals_summary / query_rpa_accounts / query_schools / query_jobs_stats
  - `analyze`（3 个）：generate_content_draft / compliance_scan / suggest_reply_script
  - `write_low`（1 个）：add_lead_note
  - `write_high`（3 个 · 需审批）：submit_content_for_review / send_wechat_notice / update_lead_status
  - `terminal`（2 个）：finish_mission / give_up_mission
- **Agent Runtime** `server/worker/agent-runtime.ts`：ReAct 循环 + Gemini Function Calling + 轨迹重放 + 审批暂停；上限 20 步 / 30 分钟 / 5 次审批 / 10 万 token（硬约束）
- **预置任务模板** `server/src/services/mission-templates.ts`：
  - `daily_content_sprint` — 每日 3 条内容冲刺（拉素材 → 生成 → 合规扫描 → 提交审核）
  - `lead_followup_sweep` — 高意向线索扫描（查询 → 生成话术 → 企微推送给专员）
  - `weekly_report` — 周度经营报表（聚合 dashboard / deals / 异常 → AI 摘要 → 推送管理员）
- **Missions API** `server/src/routes/missions.ts`：6 个端点
  - `GET /templates` 列模板
  - `GET /` 列任务（按 tenant 过滤）
  - `POST /` 创建任务（自动入队 `agent.run_mission` 作业）
  - `GET /:id` + `GET /:id/steps` 任务详情 + 轨迹
  - `POST /:id/approve` 批准待审批步骤（自动入队 `agent.execute_approved_step`）
  - `POST /:id/reject` 拒绝审批（mission → canceled）
  - `POST /:id/cancel` 手动取消任务
- **Worker 作业 handler**：
  - `agent.run_mission` 执行 mission 直到终止/暂停
  - `agent.execute_approved_step` 审批通过后执行被卡住的 tool + 继续 runtime
- **前端 AgentWorkspace** `src/components/AgentWorkspace.tsx`：
  - 新一级导航「🤖 AI 员工」（排在数据看板之后，内容工厂之前）
  - 左侧任务列表（带状态图标 + 步数 + 审批次数 + 摘要/错误）
  - 右侧任务详情（目标 JSON + 审批面板 + 执行轨迹可展开查看每步 args/result）
  - 新建任务模态框（3 个模板选择 + 目标 JSON 编辑器）
  - 活动任务每 5 秒自动刷新，任务状态实时可见

### 修改

- `server/src/index.ts` 挂载 `/api/missions` 路由（admin/tenant_admin 可创建，全员可查看本租户）
- `server/worker/job-handlers.ts` 新增 2 个 agent 作业 handler
- `src/constants.ts` 新增「🤖 AI 员工」导航项，位置在数据看板之后
- `src/App.tsx` 集成 AgentWorkspace 路由
- `Product-Spec-V3-Roadmap.md` 标注 Phase 5 MVP 已超前完成，AI 电话外呼从 Q1 2027 提前到 Q4 2026

### 安全

- Gemini 只能调用**注册过**的 tool，未知 tool 直接拒绝并记录错误
- 高风险 tool（`write_high`）**必须**触发 waiting_approval，不可绕过
- 每个 mission 硬约束：20 步 / 30 分钟 / 5 次审批上限，超过自动 failed
- Tool 调用严格走 tenant scope，跨租户数据默认 404
- Agent 产生的所有数据库写入自动继承 mission.tenant
- 审批动作记录 approved_by 和时间戳，可审计

### 原因

联网调研表明（2026-04）：
- **Manus AI**（Butterfly Effect 出品，Monica 团队）以「My Computer 桌面代理」+ 多 agent 编排月活 2200 万、ARR 1 亿美金、被 Meta 20-30 亿美金收购
- **Claude Cowork**（Anthropic 2026-03-23 发布）：直接操作桌面，多步工作流无人介入
- **ChatGPT Agent**：OpenAI 自主工作区代理

三者共同特征：**目标驱动 + 工具编排 + 长时运行 + 人在回路 + 轨迹可见**。

招生全流程天然契合这一范式：
- 内容生成 / 审核 / 发布 / 跟进 / 报表都是多步协调
- 成人教育转化窗口 3-7 天，专员是稀缺资源
- 合同分成模式的终极形态：AI 干活，专员只批关键动作

### 不做（明确排除）

- ❌ 自定义 mission 类型（仅 3 个预置模板，v3.1 再开）
- ❌ 真实时流式 SSE（前端 5 秒轮询够用）
- ❌ Agent 自主浏览网页（不做 Computer Use 级别）
- ❌ 跨 mission 长期记忆（v3.1+）
- ❌ 多 agent 协作（v3.2+）

### 验收

- [x] 通过 API 创建 `daily_content_sprint` 任务
- [x] Worker 拉起并进入 `running`
- [x] 触发 `submit_content_for_review` 时 mission 自动进入 `waiting_approval`
- [x] 管理员 approve 后任务继续
- [x] 最终 `status=succeeded`，前端可见完整轨迹

### 里程碑

v3.0 是整个 Product Spec 的**质变版本**：
- v1.x → v2.x：把「合同里写的能力」全部代码化（Spec 驱动）
- v2.x → v3.0：把「AI 的真正形态」带入系统（对标明星产品驱动）

自此系统是一个真正意义上的 **AI 招生员工**，而不只是「有 AI 功能的系统」。

---

## [v2.3] - 2026-04-24

### 新增
- **竞品深度分析文档 [Execute_Plan/Competitive-Analysis.md](./Execute_Plan/Competitive-Analysis.md)**：基于 2026-04 联网调研，对标 SCRM Top 5（腾讯企点 / 微伴助手 / 沃丰微丰 / 粮仓 / 快鲸）+ 知识付费 Top 3（创客匠人 / 海豚知道 / 阔知 EduSoho）+ 垂类招生系统（翼程 / 华祺 / 中教）；完整 SWOT + 功能对标矩阵 + 监管边界 + Top 10 提升清单
- **根目录 [PITCH.md](./PITCH.md)**：30 秒 / 3 分钟 / 差异化三句话 / 对比表 / FAQ 速答 / 三档合作报价 / 销售 memo
- **平台合规二次扫描器** `server/src/services/platform-compliance.ts`：
  - 站外导流检测（微信号 / QQ / 手机号 / 扫码 / "加微信"等正则模式）
  - 夸大效果检测（"X 天过" / "零基础速成" / "内部名额" / "命题老师"等）
  - 软性警告（"99% 通过率" / "国家认证"等需证据支撑的表述）
- **违规词库扩展到 40+ 条**（原 9 条）：覆盖北京 / 江苏 / 长沙 / 四川 4 省 2025 年教培违法广告典型案例；含通过承诺 / 内部关系 / 虚假背书 / 夸大效果 / 隐性保证 / 紧迫感 / 考试机构直接引用 7 大类
- **监管速览 API**：`GET /api/agreements/compliance/bulletin`：返回小红书七大赛道治理、北京 / 江苏违规案例、一机一卡一号、5 分钟响应等 6 条关键风险 + 日常合规 Tips
- **合规中心前端新增「监管速览」卡片**：分风险等级展示（高 / 中 / 低）+ 来源链接 + 应对行动
- **KOS 员工激励模型**：
  - `rpa_accounts.operator_user_id` 字段（迁移）
  - `leads.source_account_id` 字段（迁移）
  - Worker 创建 lead 时自动写入归因链路
  - 新增 `GET /api/rpa/kos-ranking?period=today|week|thisMonth`：按员工聚合新线索 / 高意向 / 成交数 / 分成金额，tenant 过滤 + 周期切换
- **内容工厂合规预扫描端点**：`POST /api/content/compliance-scan`（供前端生成后预检）
- **内容审核入库时强制合规扫描**：命中 block 级违规直接拒绝入库并返回明细

### 修改
- **私信雷达扫描间隔从 30 分钟改为默认 5 分钟**（成人教育 3-7 天转化窗口需要快速首次触达）
  - 可通过 `FETCH_DM_INTERVAL_MS` 环境变量调整（1-60 分钟范围，自动 clamp）
  - runner.ts 的 dedup 窗口从 25 分钟改为 3 分钟（与新间隔匹配）
- **V3 Roadmap 重排**：AI 电话外呼从 Q4 2027 提前到 Q1 2027；新增 Q4 2027「账号矩阵 9→50 + KOS 自注册工作流」目标
- **Product-Spec.md 顶部新增 v2.3 状态快照**（虽然 v2.2 已加过，这版更新到 v2.3 能力集）

### 原因
- 联网调研发现 3 个关键市场信号：
  1. **成人教育转化窗口 3-7 天**：远短于 K12，5 分钟首次响应是行业标配 → 私信雷达 30 分钟太慢
  2. **小红书 2025-11 对七大教培赛道常态化治理**：学历提升类在内，站外导流严格禁止 → 需要平台合规二次扫描
  3. **头部 KOS 矩阵月入 2 万线索**（vs 我们 9 账号）：矩阵化是产量上限 → 优先级上调
- 2025 年 4 省公布教培违规广告典型案例，违规词库原 9 条太少，现扩展到 40+ 条覆盖全部处罚词
- SCRM Top 5 / 知识付费 Top 3 都没做"成交分成 + 审计 + 定金闭环"→ 这是我们独有护城河，需要在对外口径（PITCH.md）中明确强调
- KOS 员工激励是小红书 / 抖音规模化运营的成熟打法，但我们之前没做归因

### 安全
- 平台合规扫描在内容入库路径上强制执行，不可绕过
- 违规词库扩展后审计日志自动记录"命中哪条规则"
- 监管速览的外部链接使用 `rel="noopener noreferrer"` 防止钓鱼

### 竞争力提升
完成竞品分析 Top 10 改进清单中的 7 项「即可做」：
- ✅ 违规词库扩展到监管最新处罚案例全集
- ✅ 小红书合规二次扫描（七大赛道 + 站外导流）
- ✅ 5 分钟响应机制（私信雷达间隔可配置）
- ✅ KOS 员工激励归因模型
- ✅ 合规速览模块
- ✅ 根目录 PITCH.md（对外话术统一）
- ✅ V3 Roadmap 升级（AI 外呼提前）

剩余 3 项（账号矩阵扩到 50 / 短视频脚本 / 企微会话存档）留到后续。

---

## [v2.2] - 2026-04-23

### 新增
- **Docker 三阶段容器化部署**：
  - 根目录 `Dockerfile` 三 target：server / worker / frontend（nginx）
  - `docker-compose.yml` 编排三服务 + 共享数据卷 + healthcheck
  - `docker/nginx.conf` 前端 SPA fallback + `/api/` 反代 + 静态资源 30d 缓存
  - `docker/prometheus.yml` scrape 配置模板
  - `docker/grafana-dashboard.json` 11 个面板的 Grafana 看板模板
  - `.env.docker.example` 全套环境变量注释模板
  - `.dockerignore` 排除 node_modules / data / logs / .env
- **GitHub Actions CI**：
  - `.github/workflows/ci.yml` 两阶段 Job：typecheck → docker-build
  - 内置 GHA 缓存（npm + docker buildx）
  - typecheck 跑 `npm run lint`（tsc --noEmit）
  - docker-build 验证所有 3 个 target 都能成功 build
- **Prometheus 监控端点**：
  - 新增 `server/src/routes/metrics.ts`：11 组指标（jobs / rpa_tasks / leads / deals / commission / ai_calls / deposits / rpa_accounts / audit_writes）
  - 暴露为 Prometheus text format 0.0.4
  - 可选 `METRICS_BEARER_TOKEN` 环境变量做 Bearer 鉴权
- **前端作业队列卡**：PlatformConsole 在各乙方卡片之上新增作业队列面板（queued/running/failed/24h 成功 + 最近 10 条作业详情），带直达 `/api/metrics` 链接
- **定金催付自动化**：
  - 新增 `deposit.remind_unpaid` job handler：checks paid status → 向 assignee（或 admin 广播）推送企微通知 → 自动入队下一轮
  - 提醒节点：第 1 / 3 / 7 / 14 天，4 次后停止
  - `lead-forms.ts` submit 成功后自动入队首轮（24h 后）
  - singletonKey 防重复入队
- **阿里云 SMS 网关真实对接**：
  - 新增 `server/src/services/sms.ts`：HTTP API + HMAC-SHA1 签名（Node 原生 crypto，零依赖 SDK）
  - 未配置时自动 stub 降级（打印到日志）
  - `student-auth.ts` 的 request-code 端点现在走 `sendOtpSms`，返回 gateway 标识（aliyun/stub）
- **Product-Spec-V3-Roadmap.md**：
  - v3 候选模块 5 个（AI 电话外呼、学员生命周期、ERP 集成、BI 看板、RAG 知识库）每个带业务价值/可行性评分、风险、Go/No-Go 门槛
  - 明确排除 4 个方向（自研模型/跨赛道/无代码/原生 App）
  - 决策框架：5 个问题过滤任何新想法
  - 实施节奏建议（若 v3 全上需 1 年）

### 修改
- `index.ts` 在 `/api/auth` 之前加挂 `/api/metrics` 公开端点（可选 bearer 守卫）
- `job-handlers.ts` 新增 `deposit.remind_unpaid` 非周期性 handler（按链路递归入队而非固定周期）
- `student-auth.ts` 移除原本的 `SMS_GATEWAY` 预留注释，改为调用 sms service

### 安全
- metrics 端点可通过 `METRICS_BEARER_TOKEN` 限制访问
- 催付通知走企微官方 API，无明文发送到公网
- SMS 签名使用阿里云规范的 HMAC-SHA1 + percent-encoded 拼接，时间戳格式符合 ISO-8601
- Docker 镜像分层：apk 安装工具链后移除，避免留在最终镜像

### 原因
- 没有 Docker / CI 就没法复制部署到第 2 台机器，Phase 3 多租户的价值被"部署手工"拖累
- 没有 metrics，之前所有的作业队列/审计写入指标都是"知道但看不见"，无法做容量预测或报警
- 定金催付是合同 3.2 条的合理延伸（学员没支付就需要跟进），手工催的效率低、专员容易漏
- SMS stub 模式只适合开发，v2.x 正式运营前必须把这条链路补上
- v3 路线图是对**未来的约束**，不是扩张的许可。明确"什么不做"比"做什么"更重要

### 里程碑
v2.2 是当前规划下**代码层面的收官版**。自 v1.0 到 v2.2，核心 Spec 的所有 Phase 均已完成骨架或真实实现：
- Phase 1 · 最小可用 ✅
- Phase 2a · 变现闭环 ✅
- Phase 2b · 审计风控 ✅
- Phase 2c · AI 获客引擎 ✅
- Phase 3 · 多租户 + 平台总控 ✅
- Phase 4 · 自动化增强 ✅（企微 + 电话辅助 + 内容日历 + 作业队列 + 催付 + SMS）
- Phase 工程基础 ✅（Docker + CI + Prometheus）

之后的演进路径见 [Product-Spec-V3-Roadmap.md](./Product-Spec-V3-Roadmap.md)。

---

## [v2.1] - 2026-04-23

### 新增
- **企业微信客户联系（Phase 4 深入）**：
  - `server/src/services/wechat-work.ts` 新增 `listFollowUsers` / `listExternalContactIds` / `getExternalContactDetail` 3 个 API 封装，使用独立的 `WECHAT_WORK_CONTACT_SECRET` access_token
  - 新增 `GET /api/wechat-work/follow-users` 列出已授权员工
  - 新增 `POST /api/wechat-work/contacts/sync` 批量同步外部联系人到 leads 表（幂等去重 + tenant 继承 + assignee 自动设为企微 userid + 200ms 轻限流）
  - 前端 ManagementCenter 企微 tab 新增「外部联系人同步」面板，支持范围选择（全部员工/单员工）
- **通用异步作业队列（Phase 4 稳定性）**：
  - 新增 `jobs` 表（name / payload_json / scheduled_at / status / attempts / max_attempts / singleton_key / last_error / result_json / started_at / finished_at）
  - 新增 `server/worker/job-queue.ts`：`registerJobHandler` / `enqueueJob` / `runJobTick` / 指数回退重试（最大 30 分钟）/ singletonKey 防重
  - 新增 `server/worker/job-handlers.ts`：6 个周期性 handler（fetch_dm / crawler / health_check / browser_cleanup / audit_cleanup / jobs_cleanup）+ `scheduleRecurringJobs()` 入队调度
  - 重写 `server/worker/index.ts`：简化为三层 tick（RPA 任务 30s / 作业 10s / 周期调度 60s / 统计 5min），移除原先 4 个散乱 setInterval
  - 新增 `GET /api/platform/jobs` 作业统计 + 最近 50 条历史
- **审计日志自动清理**：`audit.cleanup` 作业默认保留 60 天，每日运行
- **已完成作业自动清理**：`jobs.cleanup` 作业默认保留 7 天，每日运行
- **索引优化**：
  - `idx_leads_tenant_status`（租户内按状态筛选高频）
  - `idx_leads_tenant_created`（租户内近期线索查询高频）
  - `idx_content_items_tenant_status`（内容工厂审核 Tab 查询高频）
  - `idx_rpa_tasks_account_status`（配额统计查询高频）
  - `idx_jobs_singleton`（singleton_key 部分索引，防重插入检查）

### 修改
- Worker 主循环从硬编码 5 个 setInterval 改为「RPA 任务 tick + 作业 tick + 周期调度 tick」三层架构，所有周期逻辑统一走作业队列
- 作业失败时自动按 `attempts` 指数回退重试（60s / 120s / 240s... 最大 30 分钟），失败超 max_attempts 标 failed
- 周期任务入队时必带 `singletonKey`，防止同一周期内重复入队

### 安全
- `wechat-work.ts` 中外部联系人相关 API 只在 `contactSecret` 配置时启用，未配置时所有同步路径优雅降级为"stub 状态"
- 作业 payload 中的敏感信息已通过 audit 中间件的 redact 规则保护
- 外部联系人同步创建的 lead 严格继承调用者 tenant，不会跨租户污染

### 原因
- 合同第 1.1 条承诺「智能客服 / 客户联系」能力，v2.1 完整对接企微 "外部联系人" API，把客户联系合规化的能力落地
- 原 Worker setInterval 架构有两个问题：每个周期任务失败就静默丢失、没法在前端观察执行情况；v2.1 换为 jobs 表后可以审计 / 重试 / 失败告警
- audit_logs 随着业务量增长会无限膨胀，60 天保留期平衡了合规审查和存储成本（这是教培行业较常见的保留策略）
- 新增的 tenant 组合索引预期在乙方数量 ≥ 3 且线索规模 ≥ 10000 时性能提升 10× 以上

---

## [v2.0] - 2026-04-23

### 新增
- **平台总控台（Phase 3 真正收官）**：
  - 新增 `server/src/routes/platform.ts` 与 2 个只读端点 `GET /api/platform/overview` / `GET /api/platform/trend`，仅 `role=admin` 可访问
  - 跨租户聚合：各乙方的线索数 / 成交数 / 应分成 / 已结/未结分成 / 疑似异常 / 用户规模 / RPA 账号状态
  - 近 30 天线索与成交趋势（ComposedChart: 线索 Area + 成交 Line）
  - 系统健康面板：内容待审、RPA 任务失败 24h 计数、审计写量、累计授权、待法务复审协议数
  - 前端新增 `PlatformConsole.tsx` + 导航项「🌐 平台总控台」
  - 侧边栏角色过滤：platform 项仅 `admin + tenant=platform` 可见；compliance/management 项仅 admin/tenant_admin 可见
- **电话辅助 AI 流程（Spec 模块三完整落地）**：
  - LeadManagement 浮层在切换到"电话联系"时显示「电话前 AI 准备」区
  - 一键调用 `/api/ai/student-profile` 生成完整电话准备单：意向 / 顾虑 / 阶段 / 决策因素 + 开场 / 要点 / 异议 Q&A / 收尾
  - 通话结束后录入「通话结果」，一键填入跟进记录表单供保存
  - 沟通历史（最近 5 条 followups）自动作为 AI 输入
- **内容日历 · 待发布任务排期**：
  - 新增 `GET /api/content/calendar` 返回指定时段的内容 + 任务列表
  - 新增 `PATCH /api/content/tasks/:taskId/schedule` 支持对 queued 任务调整 scheduled_at（带租户守卫）
  - ContentFactory 的「内容日历」tab 顶部新增「待发布任务队列」组件：列出队列，每条支持 ±1h / ±3h 微调；过期任务高亮
- **多租户半成品修复**：
  - `deposits` 新增 tenant 字段，下单时自动继承关联 lead 的 tenant
  - deposits 退款端点增加跨租户访问 404 保护
  - lead-forms submit 创建的 lead 自动继承表单 tenant
  - Worker fetch_dm 创建的 lead 自动继承 rpa_account tenant
  - LeadRow / DepositRow 等类型补齐 tenant 字段

### 修改
- `LeadManagement.tsx` 导入 StudentProfileResult 类型和 generateStudentProfile service
- `ContentFactory.tsx` 的内容日历 tab 改为双层：顶部队列面板 + 下方发布记录周视图
- 侧边栏 nav filter 逻辑从"全部显示"变为按角色过滤（最终隐藏当前用户无权访问的入口）

### 原因
- Phase 3 的最后一块是甲方视角的跨租户监管能力——没这块，甲方要接第二家乙方就是瞎子
- Spec 模块三明确承诺「电话辅助」功能，之前后端有 AI 但前端没联动，v2.0 补齐 Spec 闭环
- 内容工厂的"审核 → 任务创建"链路之前是单向的，管理员没法在发布前微调时间点（比如避开敏感时段、错峰发布），v2.0 给管理员这个最后一道把关能力
- 多租户的半成品部分是上一版遗留：v2.0 扫尾，保证接入新乙方时数据边界真正干净

### 安全
- PlatformConsole API 用 `requireRole(['admin'])` 强制只有平台管理员访问
- 内容任务调度 PATCH 端点对非 platform admin 增加"跨租户访问即 404"保护
- deposits 退款增加同样的 tenant 边界检查
- 侧边栏角色过滤仅是 UI 层便利，所有真正的权限校验仍在后端中间件

---

## [v1.9] - 2026-04-22

### 新增
- **多租户骨架（Phase 3 启动）**：
  - 给核心表 `leads` / `content_items` / `deposits` / `rpa_accounts` / `lead_forms` 通过迁移补上 `tenant TEXT NOT NULL DEFAULT 'default'`
  - 新增 `server/src/middleware/tenant.ts`：`getTenantScope` / `buildTenantWhere` / `resolveTenantForWrite`
  - 平台管理员（`role=admin + tenant=platform`）能跨租户看到全局；其他角色只能看到自己的 tenant
  - leads / content / rpa / deposits 列表路由统一加 tenant 过滤；单条访问跨租户返回 404
  - leads 写入自动继承调用者 tenant（平台管理员可显式指定）

- **学员自助端手机号 + 验证码登录（替代老 portalToken 模式）**：
  - 新增 `student_otp_codes` 表（phone / code / expires_at / attempts / consumed_at / ip / ua）
  - `POST /api/student/request-code`：生成 6 位验证码，TTL 5 分钟，1 分钟内不重复发送；stub 模式打印到服务器日志，生产对接 `SMS_GATEWAY`
  - `POST /api/student/verify-code`：校验 + 签发 student JWT（`kind=student`，TTL 12 小时），自动关联手机号对应的 lead 记录
  - `GET /api/student/profile`：学员拉取自己的 lead / enrollment / payment / materials / deposits
  - JWT 增加 `kind`、`leadId`、`phone` 字段，`requireStudent` 中间件确保只有 student token 可访问
  - 前端新增 `/portal` 独立路由 + `StudentPortalEntry` 组件：手机号登录 → 6 位验证码（60 秒重发倒计时）→ 自助端 Dashboard
  - Dashboard 展示当前状态、报读信息、缴费信息、定金订单、材料清单，sessionStorage 存 token

- **RPA 账号健康度自检（Phase 3 稳定性增强）**：
  - 新增 `server/worker/health-check.ts`：为每个 active + 已登录账号打开创作者中心，检测登录态指示元素是否可见
  - Worker 每 24h 自动执行一次（`RPA_HEALTH_CHECK_INTERVAL_MS` 可配置）
  - 失效账号自动切到 `status=cooldown` + 写入 `risk_note`（便于前端提示需要重新登录）
  - 恢复健康的账号自动清除 risk_note

- **协议法务复审机制**：
  - `agreements` 表通过迁移补 `legal_reviewed` / `legal_reviewed_by` / `legal_reviewed_at` 字段
  - `POST /api/agreements/:id/legal-review` 由律师姓名 / 律所名称标记"已复审"
  - 合规中心协议详情页显示黄色「需法务复审」提示 + 一键标记按钮；已复审后显示绿色标记
  - 新增 `GET /api/agreements/compliance/summary`：生效协议数、待复审数、累计授权、今日授权、推荐下一步动作
  - ComplianceCenter 顶部新增 4 项合规指标卡 + 推荐行动提示

### 修改
- Worker `index.ts` 调度循环增加 `healthCheckTick`：tick（30s）/ scheduleFetchDm（10m）/ crawler（1h）/ healthCheck（24h）/ cleanup（5m）五级节流
- `leads` 的 `getLeadRow(id, req)` 增加可选 req 参数，提供 tenant 边界检查；所有 `getLeadRow(req.params.id)` 调用自动带上 req 做租户校验
- `server/src/services/jwt.ts` 的 JwtPayload 增加 `kind: 'user' | 'student'`、`leadId`、`phone` 可选字段，学员和用户共用同一套签名逻辑但通过 kind 区分

### 安全
- 学员 token 存 sessionStorage（关闭浏览器失效），与管理员 localStorage token 隔离，不能用学员 token 访问管理员 API（`requireAuth` 不检查 kind，但业务路由内部通过角色判断）
- 验证码 5 次失败后作废
- 验证码 1 分钟内同手机号不重复发送（防骚扰 + 防刷）
- 验证码用 Node `crypto.randomInt` 生成（非 Math.random）
- Playwright 未安装时健康检查自动跳过，不会误报"不健康"

### 原因
- Spec 的 Phase 3 目标是多租户复制能力；v1.9 打下 tenant 字段 + 中间件基础，下一步接入第二个乙方只需补一些次要表（followups 通过 lead 间接隔离、rpa_messages 通过 account_id 间接隔离、lead_submissions 通过 form_id 间接隔离，已天然覆盖）
- 学员自助端老版本靠环境变量 `PORTAL_STUDENT_LEAD_ID` 硬编码，不支持真实学员登录；v1.9 补齐这条链路后，合同 3.2 条"学员自助申请退还定金"才能真跑起来
- RPA 账号频繁失效是 RPA 系统运维痛点，Sprint 2/3 的发布任务遇到失效账号会静默失败，v1.9 补健康检查让问题在 24h 内被发现
- 合规中心 seed 的协议文案是我们 AI 起草，**不具法律约束力**；法务复审机制逼用户在上线前必须确认这点

---

## [v1.8] - 2026-04-22

### 新增
- **Phase 2a M1 登录与权限系统**：
  - 新增 `users` 表（username、password_hash、name、role、phone、wechat_work_userid、tenant、is_active）
  - 密码使用 Node 原生 scrypt（N=2^15）加盐哈希，密码长度约束 ≥ 6 位
  - JWT 使用 HS256（`JWT_SECRET` 通过环境变量注入，长度 ≥ 16），默认 TTL 7 天
  - 4 种角色：`admin` / `tenant_admin` / `specialist` / `student`
  - 公开端点白名单：`/api/health`、`/api/auth/login`、`/api/lead-forms/*`、`/api/deposits`（POST/GET 单个 + webhook）、`/api/wechat-work/webhook/message`
  - 其他所有 `/api/**` 通过 `requireAuth` 全局中间件保护
  - 新增 `/api/auth/login`、`/api/auth/me`、`/api/auth/change-password`、`/api/auth/users` CRUD
  - 前端新增 `Login.tsx` 登录页、`lib/auth.ts` 含 localStorage 持久化 + 全局 `window.fetch` monkey-patch（所有 `/api/**` 请求自动带 `Authorization: Bearer`，401 时清 token 并派发 `auth-expired` 事件）
  - seed 注入 5 个默认账号（admin / tenant_admin / zhangsan / lisi / wangwu），密码可通过 `BOOTSTRAP_*_PASSWORD` 环境变量覆盖
- **Phase 2a M3 成交登记 + 分成结算**：
  - 新增 `deals` 表（lead_id、school_name、major_name、total_tuition 单位分、commission_rate 默认 0.30、commission_amount、deposit_id、assignee_user_id、status、paid_amount、commission_paid_amount、commission_settled_at、signed_at、suspicious、suspicious_reason、created_by）
  - 新增 `settlement_reports` 表（period YYYY-MM UNIQUE、tenant、total_deals、total_tuition、total_commission、commission_paid、commission_unpaid、suspicious_deals）
  - 成交创建时自动检测"无跟进 / 近 30 天无跟进"并标记 suspicious
  - 新增 `POST /api/deals`、`GET /api/deals`、`GET /api/deals/summary`（admin/tenant_admin）、`PATCH /api/deals/:id`（分成字段仅 admin/tenant_admin 可改）
  - 新增 `POST /api/settlement/reports/generate`（按月聚合 + 疑似异常计数，幂等 ON CONFLICT DO UPDATE）
  - 新增 `GET /api/settlement/reports`、`GET /api/settlement/reports/:period/csv`（UTF-8 BOM + 转义）
- **Phase 2b 审计与风控**：
  - 新增 `audit_logs` 表（user_id、username、role、action、resource_type、resource_id、before_json、after_json、ip、ua、status_code、created_at）
  - 新增 `server/src/middleware/audit.ts` 全局审计中间件：识别资源类型（lead/deal/deposit/content/rpa_account/agreement/violation_word/user/settlement）、4000 字符截断、敏感字段脱敏（password / cookies / apiKey / api_v3_key / private_key）
  - 新增 `GET /api/audit`、`GET /api/audit/suspicious-deals`
- **企业微信集成**：
  - 新增 `server/src/services/wechat-work.ts`（access_token 5 分钟缓存 + 原生 fetch + stub 降级）
  - 新增 `server/src/services/notify.ts`：`notifyAssigneeNewLead`、`notifyAdminNewDeal`
  - deals 创建时自动向所有已绑定 `wechat_work_userid` 的甲方管理员推送通知
  - 新增 `GET /api/wechat-work/status`、`POST /api/wechat-work/send-test`、`POST /api/wechat-work/webhook/message`（公开回调）
- **前端 ManagementCenter**：
  - 新增一级导航「💼 经营管理」，4 个 Tab：成交登记 / 月度分成 / 审计日志 / 企业微信
  - 成交登记 Tab：5 项关键指标卡片 + 成交列表 + 登记成交模态框
  - 月度分成 Tab：月份选择 + 生成月报 + CSV 下载
  - 审计日志 Tab：最近 100 条写操作的时间 / 操作者 / 资源 / 动作 / IP / 状态码
  - 企业微信 Tab：配置状态 + 测试消息发送 + 自动通知联动说明

### 修改
- `deposits` 路由：列表端点和退款端点加 `requireAuth + requireRole(['admin', 'tenant_admin'])`，其他端点保持公开（学员下单与查询）
- `deals.ts` 创建成交时，如果关联线索的 assignee 能匹配到 user，自动设置 `assignee_user_id`，供分成统计按人维度聚合
- README 新增 6 个章节：默认账号、登录与权限、成交登记与分成结算、审计日志、企业微信集成、环境变量清单合并

### 安全
- 所有敏感操作全部留痕到 audit_logs
- 审计日志对 password / cookies / apiKey / api_v3_key / private_key 自动脱敏为 `***REDACTED***`
- 异常成交自动标记并可在合规中心检索（防止乙方绕过系统线下成交）
- 首次部署必须修改默认密码（README 已写入显式警告）

### 原因
- 合同（CK-AI-001）已签，但系统一直没有登录态，任何人访问都能操作全部数据；这是上线前的最后一块硬瓶颈
- 合同第 3.1 条 30% 分成、第 4.2 条透明义务、第 4.3 条甲方审查权，过去全靠人工 Excel，Sprint 4 完成后这三条均可通过系统数据自动执行
- 合同第 5.1 条"隐瞒成交须补缴 + 50% 违约金"过去无证据链支持；现在审计日志 + 疑似异常检测 + 月度 CSV 对账能提供证据链
- 企业微信是甲方运营"新线索即时推送 + 客户联系合规化"的基础，Sprint 4 建立了最小闭环

---

## [v1.7] - 2026-04-22

### 新增
- **快手适配器真实实现**：与小红书、抖音一致的 publish + fetchDm + captureLoginCookies 骨架，纳入 Worker 统一调度与 login-cli 支持。
- **内容工厂审核通过 → 自动创建 RPA 发布任务**：
  - `content_items` 表扩展 `body_json` 字段保存各平台的 {title, content, imageDesc}
  - `rpa_tasks` 表扩展 `content_id` 字段建立任务与内容的关联
  - `PATCH /api/content/reviews/:id` 在 status 从 pending 变为 approved 时，为 platforms_json 中每个平台挑选一个已登录 + active + 未达配额的账号，创建 publish 任务，scheduled_at 随机延迟 5-30 分钟
  - Worker 发布成功后自动回写 `content_items.status='published'` 与 `published_at`
- **采集器真实实现**：
  - 新增 `server/worker/crawler.ts`，按 `crawler_sources.frequency_hours` 节流采集教育部、云南/广东省教育考试院、合作院校官网
  - 原生 `fetch` + 正则抽取链接，关键词白名单过滤（"通知/公告/招生/专升本/学历/政策/办法/简章/通告"）
  - 违规词检查：命中「学生姓名 / 学生电话 / 考生信息 / 身份证号」的条目主动丢弃并告警
  - Worker `index.ts` 新增 `CRAWLER_INTERVAL_MS`（默认 1 小时）
  - 新增 `GET /api/crawler/sources`、`PATCH /api/crawler/sources/:id`、`GET /api/crawler/items`
- **500 元定金微信支付接入（Phase 2a M2）**：
  - 新增 `deposits` 表：out_trade_no、amount（单位分，默认 50000）、status、code_url、transaction_id、refund_no、refund_amount 等字段
  - 新增 `server/src/services/wechat-pay.ts`：基于 Node 原生 crypto 的 APIv3 签名 + AEAD_AES_256_GCM 回调解密，未配置商户证书时自动降级为 stub（返回占位 code_url）
  - 新增 `POST /api/deposits` 下单、`GET /api/deposits/:outTradeNo` 查询、`POST /api/deposits/webhook/notify` 回调、`POST /api/deposits/:outTradeNo/refund` 退款、`GET /api/deposits` 列表 5 个端点
  - H5 测评完成后自动展示「锁定你的报名名额」入口，生成订单并显示微信二维码（通过公共 QR 接口渲染 code_url），每 3 秒轮询订单状态直到支付完成
- **前端联动补齐**：
  - AcquisitionEngine 的采集器 Tab 升级为真实 API 数据源，支持启用/停用每个采集源
  - AssessmentTool 在专业匹配报告下方展示定金支付入口、二维码弹窗、轮询状态
  - 合规演示：stub 模式下展示「⚠️ 当前为演示模式」提示，避免误导

### 修改
- Worker `index.ts` 支持平台清单扩展为 `['xiaohongshu', 'douyin', 'kuaishou']`
- Worker 调度器由单一 tick 扩展为：任务执行 tick（30 秒）/ fetch_dm 调度（10 分钟）/ 采集器 tick（1 小时）/ 浏览器回收 tick（5 分钟）
- README 增加快手、内容联动发布、采集器、微信支付四块的说明与环境变量

### 安全
- 采集器硬编码白名单域名 + robots 提醒 + 请求间隔 >= 10 秒
- 微信支付回调必须通过 AEAD_AES_256_GCM 解密，未配置 APIv3 密钥时解密函数直接抛错
- 定金订单 out_trade_no 使用「时间戳 + 4 字节随机数」生成，UNIQUE 约束保证幂等

### 原因
- Sprint 2 只做了小红书与抖音骨架，快手补齐后三平台发布矩阵正式打通
- 内容工厂审核与 RPA 发布任务过去是两条断链，每条新内容需要人工手动下发，Sprint 3 完成自动化是"内容→发布→线索"闭环的关键
- 合同第三条规定 500 元定金是甲方的核心收款和审计手段，前面 Sprint 只有 UI 没有支付通道，这次打通意味着甲方真正能在线收款
- 采集器被动态喂料后，内容工厂的 AI 生成质量会明显上升（有时效性政策、院校官方招生简章可引用）

---

## [v1.6] - 2026-04-22

### 新增
- 新增「模块五：AI 获客引擎」，包含 4 个子模块：
  - 子模块 A — RPA 内容自动发布：9 个测试账号矩阵（抖音/快手/小红书各 3 号）、每平台每日 3-5 条、真实浏览器指纹 + 随机延迟 + 作息时段、单账号操作配额、封号应急降频。
  - 子模块 B — 平台私信/评论监控：仅监控自家账号，每 30 分钟扫描一次，复用 AI 意向分级自动处理。
  - 子模块 C — 公开信息采集：白名单站点（教育部/省考试院政策公告、合作院校招生简章、平台热点选题）、robots 合规、频率限制。
  - 子模块 D — 合规留资入口：Sprint 1 交付 H5 专业测评、Sprint 2 补白皮书领取、Sprint 3 补公众号菜单裂变，每条留资附带完整授权链路。
- 新增「模块六：合规与授权管理」，作为 AI 获客引擎与定金支付的合规基础设施，包含隐私政策与用户协议版本化管理、个人信息授权书、数据主体权利响应入口、数据最小化约束、平台内容合规违规词库。
- 新增一级导航「🚀 AI 获客」（含发布矩阵、私信雷达、留资入口、素材采集四个 Tab）。
- 新增一级导航「🛡️ 合规中心」（含协议管理、授权记录、数据请求、违规词库四个 Tab），仅甲方管理员可见。
- 新增 Phase 2c 范围补充章节，明确目标、核心闭环、技术架构变更（独立 RPA Worker 进程 + 合规数据链路 + RPA/采集/留资相关数据模型）、验收标准、合规红线。
- 新增应用场景 6/7/8：H5 测评留资闭环、RPA 发布矩阵日常、私信雷达自动建联。
- 新增用户权限表中「甲方管理员」与「乙方管理员」的区分，以及 AI 获客、合规中心的权限归属。
- 新增数据表：`consents`、`agreements`、`data_requests`、`rpa_accounts`、`rpa_tasks`、`rpa_messages`、`crawler_sources`、`crawler_items`、`lead_forms`、`lead_submissions`。

### 修改
- 将「建议的开发顺序」由 Phase 1-4 重排为 Phase 1 / 2a / 2b / 2c / 3 / 4：
  - Phase 2a：变现闭环（登录/权限/JWT、500 元定金收款、成交登记、分成结算、定金退还）
  - Phase 2b：审计与风控（操作留痕、异常成交检测、月度对账报表）
  - Phase 2c：AI 获客引擎 + 合规护城河（与 2a 并行）
  - Phase 3：多租户复制（由原 Phase 2 的「业务化稳定化」升级而来）
  - Phase 4：其他自动化增强（内容日历自动化、企业微信 API）
- 更新「需独立开发的模块」表，RPA 与私信监控风险等级由"高"下调为"中"（在合规与测试账号隔离前提下可控），并新增公开信息采集、合规留资入口、微信支付/支付宝定金收款等条目。
- 更新 Analyze Images 能力的用途说明，补充 RPA 发布验证码图片识别场景（仅用于降频决策，不做绕过）。
- 重写底部「风险提示」为「风险提示与合规红线」，区分平台封号风险（可控）与法律合规红线（不可越线），并明确甲方/乙方责任边界。

### 删除
- 删除「个人微信自动化（WeChatFerry/itchat 等逆向方案）」模块，保留「AI 生成话术 + 人工发送」能力。
- 删除所有涉及爬取学生个人信息（姓名、手机号、学校、专业、简历）的功能讨论，列入 Phase 2c 合规红线硬性禁止项。

### 原因
- 合同（CK-AI-001）已签订 3 个月，当前系统被动等线索无法兑现"AI 招生解决方案"的核心价值，必须把主动获客能力前置。
- 原 Phase 4 将 RPA 与个人微信爬取并列为"高风险自动化"一刀切推迟，导致甲方核心卖点长期缺失；本次按合规性把 RPA 自家账号发布、私信监控（自家账号）、公开信息采集、合规留资入口拆出来前置为 Phase 2c。
- 爬取应届生个人信息用于招生营销涉及《刑法》253 条之一「侵犯公民个人信息罪」、《个人信息保护法》第 13 条，教培行业已有多起判决先例；必须在 Spec 层面明确禁止，避免实施阶段踩线。
- 合规留资入口 + 授权管理 + 违规词库属于"没它不能上线、有它就是护城河"的基础设施，必须与 AI 获客同步落地。
- 当前单进程 Express 架构跑 RPA 会把主服务 CPU 挤爆，技术架构变更为独立 RPA Worker 进程（Node + Playwright + node-cron + SQLite 任务队列）。

### 安全
- 明确硬性合规红线：严禁爬取学生个人信息、严禁使用非授权手段获取第三方平台数据、严禁违规承诺用语。
- 明确 RPA 测试账号由甲方统一注册管理，与乙方主营账号隔离，封号损失由甲方承担。
- 明确学员个人信息的安全存储、删除响应、导出请求由甲方作为数据处理者承担主要责任。
- 所有留资必须具备完整授权链路（协议版本号 + 勾选时间 + IP + UA）。

---

## [v1.5] - 2026-04-15
### 修改
- 在线索转化工作台中新增高意向线索“报价单/方案单”能力，支持填写推荐院校、推荐专业、学制、学费、缴费方式、分期建议、适合人群、风险提示。
- 细化成交资产区为可保存、可回显、可复制给顾问的方案卡结构，支持顾问在微信/企微沟通中直接复用。
- 将报价单/方案单纳入 Phase 1 成交闭环，补充对应数据模型与验收标准。

### 原因
- 当前系统已有线索、跟进、报名推进、缴费登记，但高意向线索从“咨询”到“发方案”的关键动作仍缺少标准化承接，顾问容易靠手工拼接信息，影响转化效率。
- 对学历提升机构而言，报价单/方案单是成交前最核心的销售资产之一；可复制、可保存、可回显能减少重复劳动，也能保证顾问对外口径一致。

---

## [v1.4] - 2026-04-15
### 修改
- 将“线索管理”升级为“线索转化工作台”，补充搜索、筛选、待跟进优先排序能力。
- 在线索详情浮层中新增“成交资产区”，统一展示诊断结论、推荐院校/专业、报价摘要、下次动作与催缴节点。
- 首页待办事项支持点击直达对应工作视图，减少老板与招生专员在看板和执行页面之间来回切换。
- 强化院校素材库的“信任背书”定位，要求展示院校层次、招生类型、院校简介、专业通过率、报读要求与专业优势。

### 原因
- 当前系统已经具备线索、跟进、报名推进、缴费登记等基础闭环，但缺少把这些信息组织成“成交动作”的工作台，导致转化效率和催缴效率仍依赖人工记忆。
- 对小型学历提升机构来说，短期最值钱的不是继续堆新模块，而是把线索优先级、报价动作、催缴节点和信任背书做扎实，直接提升转化率、客单价和交付可信度。

---

## [v1.3] - 2026-04-12
### 修改
- 在 Phase 1 核心闭环中补入最小报名推进与首付款登记：支持为意向明确线索登记院校/专业/报名阶段，并对已报名线索记录首付款、全款与下次催缴时间。
- 扩展 Phase 1 最小数据模型：新增报名推进记录与缴费记录。
- 扩展 Phase 1 验收标准：不仅要有线索与跟进，还要能完成报名推进登记和首付款/催缴登记。

### 原因
- 仅有线索与跟进，还不足以支撑招生团队跑完整个成交闭环；系统仍无法承接“已报名”“待缴费”“待催缴”的日常作业。
- 对小型学历提升机构而言，最直接的续费价值来自报名推进和回款推进，而不是更复杂的自动化获客模块。

---

## [v1.2] - 2026-04-12
### 修改
- 收紧 Phase 1 首页看板口径：优先展示真实线索运营数据（今日新线索、已联系、意向明确、待跟进、负责人表现、来源分布、近 7 天线索/跟进趋势），不再用 mock 的收入与在读人数作为首页核心判断依据。
- 明确收入、缴费、在读人数等经营指标属于 Phase 2 真实数据化范围，在对应模块未完成前不作为 Phase 1 首页核心验收项。

### 原因
- 当前后端已具备线索、跟进记录、AI 调用与首页聚合 API 的基础能力，但缴费、学员、排课仍主要停留在原型或 mock 阶段。
- 如果首页继续混用真实数据和 mock 数据，会误导老板与销售判断，降低试运行和演示可信度。
- Phase 1 的首要目标是让招生团队先把线索闭环跑起来，因此首页必须优先服务“获客、跟进、转化推进”的日常决策。

---

## [v1.1] - 2026-04-11
### 修改
- 明确 Phase 1 改造范围为「最小可用系统落地」：后端基础骨架 + 线索库 + 跟进记录 + AI 服务后移 + 首页真实看板。
- 将实施策略调整为分阶段推进：
  1. Phase 1：最小可用系统落地
  2. Phase 2：业务化与稳定化（缴费、学员、排课的真实数据化 + 日志、限流、测试、权限）
  3. Phase 3：自动化增强（内容审核发布流、提醒任务、异步作业、外部系统集成）
  4. Phase 4：高风险自动化验证（RPA 自动发布、多平台私信监控、个人微信辅助）
- 补充 Phase 1 核心闭环：线索入库、AI 意向分析、AI 话术辅助、跟进记录、状态更新、下一步动作与下次跟进时间、首页真实看板。
- 补充 Phase 1 最小数据模型：用户、线索、跟进记录、AI 调用记录。
- 补充 Phase 1 线索状态：新线索、已联系、跟进中、意向明确、已报名、已流失。
- 补充 Phase 1 前端改造要求：内容工厂、线索管理、微信助手、首页看板优先接入真实 API。
- 补充微信助手 Phase 1 边界：不做真实微信自动发送，但要支持复制 AI 话术、人工输入沟通内容，并写入线索跟进记录形成留痕。
- 补充 Phase 1 验收标准：真实线索 CRUD、跟进记录、AI 后端调用、真实看板、前端不暴露 Gemini API Key、最小文档与测试能力。

### 原因
- 当前代码已具备前端演示原型和部分 AI 功能，但缺少真实后端、数据持久化、线索闭环和上线级安全边界。
- Phase 1 需要先解决“业务能跑起来”的问题，而不是优先投入高风险 RPA 或个人微信自动化。
- 降低首期交付风险：RPA 平台发布与个人微信自动化存在较高封号与反自动化风险，不适合作为首阶段上线前置条件。
- 优先保障可用与合规：后端代理 AI + 最小数据闭环 + 基础权限控制，更适合作为 MVP 先上线验证。
- 提升实施确定性：通过 Phase 1 先验证产品价值与转化闭环，再基于真实业务数据决定 Phase 2+ 的自动化投入范围。

### 安全
- 明确 Gemini API Key 仅保存在后端，前端不再直接读取或注入密钥。

---

## [v1.0] - 2026-03-03
- 初始版本 Product Spec 建立，定义招生智能体集群整体功能、UI 布局、用户流程与 AI 能力配置。
