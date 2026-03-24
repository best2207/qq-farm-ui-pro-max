# 安装与首启

当前版本推荐的部署主线已经统一到新的部署脚本体系，而不是旧版零散脚本。

## 标准首装方式

### 在线一键安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/smdk000/qq-farm-ui-pro-max/main/scripts/deploy/install-or-update.sh) --action install
```

### 无交互安装

```bash
WEB_PORT=3080 ADMIN_PASSWORD='你的强密码' NON_INTERACTIVE=1 \
bash <(curl -fsSL https://raw.githubusercontent.com/smdk000/qq-farm-ui-pro-max/main/scripts/deploy/install-or-update.sh) --action install
```

## 安装完成后会发生什么

- 自动检查 Docker / Docker Compose
- 自动创建部署目录
- 自动维护 `/opt/qq-farm-current`
- 自动拉起主程序、MySQL、Redis、ipad860
- 自动执行一次数据库修复脚本

## 离线首装

如果服务器不方便直连外网，推荐使用离线镜像包：

```bash
IMAGE_ARCHIVE=/root/qq-farm-bot-images-amd64.tar.gz \
bash <(curl -fsSL https://raw.githubusercontent.com/smdk000/qq-farm-ui-pro-max/main/scripts/deploy/install-or-update.sh) --action install
```

## 手动部署最少需要哪些文件

- `docker-compose.yml`
- `.env.example`
- `init-db/01-init.sql`
- `install-or-update.sh`
- `update-app.sh`
- `safe-update.sh`
- `repair-mysql.sh`
- `repair-deploy.sh`
- `verify-stack.sh`

## 首装后第一件事

### 验证服务状态

```bash
docker compose ps
curl http://localhost:3080/api/ping
```

### 记录部署入口

```bash
ls -la /opt/qq-farm-current
```

## 当前推荐思路

- 新环境优先使用 `install-or-update.sh`
- 不再推荐把旧版裸机脚本当成主路径
- 需要离线时，也优先走统一部署脚本，只是把镜像来源换成离线包
