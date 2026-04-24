# 🚀 服务器部署速查 · 一页搞定

> **不要在本地/开发机运行。** 请登录到你要部署的服务器（≥ 2G 内存）上执行。

---

## 前置条件

```bash
# 服务器需要：
# - Ubuntu 22.04 / Debian 12 / CentOS 8+ 任一
# - 2G 内存 + 20G 磁盘
# - Docker 24+ 和 docker compose v2
# - git、openssl、curl、jq（不装 jq 也行，只影响改密码命令）

# 一键装 Docker（Ubuntu/Debian）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

---

## 5 步部署（复制粘贴）

### Step 1. 拉代码

```bash
# 选一个目录（例如 /opt/admissions）
sudo mkdir -p /opt/admissions && sudo chown $USER:$USER /opt/admissions
cd /opt/admissions

# 拉代码（替换成你的仓库 URL）
git clone <你的仓库 URL> .
cd Admissions_agents
```

### Step 2. 生成 .env

```bash
./docker/deploy.sh init
# 第一次运行会自动生成 .env 文件，并把 JWT_SECRET / RPA_COOKIES_SECRET 填好
# 脚本会告诉你还需要填 GEMINI_API_KEY
```

### Step 3. 填 API Key

```bash
# 打开 .env，只改一行：GEMINI_API_KEY=
# 获取 key：https://aistudio.google.com/apikey
vi .env
```

其他变量**全部可选**，没配就 stub 模式：
- 微信支付 `WECHATPAY_*` 没配 → 定金下单返回 fake 二维码，可演示
- 企微 `WECHAT_WORK_*` 没配 → 通知推送打日志不发
- 阿里云 SMS `ALIYUN_SMS_*` 没配 → 验证码打印到日志

### Step 4. 真正启动

```bash
./docker/deploy.sh init
# 这次会：① 构建 3 个镜像（约 3-5 分钟）
#         ② 注入 seed（默认账号 + 协议 + 9 账号矩阵 + 采集源 + 测评表单）
#         ③ 关闭 seed，正式启动三容器
#         ④ 打印访问地址和默认密码
```

### Step 5. 立即改默认密码

```bash
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}' | jq -r '.data.token')

curl -X POST http://localhost/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"oldPassword":"admin123456","newPassword":"你的新密码至少6位"}'
```

对 `tenant_admin` / `zhangsan` / `lisi` / `wangwu` 重复（默认密码见上面脚本输出）。

---

## 常用运维命令

```bash
./docker/deploy.sh status      # 看容器 + 磁盘 + 健康
./docker/deploy.sh logs server # 跟 server 日志
./docker/deploy.sh logs worker # 跟 worker 日志
./docker/deploy.sh backup      # 备份 SQLite
./docker/deploy.sh upgrade     # git pull + 重建镜像 + 重启
./docker/deploy.sh down        # 停所有容器
./docker/deploy.sh up          # 启动（不重建镜像）
```

---

## 验证部署成功

```bash
# 1. 容器全绿
./docker/deploy.sh status
# 应该看到 3 个容器 Up

# 2. 健康检查
curl http://localhost/api/health
# 应返回 {"success":true,...}

# 3. 前端
curl -I http://localhost/
# 应返回 200 OK

# 4. Prometheus 指标
curl http://localhost/api/metrics | head -20
# 应返回 admissions_jobs_total{...} 等 Prometheus 文本

# 5. 登录测试
curl -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<你的新密码>"}'
```

5 个都 ✅ 就是部署成功。

---

## 访问地址（把 localhost 换成服务器 IP 或绑定域名）

| 路径 | 用途 |
|------|------|
| `http://服务器IP/` | 管理后台（admin/tenant_admin/specialist 登录） |
| `http://服务器IP/assessment?formId=1` | H5 专业测评 |
| `http://服务器IP/portal` | 学员自助端（手机号登录） |
| `http://服务器IP/api/metrics` | Prometheus 指标 |
| `http://服务器IP/api/health` | 健康检查 |

---

## 常见问题 3 个

### Q1：`docker compose build` 卡在 `npm ci` 很久
首次构建需要拉 300MB 依赖。慢是正常的，耐心等 5 分钟。
如果超过 10 分钟，可能是网络问题：
```bash
# 给 npm 换镜像源（docker build 阶段）
# 在 Dockerfile 的 "COPY package.json" 之后加一行：
#   RUN npm config set registry https://registry.npmmirror.com
# 然后 docker compose build --no-cache
```

### Q2：80 端口被占用
```bash
# 改 .env 里的 HTTP_PORT=8080
echo "HTTP_PORT=8080" >> .env
./docker/deploy.sh down
./docker/deploy.sh up
# 访问 http://服务器IP:8080/
```

### Q3：想上 HTTPS（正式用必须）
部署 Let's Encrypt + Nginx 反代：
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# 配置文件见 Execute_Plan/Operator-Runbook.md §2 Step 5
```

---

## 出问题找这里

1. **故障手册 10 类**：[Execute_Plan/Operator-Runbook.md §4](./Execute_Plan/Operator-Runbook.md#4-故障手册常见-10-类)
2. **API 参考**：[Execute_Plan/API-Reference.md](./Execute_Plan/API-Reference.md)
3. **部署完后第一件事**：按 [STOP-HERE.md](./STOP-HERE.md) 看运营路径

---

## 你必须知道的 3 件事

1. **SQLite 数据在** `./docker/data/admissions.db` — 别手删
2. **日志在** `./docker/logs/` — 按日期切割
3. **升级前先备份**：`./docker/deploy.sh backup`

搞定。5 步部署，10 分钟之内能用。
