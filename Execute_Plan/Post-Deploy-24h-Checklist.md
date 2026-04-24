# 部署后 24 小时自检清单

> 给你自己用。部署完系统不是结束，是试运行的开始。
> 头 24 小时按这份清单过一遍，确认系统没跑偏。
>
> 时间预估：**总共 45 分钟，分 4 次检查**。

---

## T+0 小时 · 部署完成立刻做（10 分钟）

### 1. 三个容器都健康

```bash
cd /opt/admissions/Admissions_agents
./docker/deploy.sh status
```

**期望**：`admissions-server` / `admissions-worker` / `admissions-frontend` 都是 `Up`（server 状态是 `Up (healthy)`）

**不对就**：
- 看日志 `./docker/deploy.sh logs server` 找错
- 常见：端口被占 / .env 没填 GEMINI_API_KEY / JWT_SECRET 太短

---

### 2. 三个入口都打得开

```bash
# 管理后台
curl -I http://localhost/
# 应返回 200

# 测评 H5
curl -I "http://localhost/assessment?formId=1"
# 应返回 200

# 学员端
curl -I http://localhost/portal
# 应返回 200

# API 健康
curl http://localhost/api/health
# 应返回 {"success": true, ...}
```

---

### 3. 默认密码立刻改

**⚠️ 不改就是裸奔**。系统 seed 时的默认密码是公开已知的（admin123456 等）。

```bash
# 登录
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}' | jq -r '.data.token')

# 改密码（每个账号都改）
for USER in admin tenant_admin zhangsan lisi wangwu; do
  echo "改 $USER 的密码："
  read -s NEW_PWD
  TOKEN_X=$(curl -s -X POST http://localhost/api/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"${USER}123456\"}" | jq -r '.data.token')
  curl -X POST http://localhost/api/auth/change-password \
    -H "Authorization: Bearer $TOKEN_X" \
    -H 'Content-Type: application/json' \
    -d "{\"oldPassword\":\"${USER}123456\",\"newPassword\":\"$NEW_PWD\"}"
done
```

或者登录网页后台手动改。但**必须在 T+0 就改**。

---

### 4. 检查关键能力是否 stub 模式

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost/api/wechat-work/status | jq
# configured=false → 企微消息走 stub，不真发
# 可接受，正式上线前配 WECHAT_WORK_*
```

**微信支付**：在 `.env` 没配 `WECHATPAY_*` 时定金是 stub 模式，学员扫码不能真支付。正式收款前必须配。

---

## T+2 小时 · 让 AI 员工跑一次（10 分钟）

### 1. 登录管理后台

`http://服务器IP/`，用 admin 账号登录。

### 2. 看 HomePanel 是否正确渲染

**期望**：
- 页面顶部是「甲方总控台」橙字标题（admin + tenant=platform）
- 6 个指标卡：已接入乙方、本周成交、本周新线索、应收分成、未结分成、疑似异常
- AI 员工状态卡：0 / 0 / 0 三个数字

**不对就**：
- 指标都是 0 是正常的（数据库还没数据）
- 如果报错「加载失败」→ 看 server 日志，可能是 JWT 没带

### 3. 进「🤖 AI 员工」

**期望**：顶部显示三个大按钮：
- 每日内容冲刺
- 线索跟进扫描
- 周度经营报表

### 4. 点「每日内容冲刺」

**等 1-2 分钟**，mission 会自动：
1. status: queued → running
2. 调 query_schools
3. 调 generate_content_draft 生成 3 条
4. 调 compliance_scan
5. 调 submit_content_for_review（**走到这里会暂停等审批**）

**预期结果**：Mission 列表里出现 1 条 `waiting_approval` 状态任务。

**如果全程失败**：
- 确认 `.env` 的 GEMINI_API_KEY 有效（可以手动 `curl` 测试 Gemini API）
- 确认服务器能访问 `generativelanguage.googleapis.com`

### 5. 批准审批（如果系统跑到这一步）

点任务详情页的「✓ 批准并继续」，mission 会继续执行到 `succeeded`。

---

## T+6 小时 · 验证定时任务（5 分钟）

### 1. 进 AgentWorkspace 底部

**期望**：看到「定时自动化」卡片，列出 3 条默认配置：
- daily_content_sprint · 每日 08:00 · 未启用
- lead_followup_sweep · 每日 09:00 · 未启用
- weekly_report · 每周一 20:00 · 未启用

### 2. 把 `daily_content_sprint` 开到你当前时间 +5 分钟

比如现在是 15:23，把 cronHour 设为 `15`，然后点「启用」。

**等到 15:30 内**（每 5 分钟 tick 一次），Worker 应自动创建一个新的 `[定时] 每日内容冲刺` mission。

**不对就**：
- 检查 Worker 进程 `./docker/deploy.sh logs worker | tail -30`
- 常见：Worker 重启过，时间戳没对
- 半小时内没触发 → 手动 curl `POST /api/missions/quick-start` 验证手动路径能跑

### 3. 关闭（验证完就关）

把 cronHour 改回 8，点「已启用」取消。

---

## T+12 小时 · 数据归档检查（5 分钟）

### 1. 数据库有东西

```bash
docker exec admissions-server sqlite3 /data/admissions.db <<EOF
.headers on
SELECT 'users' as table_name, COUNT(*) as count FROM users;
SELECT 'leads' as table_name, COUNT(*) as count FROM leads;
SELECT 'agent_missions' as table_name, COUNT(*) as count FROM agent_missions;
SELECT 'agent_steps' as table_name, COUNT(*) as count FROM agent_steps;
SELECT 'audit_logs' as table_name, COUNT(*) as count FROM audit_logs;
EOF
```

**期望**：
- users ≥ 5（seed 默认账号）
- agent_missions ≥ 1（T+2 那次测试）
- agent_steps ≥ 5（那次 mission 的轨迹）
- audit_logs 有数字（你之前的每次 API 调用都会写）

### 2. 日志切割检查

```bash
ls -la ./docker/logs/
# 应该有 rpa-YYYY-MM-DD.log
```

---

## T+24 小时 · 全面体检（15 分钟）

### 1. Prometheus 指标快照

```bash
curl -s http://localhost/api/metrics | grep -E "admissions_(jobs|leads|deals|ai_calls)" | head -20
```

**重点看**：
- `admissions_jobs_total{status="failed"}` 应该 = 0 或 极少
- `admissions_rpa_accounts_logged_in` 是 0 正常（你还没登录）
- `admissions_ai_calls_last_day` 应该 > 0（说明 AI 有被调用）

### 2. 查是否有异常作业

```bash
docker exec admissions-server sqlite3 /data/admissions.db \
  "SELECT name, status, COUNT(*) FROM jobs GROUP BY name, status"
```

**期望**：大部分 `succeeded`。出现 `failed` 的 job 要看 last_error 字段排查。

### 3. 合规中心

登录管理后台 → 合规中心
- 看「监管速览」卡片是否渲染（6 条风险提示）
- 协议管理列表里 3 条协议应该都有，右边显示「需法务复审」黄色标签

### 4. 备份一次

```bash
./docker/deploy.sh backup
ls -la docker/data/backup-*.db
```

**期望**：生成 `backup-YYYYMMDD_HHMMSS.db` 文件。

---

## 🚨 红色警戒指标（出现任一都要立刻排查）

| 指标 | 红线 | 可能原因 |
|------|------|---------|
| jobs 连续 5 次 failed | Gemini 挂 / Worker 崩溃 / 密钥失效 |
| 2 小时内无 audit_logs | 没人在用 = 正常，但若你在用却没记录 = bug |
| mission 超过 1 小时仍 running | agent-runtime 死循环，需要手动 cancel |
| 容器内存持续增长 | Playwright 浏览器没回收，需要 Worker 重启 |
| SQLite 文件 > 1G | 数据暴涨，需要调整清理策略 |

---

## 🟢 T+24 后的常态化运维

跟 [Operator-Runbook.md §3](./Operator-Runbook.md#3-日常监控-5-分钟天) 走，**每天 5 分钟**即可。

---

## 通过清单（勾完这些你就真正上线了）

- [ ] T+0：三容器 healthy
- [ ] T+0：三个入口都能打开
- [ ] T+0：所有默认密码已改
- [ ] T+0：关键能力状态（stub / real）已心里有数
- [ ] T+2：一次 AI 员工任务跑到 succeeded
- [ ] T+6：一次定时任务自动触发过
- [ ] T+12：数据库 / 日志 都在正确位置归档
- [ ] T+24：Prometheus 指标都是绿的
- [ ] T+24：备份成功过一次
- [ ] T+24：合规中心渲染正常

**全勾了 = 系统稳了，你可以去睡觉。**
