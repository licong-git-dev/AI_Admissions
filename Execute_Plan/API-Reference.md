# API 参考文档

> 所有 API 返回统一格式：`{ success: boolean, data: T | null, error: string | null }`
> Base URL（生产）：`https://your-domain.com/api`
> 鉴权：除白名单外全部需要 `Authorization: Bearer <JWT>`

---

## 目录

- [认证](#认证)
- [公开端点（无需登录）](#公开端点无需登录)
- [线索](#线索)
- [跟进 / 报价 / 报名 / 缴费](#跟进--报价--报名--缴费)
- [内容工厂](#内容工厂)
- [AI 调用代理](#ai-调用代理)
- [RPA 矩阵](#rpa-矩阵)
- [定金支付](#定金支付)
- [成交 / 分成结算](#成交--分成结算)
- [合规](#合规)
- [学员自助端](#学员自助端)
- [企业微信](#企业微信)
- [平台总控台](#平台总控台)
- [监控](#监控)

---

## 认证

### POST /api/auth/login
登录，获取 JWT。

**请求**
```json
{ "username": "admin", "password": "..." }
```

**响应**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGci...",
    "user": {
      "id": 1, "username": "admin", "name": "甲方管理员",
      "role": "admin", "tenant": "platform",
      "phone": null, "wechatWorkUserId": null, "isActive": true
    }
  },
  "error": null
}
```

### GET /api/auth/me
当前用户。

### POST /api/auth/change-password
```json
{ "oldPassword": "...", "newPassword": "..." }
```

### GET /api/auth/users
列表。admin 看全部，tenant_admin 只看本 tenant。

### POST /api/auth/users
创建用户。
```json
{
  "username": "specialist2",
  "password": "abc123",
  "name": "赵六",
  "role": "specialist",
  "phone": "13900000000",
  "wechatWorkUserId": "zhao_liu",
  "tenant": "default"  // 仅 admin 可指定
}
```

### PATCH /api/auth/users/:id
部分更新（`name / phone / wechatWorkUserId / isActive / password`）。

---

## 公开端点（无需登录）

| 端点 | 用途 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/metrics` | Prometheus 指标（可选 Bearer） |
| `POST /api/auth/login` | 登录 |
| `POST /api/lead-forms/:id/submit` | H5 留资提交 |
| `GET /api/lead-forms/:id` | 获取表单配置（附协议文本）|
| `POST /api/deposits` | 学员下单定金 |
| `GET /api/deposits/:outTradeNo` | 查询订单（学员轮询用）|
| `POST /api/deposits/webhook/notify` | 微信支付回调 |
| `POST /api/wechat-work/webhook/message` | 企微外部消息回调 |
| `POST /api/student/request-code` | 学员请求验证码 |
| `POST /api/student/verify-code` | 学员验证码登录 |

---

## 线索

### GET /api/leads
查询参数：`status / source / intent / search / needsFollowup=true / needsPayment=true / sortBy=latest|priority|intent`

### POST /api/leads
```json
{
  "source": "小红书",
  "nickname": "小王",
  "contact": "13800000000",
  "intent": "high",
  "status": "new",
  "assignee": "zhangsan",
  "lastMessage": "想了解专升本"
}
```

### GET /api/leads/:id
单条。跨 tenant 返回 404。

### PATCH /api/leads/:id
部分更新。

---

## 跟进 / 报价 / 报名 / 缴费

### GET /api/leads/:id/follow-ups
### POST /api/leads/:id/follow-ups
```json
{
  "channel": "phone",
  "content": "电话沟通，学员对会计学感兴趣",
  "nextAction": "明天发对比表",
  "nextFollowupAt": "2026-04-25T14:00:00Z"
}
```

### POST /api/leads/:id/follow-up-actions
跟进+状态变更+最新消息更新的**事务型**端点（保存按钮调用）。

### GET / POST /api/leads/:id/enrollment
报名推进（schoolName / majorName / stage / note）。

### GET / POST /api/leads/:id/payment
缴费登记。

### GET / POST /api/leads/:id/proposal-card
报价单 / 方案单。

---

## 内容工厂

### GET /api/content/reviews
审核队列。

### POST /api/content/reviews
```json
{
  "title": "专升本 3 大误区",
  "type": "qa",
  "platforms": ["xhs", "dy"],
  "body": {
    "xhs": { "title": "...", "content": "...", "imageDesc": "..." },
    "dy":  { "title": "...", "content": "...", "imageDesc": "..." }
  }
}
```

### PATCH /api/content/reviews/:id
`status=approved` 时自动为每个平台创建 RPA 发布任务。
```json
{ "status": "approved" }
```

### GET /api/content/calendar
查询时段内的内容 + 已排队的发布任务。
- 查询参数：`from`（默认 -3 天）, `to`（默认 +14 天）

### PATCH /api/content/tasks/:taskId/schedule
调整单个 queued 任务的发布时间。
```json
{ "scheduledAt": "2026-04-25T20:30:00Z" }
```

### GET /api/content/records
已发布内容列表。

---

## AI 调用代理

所有 AI 调用都从后端代理，Gemini API Key 不暴露给前端。

### POST /api/ai/generate-content
```json
{
  "contentType": "policy",
  "platforms": ["xhs"],
  "requirements": "政策变化 + 数字 + 紧迫感"
}
```

### POST /api/ai/analyze-intent
```json
{
  "nickname": "小红书用户",
  "source": "小红书私信",
  "message": "学费多少钱？",
  "leadId": 123  // 可选，会写入 ai_logs
}
```

### POST /api/ai/recommend-scripts
### POST /api/ai/student-profile

---

## RPA 矩阵

### GET /api/rpa/accounts
9 个账号的状态 + 今日配额使用情况。

### PATCH /api/rpa/accounts/:id
```json
{ "status": "paused", "dailyQuota": 5, "riskNote": "..." }
```

### POST /api/rpa/accounts/:id/cookies
上传加密 cookies（由登录 CLI 生成）。
```json
{ "cookies": [{ "name": "...", "value": "...", "domain": "..." }] }
```

### DELETE /api/rpa/accounts/:id/cookies
登出（清除 cookies）。

### GET /api/rpa/accounts/:id/login-status
```json
{ "loggedIn": true, "status": "active" }
```

### GET /api/rpa/tasks
### POST /api/rpa/tasks
```json
{
  "accountId": 1,
  "type": "publish",  // publish / fetch_dm
  "payload": { "title": "...", "content": "..." },
  "scheduledAt": "2026-04-25T08:30:00Z"
}
```

### GET /api/rpa/messages
抓取到的私信 / 评论。

---

## 定金支付

### POST /api/deposits
**公开端点**。下单，返回 `codeUrl` 用于前端生成二维码。
```json
{ "leadId": 123, "phone": "138..." }
```

### GET /api/deposits/:outTradeNo
**公开端点**。学员轮询订单状态用。

### POST /api/deposits/webhook/notify
**公开端点**，微信支付回调。自动 AEAD_AES_256_GCM 解密。

### POST /api/deposits/:outTradeNo/refund
**admin / tenant_admin**。申请退款。
```json
{ "reason": "学员已缴清全额学费" }
```

### GET /api/deposits
**admin / tenant_admin**。订单列表。

---

## 成交 / 分成结算

### GET /api/deals
按 tenant 自动过滤。

### POST /api/deals
```json
{
  "leadId": 123,
  "schoolName": "广东开放大学",
  "majorName": "会计学",
  "totalTuitionYuan": 28000,
  "commissionRate": 0.30,
  "depositId": 45,
  "note": "..."
}
```
**特殊**：创建时自动检测"无跟进/近 30 天无跟进"疑似绕单。

### PATCH /api/deals/:id
更新缴款 / 分成结算状态。

### GET /api/deals/summary
**admin / tenant_admin**。分成汇总。

### GET /api/settlement/reports
### POST /api/settlement/reports/generate
```json
{ "period": "2026-04" }
```

### GET /api/settlement/reports/:period/csv
下载月报 CSV。

---

## 合规

### GET /api/agreements
### GET /api/agreements/:id
### POST /api/agreements
```json
{ "type": "privacy_policy", "version": "v2.0", "content": "# 新版隐私政策..." }
```
新版本会自动把旧版本设为 is_active=0。

### POST /api/agreements/:id/legal-review
```json
{ "reviewedBy": "XX 律所 李律师", "approved": true }
```

### GET /api/agreements/compliance/summary
合规概览（生效协议数 / 待复审 / 今日授权 / 建议）。

### GET /api/agreements/consents/list
授权记录列表（可按 phone / agreementId 过滤）。

### GET /api/violation-words
### POST /api/violation-words
### PATCH /api/violation-words/:id
### DELETE /api/violation-words/:id

### GET /api/crawler/sources
### PATCH /api/crawler/sources/:id
### GET /api/crawler/items

### GET /api/audit
审计日志（可按 userId / resourceType / since / until 过滤）。

### GET /api/audit/suspicious-deals

---

## 学员自助端

### POST /api/student/request-code
**公开端点**。
```json
{ "phone": "138..." }
```
返回 `stub: true` 表示验证码打印到日志（未配 SMS 网关）。

### POST /api/student/verify-code
**公开端点**。
```json
{ "phone": "138...", "code": "123456" }
```
返回 `token` 存 sessionStorage，与管理员 JWT 隔离（`kind=student`）。

### GET /api/student/profile
**需要 student token**。返回自己的 lead / enrollment / payment / materials / deposits。

---

## 企业微信

### GET /api/wechat-work/status
配置状态（configured / corpId / agentId / contactSecretConfigured）。

### POST /api/wechat-work/send-test
```json
{ "toUser": "zhangsan", "content": "测试消息" }
```

### GET /api/wechat-work/follow-users
配置了客户联系的员工 userid 列表。

### POST /api/wechat-work/contacts/sync
```json
{ "userId": "zhangsan" }  // 可选；不填同步全部
```

### POST /api/wechat-work/webhook/message
**公开端点**。企微外部消息回调，自动入 audit_logs。

---

## 平台总控台（仅 admin+platform）

### GET /api/platform/overview
跨租户聚合：各乙方数据、系统健康、平台总计。

### GET /api/platform/trend
近 30 天线索 + 成交趋势。

### GET /api/platform/jobs
作业队列统计 + 最近 50 条作业历史。

---

## 监控

### GET /api/metrics
Prometheus text format。可选 `METRICS_BEARER_TOKEN` 环境变量保护。

## 状态码

| Code | 含义 |
|------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 参数错误（`error` 字段说明原因）|
| 401 | 未登录 / token 无效 |
| 403 | 权限不足 |
| 404 | 资源不存在（或跨租户访问）|
| 409 | 冲突（如 username 重复）|
| 429 | 限流（验证码发送频率过高）|
| 500 | 服务器内部错误 |

---

## cURL 快速调试速查

```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' | jq -r '.data.token')

# 查看 me
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/auth/me

# 查看线索
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8787/api/leads?status=new&sortBy=priority"

# 生成测评报告（公开端点，不需要 token）
curl -X POST http://localhost:8787/api/lead-forms/1/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "phone": "13800000000",
    "answers": { "education": "大专毕业", "goal": "考公 / 考编", "time": "5-10 小时", "budget": "1-2 万", "concern": "学费贵 / 难负担" },
    "consentChecked": true
  }'

# 查询订单
curl http://localhost:8787/api/deposits/ADM20260423120000abcd1234
```
