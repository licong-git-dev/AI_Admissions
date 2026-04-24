# AI 招生数字员工 · 架构设计（Phase 5 / v3.0）

> 参考：Anthropic Claude Cowork（Computer Use）+ Manus AI（Butterfly Effect）+ OpenAI ChatGPT Agent
> 目标：把系统从「工具集合」升级为「能接收模糊目标、自主拆解任务、调用工具执行、拿到结果」的数字员工

---

## 一、为什么做

### 1.1 行业标杆

- **Manus AI**（Butterfly Effect，Monica 团队）：2025-03 发布，2026 被 Meta 20-30 亿美金收购，核心是 **My Computer** 桌面代理 + 多 agent 编排 + 自主浏览器操作
- **Claude Cowork**（Anthropic，2026-03-23）：Claude 直接操作用户桌面，完成多步工作流
- **ChatGPT Agent**（OpenAI，2026）：自主工作区代理

共同特征：
1. **目标驱动**：用户给"帮我做什么"，不给"怎么做"
2. **工具编排**：agent 自主决定调用哪些 API/浏览器/终端
3. **长时运行**：任务可以跑几小时 / 几天
4. **人在回路**：危险操作需要人工批准（Manus 默认要审批）
5. **轨迹可见**：每一步都能看到，错误可溯源

### 1.2 我们的场景契合度

招生全流程正好是一个典型的 agentic 场景：

| 传统方式 | Agent 方式 |
|---------|-----------|
| 运营 30 分钟生成 3 条内容 | 说"今天发 3 条会计专业的笔记"，agent 自动完成 |
| 专员 2 小时看 20 条线索跟进 | 说"帮我筛高意向未跟进的"，agent 列清单+推话术 |
| 老板月末手工对账 | 说"生成 4 月分成月报"，agent 自动跑 |

**节省的不是 AI 调用次数，节省的是"决策+协调+执行"的人工环节**。

---

## 二、架构设计

### 2.1 分层图

```
┌─────────────────────────────────────────────────┐
│        AgentWorkspace (前端)                     │
│   任务列表 · 轨迹查看 · 审批操作 · 重放调试       │
└────────────────────┬────────────────────────────┘
                     │ REST + polling
┌────────────────────▼────────────────────────────┐
│          /api/missions  API 路由                 │
│   POST 创建 · GET 查询 · PATCH 审批/取消        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│          Agent Runtime (Worker 端)               │
│  ┌──────────────────────────────────────────┐   │
│  │  ReAct Loop（最多 20 步 / 30 分钟超时）  │   │
│  │                                          │   │
│  │  1. 读取 mission 的 goal                 │   │
│  │  2. 调 Gemini Function Calling           │   │
│  │  3. 分发：                               │   │
│  │     - read_xxx tools → 直接执行          │   │
│  │     - write_xxx tools → 写 step          │   │
│  │       status=waiting_approval 后暂停     │   │
│  │  4. 等审批通过后继续                     │   │
│  │  5. 直到 finish_mission 或超限           │   │
│  └──────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│          Tool 注册层 agent-tools.ts              │
│  把现有 25 个 API 包装成 Gemini function schema  │
│  标记 safe / needs_approval                      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│     现有 25 个 REST API 不动                     │
│     /api/leads · /api/content · /api/rpa ...    │
└─────────────────────────────────────────────────┘
```

### 2.2 数据模型

```sql
-- 任务表
CREATE TABLE agent_missions (
  id INTEGER PRIMARY KEY,
  tenant TEXT NOT NULL,
  type TEXT NOT NULL,             -- daily_content_sprint / lead_followup_sweep / weekly_report / custom
  title TEXT NOT NULL,
  goal_json TEXT NOT NULL,        -- { "platforms": ["xhs"], "count": 3, "topic": "会计学" }
  status TEXT NOT NULL,           -- queued / running / waiting_approval / succeeded / failed / canceled
  created_by INTEGER,             -- users.id
  step_count INTEGER DEFAULT 0,
  last_error TEXT,
  summary TEXT,                   -- agent 最后输出的总结
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 轨迹表
CREATE TABLE agent_steps (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL,
  step_index INTEGER NOT NULL,
  role TEXT NOT NULL,             -- assistant / tool_call / tool_result / system / approval
  content TEXT,                   -- assistant thinking / system message
  tool_name TEXT,                 -- 当 role=tool_call 时
  tool_args_json TEXT,
  tool_result_json TEXT,
  needs_approval INTEGER DEFAULT 0,
  approved_by INTEGER,            -- users.id
  approved_at TEXT,
  rejected_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 2.3 Tool 分类

| 类别 | 特点 | 示例 | 是否审批 |
|------|------|------|---------|
| **Read Tools** | 纯读取 / 查询，无副作用 | `query_leads` / `query_dashboard_summary` / `list_rpa_accounts` | ❌ 免审批 |
| **Analyze Tools** | 基于已有数据分析或 AI 调用（Gemini 内部调用） | `analyze_intent_from_message` / `suggest_next_action` | ❌ 免审批 |
| **Write Tools · 低风险** | 写入但不触达外部 / 不花钱 | `update_lead_note` / `create_follow_up_log` | ❌ 免审批 |
| **Write Tools · 高风险** | 触达学员 / 花钱 / 发布内容 | `submit_content_for_review` / `send_wechat_message` / `refund_deposit` | ✅ 必须审批 |
| **Terminal Tools** | agent 自主结束的终止符 | `finish_mission` / `give_up_mission` | ❌ 免审批 |

### 2.4 ReAct Loop 状态机

```
queued
  │
  ▼ worker pull
running ─────┐
  │          │ tool_call (write 高风险)
  │          ▼
  │      waiting_approval
  │          │ user approves
  │          ▼
  │       running
  │
  ▼ agent finish_mission
succeeded

（任意状态可跳转 canceled / failed）
```

---

## 三、预置任务模板（3 个）

### 3.1 `daily_content_sprint` · 每日内容冲刺

**目标参数**：
```json
{
  "platforms": ["xhs"],
  "dailyCount": 3,
  "topics": ["专升本政策", "会计学专业", "学姐案例"]
}
```

**agent 预期行为**：
1. `list_schools()` 看素材库
2. 对每个 topic 调用 `generate_content` → 得到 3 套图文
3. 每套调用 `compliance_scan` 做预检
4. `submit_content_for_review` 提交到审核队列（需要审批）
5. finish_mission，总结今日产出

**典型运行时间**：3-5 分钟

### 3.2 `lead_followup_sweep` · 线索跟进扫描

**目标参数**：
```json
{
  "minIntent": "medium",
  "daysIdle": 2,
  "maxResults": 20
}
```

**agent 预期行为**：
1. `query_leads({ intent: 'high,medium', needsFollowup: true })` 拉高意向待跟进
2. 对每个 lead 调用 `analyze_intent_from_message` + `suggest_scripts`
3. 聚合成清单 → `send_wechat_work_message` 给负责专员（需要审批）
4. finish_mission

**典型运行时间**：5-10 分钟

### 3.3 `weekly_report` · 周度经营报表

**目标参数**：
```json
{
  "period": "2026-W17",
  "recipients": ["admin"]
}
```

**agent 预期行为**：
1. `query_dashboard_summary()` + `query_deals_summary()` + `query_jobs_stats()`
2. `query_suspicious_deals()` 看有没有异常
3. 用 Gemini 生成自然语言摘要（含建议）
4. `send_wechat_work_message` 推送给甲方管理员（需要审批）
5. finish_mission

**典型运行时间**：2-3 分钟

---

## 四、安全边界

### 4.1 硬约束（代码层）

- Gemini 每次只能调用**注册过**的 tool，未在 schema 里的调用直接拒绝
- 高风险 tool 必须触发 `waiting_approval`，不可绕过
- Tool 的 args 做 JSON schema 校验，杜绝注入
- 单 mission 最多 20 步 / 30 分钟超时，自动终止
- 单 mission 最多触发 **5 次 waiting_approval**，超过视为异常

### 4.2 租户隔离

- 每个 mission 带 tenant，Tool 层底层调用时自动带 tenant scope
- 跨租户操作默认禁止（只有 platform admin 可以显式指定其他 tenant）

### 4.3 审计

- 每步都写 `agent_steps`（tool_call / tool_result / approval）
- Mission 完成后 `audit_logs` 记录完整链路
- 审批人是谁、拒绝原因是什么，都有留痕

### 4.4 成本控制

- Gemini 调用累计 token 记录到 `ai_logs`
- 每个 mission 配额（默认 10 万 token，可配置）
- 超过配额自动标记 failed

---

## 五、与现有系统关系

### 保留不动
- 25 个 REST API：继续独立使用，前端原有页面照旧
- 作业队列：agent runtime 是作业队列的一个 handler（`agent.run_mission`）
- 审计中间件：agent 所有写操作走现有 API，自动被审计

### 新增
- `agent_missions` + `agent_steps` 两张表
- `server/src/services/agent-tools.ts`：Tool 注册
- `server/worker/agent-runtime.ts`：ReAct 循环
- `server/src/routes/missions.ts`：REST API
- `src/components/AgentWorkspace.tsx`：前端工作台
- 导航新增 🤖 AI 员工

### 修改
- `worker/job-handlers.ts` 注册 `agent.run_mission` handler
- `constants.ts` 新增导航项

---

## 六、为什么不直接接入 Manus / Claude Cowork

### 不接入的 5 个原因

1. **数据主权**：学员 PII / 成交分成数据不能流出我们的数据库到第三方 agent 平台
2. **工具特定性**：我们 25 个 API 是招生领域特化的，通用 agent 覆盖不了
3. **合规可控**：我们的违规词库 + 授权链路是竞争力核心，外接 agent 没法保证不破防
4. **中国网络**：Claude Cowork 在国内访问不稳定，Manus 的 "My Computer" 要装客户端
5. **商业模型**：Manus $20/月 / Claude Max 每月订阅，外接成本高且定价失控

### 未来衔接路径

当 Phase 5 自研 agent runtime 跑稳后，可以作为**上层入口**接入 Claude Cowork 或 Manus —— 把我们的 25 个 API 用 MCP / OpenAPI 暴露，让用户在 Claude Cowork / Manus 里说中文指令即可调用我们的能力。这是 v4 级别的长期目标，不现在做。

---

## 七、本轮实现范围（v3.0 MVP）

✅ 必做：
- DB schema（agent_missions / agent_steps）
- Tool 注册层（10+ safe tool + 5+ needs_approval tool）
- Agent runtime（ReAct 循环 + 审批暂停）
- API 路由 `/api/missions`
- 3 个预置 mission 模板
- 前端 AgentWorkspace minimal（任务列表 + 轨迹查看 + 审批按钮）

❌ 不做（留 v3.1+）：
- 自定义 mission（只允许 3 个预置类型）
- agent 自主浏览网页（不做 Computer Use 级别）
- agent 跨 mission 长期记忆
- 多 agent 协作
- 真实时流式 Server-Sent Events（先用前端轮询）

---

## 八、验收标准

1. 能通过 API 创建 `daily_content_sprint` 任务
2. Worker 拉起并调 Gemini 生成 3 条内容
3. 触发 `submit_content_for_review` 时暂停等待审批
4. 管理员批准后任务继续
5. 内容成功进入 `content_items` 表
6. Mission 状态变 succeeded，前端能看到完整 20 步轨迹
7. 数据库 `agent_steps` 完整记录所有 tool_call / tool_result / approval

---

## 九、风险与兜底

| 风险 | 发生概率 | 兜底方案 |
|------|---------|---------|
| Gemini 调用失败 / 超时 | 高 | agent_steps 记录 error → mission 标 failed，可手动重试 |
| Gemini 生成的 tool args 格式不对 | 中 | JSON schema 校验，无效 args 直接返回错误给 Gemini 让它重试 |
| 无限循环 / 刷 token | 中 | 20 步 + 30 分钟 + 10 万 token 三道硬限 |
| 审批一直不点 | 高 | mission 可 7 天自动 timeout → canceled |
| agent 乱发内容 | 高 | 所有发布类 tool 必须 waiting_approval |

完成这套设计后动手。
