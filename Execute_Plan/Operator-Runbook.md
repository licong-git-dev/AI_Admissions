# 招生智能体 · 运维 Runbook

> **读这份文档的人**：负责部署、日常监控、应急响应的运维人员 / 技术负责人
> **不是这份文档的用户**：招生专员、老板、学员 — 他们看 [MVP-Daily-SOP.md](./MVP-Daily-SOP.md) 就够

---

## 目录

1. [部署前准备清单](#1-部署前准备清单)
2. [首次部署 5 步](#2-首次部署-5-步)
3. [日常监控 5 分钟 / 天](#3-日常监控-5-分钟天)
4. [故障手册（常见 10 类）](#4-故障手册常见-10-类)
5. [备份 & 恢复](#5-备份--恢复)
6. [升级流程](#6-升级流程)
7. [容量规划](#7-容量规划)
8. [法律 / 合规事件响应](#8-法律--合规事件响应)

---

## 1. 部署前准备清单

### 硬件

| 组件 | 最低要求 | 推荐 |
|------|---------|------|
| 主服务器（Server + Worker + Frontend） | 2 核 2G，20G 盘 | 2 核 4G，40G 盘 |
| RPA Worker（真实跑 Playwright） | 2 核 2G，10G 盘 | 4 核 8G，40G 盘 |
| 监控机（Prometheus + Grafana，可选） | 1 核 1G | 2 核 2G |

### 第三方账号 / 密钥

| 必要性 | 项目 | 备注 |
|--------|------|------|
| 必须 | Gemini API Key | https://aistudio.google.com/apikey |
| 必须 | 域名 + SSL 证书（Let's Encrypt 免费）| 国内服务器还需备案 |
| 推荐 | 微信支付商户号 + 证书 | 没有则定金走 stub 模式 |
| 推荐 | 企业微信（3 证书 + CorpID / AgentID）| 用于 AI 通知推送 |
| 推荐 | 阿里云 SMS（AccessKey / 签名 / 模板）| 学员登录短信 |
| 推荐 | 云服务器 SSH 密钥 | 替代密码登录 |

### 网络

- 服务器对外：80 / 443（Frontend 暴露）
- 服务器对外：屏蔽 8787（Server 只对 frontend 暴露）
- 服务器对外：屏蔽 3306 / 5432 / 6379（不用数据库 / Redis）
- 出站放行：`qyapi.weixin.qq.com`、`api.mch.weixin.qq.com`、`dysmsapi.aliyuncs.com`、`generativelanguage.googleapis.com`、目标采集白名单域名

---

## 2. 首次部署 5 步

### Step 1：拉代码 + 生成密钥

```bash
# 服务器 ≥ 2G 内存
git clone <repo-url>
cd Admissions_agents
cp .env.docker.example .env

# 生成随机密钥
openssl rand -hex 16   # 复制到 JWT_SECRET
openssl rand -hex 16   # 复制到 RPA_COOKIES_SECRET

# 填入 GEMINI_API_KEY
vi .env
```

### Step 2：首启注入 seed

```bash
# 把 ENABLE_DB_SEED 暂时打开
sed -i 's/^ENABLE_DB_SEED=.*/ENABLE_DB_SEED=true/' .env

docker compose up -d server
sleep 15
docker compose logs server | tail -30   # 确认看到 "running on http://localhost:8787"
```

### Step 3：改默认密码

```bash
# 登录默认 admin 账号
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}' | jq -r '.data.token')

# 改密码（至少 6 位）
curl -X POST http://localhost/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"oldPassword":"admin123456","newPassword":"<你的强密码>"}'
```

对 `tenant_admin` / `zhangsan` / `lisi` / `wangwu` 4 个账号重复上面流程。**默认密码不改就等于系统裸奔。**

### Step 4：关 seed 启动完整服务

```bash
sed -i 's/^ENABLE_DB_SEED=.*/ENABLE_DB_SEED=false/' .env
docker compose up -d   # 启动 server + worker + frontend
docker compose ps      # 三个都应该是 Up
```

### Step 5：配置反向代理 + SSL

```bash
# 主机 Nginx（容器 frontend 监听 80，此处是主机上的 Nginx）
# /etc/nginx/sites-available/admissions
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

# Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

---

## 3. 日常监控 5 分钟 / 天

### 早上 9:00 必看（按顺序）

1. **容器健康**
   ```bash
   docker compose ps
   docker stats --no-stream   # CPU / 内存占用
   ```
   ✅ 三个容器都 Up + 主服务 CPU < 50% + 内存 < 80%

2. **关键指标**（打开 `https://your-domain.com/api/metrics` 或 Grafana）
   ```
   admissions_jobs_total{status="failed"}          # 应 < 10
   admissions_rpa_accounts_logged_in               # 应 ≥ 6（9 个账号中 6 个登录态正常）
   admissions_audit_writes_last_hour               # 应 > 0（说明有人在用）
   ```

3. **审核队列**
   - 登录管理后台 → 内容工厂 → 待审核数 > 5 条 → 当天花 15 分钟审完
   - 同时看内容日历 → 队列任务是否全部 queued 状态正常

4. **疑似异常成交**
   - 合规中心 → 查看「待处理请求」+ 「疑似异常成交」
   - 管理员每天看一眼，发现跨租户 / 绕单立即追查

5. **磁盘 & 日志**
   ```bash
   df -h /            # / 应 < 80%
   du -sh ./docker/data/admissions.db   # SQLite 文件 < 5G（超过需考虑归档）
   tail -50 ./docker/logs/rpa-$(date +%F).log   # RPA 日志
   ```

---

## 4. 故障手册（常见 10 类）

### 4.1 前端打不开

**现象**：访问 `https://your-domain.com/` 白屏或 502

**排查**：
```bash
docker compose ps frontend   # 看是不是 Down
docker compose logs frontend --tail 50   # 看 nginx 错误
curl -I http://localhost/   # 本机能通的话是反代有问题
```

**恢复**：
```bash
docker compose restart frontend
```

---

### 4.2 API 全部 401

**现象**：登录后刷新页面所有 API 报 401

**原因 90% 是**：JWT_SECRET 被改过导致之前的 token 全部失效

**恢复**：
- 不要再改 JWT_SECRET
- 告诉用户重新登录
- 如果要强制所有人下线：故意改一次 JWT_SECRET 然后重启

---

### 4.3 AI 功能 500

**现象**：内容生成 / 意向分析报错

**排查**：
```bash
docker compose logs server | grep -i gemini | tail -20
```

**常见原因**：
- `GEMINI_API_KEY` 失效或超额 → 登录 https://aistudio.google.com/apikey 重置
- 请求被墙 → 服务器需要代理访问 google
- 单条内容过长触发 token limit → 降低输入长度

**临时降级**：Gemini 不可用时，前端仍能工作（showError 会显示兜底文案），但内容工厂 / 意向分析全部失效。

---

### 4.4 RPA 账号全部 cooldown

**现象**：「AI 获客 → 发布矩阵」9 个账号全部红色 cooldown

**原因 90% 是**：服务器重启 / 时间漂移，Playwright 浏览器实例异常

**恢复**：
```bash
# 在有 GUI 的机器（你本地 Mac）上逐个重新登录
npm run worker:login -- 1
npm run worker:login -- 2
# ... 9 次
```

或手动把 `rpa_accounts.status` 批量改回 active：
```bash
docker exec admissions-server sqlite3 /data/admissions.db \
  "UPDATE rpa_accounts SET status='active' WHERE status='cooldown'"
```

**预防**：让健康检查作业每 24h 自动跑。

---

### 4.5 定金支付失败

**现象**：学员扫码后订单一直 pending

**排查**：
```bash
# 看微信支付回调有没有打到服务器
docker compose logs server | grep -i "deposits/webhook" | tail -20
```

**常见原因**：
- `WECHATPAY_NOTIFY_URL` 必须是**公网可访问的 HTTPS**（微信支付强制）
- 商户证书 PEM 文件路径错误 → 看 server 日志
- 回调被防火墙挡了 → 白名单微信 IP 段

**临时方案**：在甲方总控台 → 经营管理 → 成交登记里手动标记已支付。

---

### 4.6 数据库被锁

**现象**：API 响应慢 + 日志出现 `SQLITE_BUSY` / `database is locked`

**原因**：Worker 和 Server 同时长事务

**恢复**：
```bash
docker compose restart server worker
# 如果反复出现，说明数据量已经到 SQLite 瓶颈，考虑迁移到 Postgres
```

---

### 4.7 企微通知没收到

**现象**：新成交了但甲方管理员没收到企微推送

**排查顺序**：
1. 检查 `users.wechat_work_userid` 是否填了该管理员的企微 userid
2. 检查 `WECHAT_WORK_APP_SECRET` 是否配置
3. `GET /api/wechat-work/status` 看后端判断是否 configured=true
4. 检查服务器能否访问 `https://qyapi.weixin.qq.com`
5. 通过「经营管理 → 企业微信 → 发送测试消息」验证单链路

---

### 4.8 磁盘塞满

**现象**：系统响应慢，`df -h` 发现 / 100%

**快速释放**：
```bash
# 1. Docker 镜像清理
docker image prune -af

# 2. 日志清理（保留最近 7 天）
find ./docker/logs -name "*.log" -mtime +7 -delete

# 3. 审计日志自动清理已生效（60 天），如果需要提前可手工
docker exec admissions-server sqlite3 /data/admissions.db \
  "DELETE FROM audit_logs WHERE datetime(created_at) < datetime('now', '-30 days')"

# 4. 已完成 job 历史
docker exec admissions-server sqlite3 /data/admissions.db \
  "DELETE FROM jobs WHERE status IN ('succeeded','failed') AND datetime(finished_at) < datetime('now', '-3 days')"
```

**长期**：accrual 磁盘监控告警 + 日志切割。

---

### 4.9 SMS 验证码发不出

**现象**：学员登录页收不到短信

**排查**：
1. `GET /api/student/request-code` 返回 stub=true → SMS 没配置
2. 返回 stub=false 但错误 → 阿里云后台看调用日志
3. 常见：签名没审核通过 / 模板没审核通过 / AccessKey 欠费

**临时方案**：让用户报告手机号，客服在日志里查验证码（stub 模式）。

---

### 4.10 全站 down 紧急恢复

**现象**：服务器重启后 docker 起不来 / 所有容器 Restarting

**5 分钟抢救方案**：
```bash
# 1. 看内存是不是满了
free -h
# 如果 swap 也满了，手动腾空间
docker compose down
swapoff -a && swapon -a

# 2. 看 .env 是不是丢了
cat .env | head -5
# 没有的话从 .env.docker.example 重建

# 3. 重启顺序：server → worker → frontend
docker compose up -d server
sleep 10
docker compose up -d worker frontend
```

**最坏情况**：备份恢复（见 §5）。

---

## 5. 备份 & 恢复

### 每日自动备份

```bash
# 加到主机 crontab
0 3 * * * /usr/local/bin/admissions-backup.sh

# /usr/local/bin/admissions-backup.sh
#!/bin/bash
set -e
BACKUP_DIR=/var/backups/admissions
DATE=$(date +%Y%m%d)
mkdir -p $BACKUP_DIR

# SQLite 在线热备份（better-sqlite3 支持）
docker exec admissions-server sqlite3 /data/admissions.db \
  ".backup /data/backup-$DATE.db"
docker cp admissions-server:/data/backup-$DATE.db $BACKUP_DIR/
docker exec admissions-server rm /data/backup-$DATE.db

# 打包 RPA cookies 加密密钥（不备份 .env 全文）
echo "RPA_COOKIES_SECRET=$(grep RPA_COOKIES_SECRET /opt/admissions/Admissions_agents/.env | cut -d= -f2)" \
  > $BACKUP_DIR/secret-$DATE.env
chmod 600 $BACKUP_DIR/secret-$DATE.env

# 保留 30 天
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
find $BACKUP_DIR -name "*.env" -mtime +30 -delete

# 可选：上传到云存储
# aws s3 cp $BACKUP_DIR/backup-$DATE.db s3://your-bucket/
```

### 恢复

```bash
docker compose down
cp /var/backups/admissions/backup-YYYYMMDD.db ./docker/data/admissions.db
docker compose up -d
```

**恢复后必做**：
1. 所有学员的 sessionStorage token 失效，会强制重新登录（正常）
2. RPA cookies 加密用的 RPA_COOKIES_SECRET 必须是当时备份时的那把密钥
3. 登录管理后台抽查 10 条线索 / 5 条成交记录确认数据完整

---

## 6. 升级流程

### 小版本升级（v2.2 → v2.3）

```bash
cd Admissions_agents
git fetch origin
git tag backup-before-upgrade-$(date +%F)
git pull origin main

# 查看 CHANGELOG 看是否有数据库迁移
less Product-Spec-CHANGELOG.md   # 看顶部新版本

# 重新构建镜像
docker compose build
docker compose up -d

# 验证 /api/health
curl https://your-domain.com/api/health
```

### 大版本升级（v2.x → v3.x）

**禁止**直接升级。步骤：
1. 先在**测试环境**部署新版本
2. 导出生产库快照到测试
3. 测试 1 周（跑完完整的 14 天 SOP）
4. 确认无退化后才在生产升级
5. 生产升级前完整备份（§5）
6. 升级失败立即回滚（`git checkout <backup-tag> && docker compose up -d`）

---

## 7. 容量规划

### SQLite 瓶颈点

| 表 | 记录数瓶颈 | 应对 |
|----|-----------|------|
| `leads` | > 100,000 | 正常，SQLite 能撑到百万级 |
| `audit_logs` | > 500,000 | 已自动清理 60 天，一般不超 |
| `rpa_tasks` | > 100,000 | 已自动清理 7 天 |
| `rpa_messages` | > 200,000 | 考虑加 90 天清理任务 |

**硬瓶颈信号**：SQLite 文件 > 5G 或 SQLITE_BUSY 频繁出现 → 迁移到 Postgres

### Gemini API 额度

| 限制 | 默认 | 应对 |
|------|------|------|
| 每分钟 | 15 次 | 超了会 429，等 1 分钟 |
| 每天 | 1500 次 | 50 个专员每人 30 次就用完 |
| 月费用 | $0 免费额度 | 超过升级到付费套餐 |

**监控指标**：`admissions_ai_calls_last_day` > 1200 时提前准备升级

### Worker 内存

RPA Worker 启动 Playwright 后每个浏览器实例 ~150MB，9 个账号满负荷 ~1.5G 常驻。
**推荐**：Worker 单独一台机器，不要和 Server 共享内存。

---

## 8. 法律 / 合规事件响应

### 8.1 学员投诉虚假宣传

**24 小时内必做**：
1. 登录合规中心 → 违规词库，确认是否有新的违规词需要加
2. 审计日志 → 搜索投诉学员手机号，导出全部沟通记录作为证据
3. 内容工厂 → 搜索含投诉关键词的内容，下线所有命中的
4. 甲方管理员与投诉学员直接沟通，提供正式书面回应

### 8.2 账号被平台警告

**24 小时内必做**：
1. 「AI 获客 → 发布矩阵」该账号状态改为 paused
2. 最近 7 天内该账号发布的所有笔记 → 人工复查是否有违规风险词
3. 如果是全新账号立刻封禁 → 不要救，账号沉默 3 天再试
4. 其他账号**降频**到每天 1 条，观察 1 周

### 8.3 学员要求删除个人信息

**3 个工作日内必做**：
1. 合规中心 → 数据请求，登记该学员请求
2. 管理员执行：
   ```bash
   # 删除 lead 本身
   docker exec admissions-server sqlite3 /data/admissions.db \
     "DELETE FROM leads WHERE contact = '<手机号>'"
   # CASCADE 会自动删除 followups / enrollments / payment_records / proposal_cards
   ```
3. 删除该手机号的 consents / lead_submissions / deposits
4. 在合规中心标记请求为「已处理」+ 生成处理证明 PDF（可用审计日志截图）

### 8.4 数据泄露 / 被撞库

**1 小时内必做**：
1. 立即 `docker compose down`（宁可停服务）
2. 看审计日志最近 24h 的登录记录，找出异常 IP
3. 所有管理员强制改密码
4. 换 JWT_SECRET（所有 token 失效）
5. 换 RPA_COOKIES_SECRET（所有 RPA cookies 失效，逐个重新登录）
6. 72 小时内根据《个人信息保护法》向网信办报告（如果确认有 PII 泄露）

---

## 9. 你必须知道的「隐藏按钮」

| 按钮 | 用法 | 频率 |
|------|------|------|
| `ENABLE_DB_SEED=true` | 只在首次部署 / 空库时用 | 1 次 |
| `RPA_AUTO_SUBMIT=true` | RPA 真正自动点「发布」按钮 | 跑稳后打开 |
| `METRICS_BEARER_TOKEN` | 公网暴露 /api/metrics 时加的 bearer | 暴露给公网 Prometheus 时必开 |
| `ENABLE_DB_SEED + BOOTSTRAP_ADMIN_PASSWORD` | 首次 seed 时用自己的强密码 | 1 次 |
| `SMS_GATEWAY`（已废弃）| 旧环境变量名，改用 `ALIYUN_SMS_*` | — |

---

## 10. 联系 & 升级路径

- 代码仓库：<填>
- 主要维护者：<填>
- 应急联系：<填>
- 文档更新频率：每次 Product-Spec-CHANGELOG 升版本时同步
