# 更新、修复与回滚

当前版本的升级链路已经围绕“统一更新、先修骨架、再修数据库、最后切版本”组织。

## 标准更新

### 统一更新入口

```bash
/opt/qq-farm-current/install-or-update.sh --action update --preserve-current
```

### 只更新主程序

```bash
cd /opt/qq-farm-current
bash update-app.sh
```

### 升级前先做兜底

```bash
cd /opt/qq-farm-current
bash safe-update.sh
```

## 旧服务器修复

如果你的部署目录缺脚本、缺 current 链接、缺新的 compose 模板，可以先修部署骨架：

```bash
cd /opt/qq-farm-current 2>/dev/null || cd /opt/qq-farm-bot-current 2>/dev/null || cd /opt
curl -fsSLo repair-deploy.sh https://raw.githubusercontent.com/smdk000/qq-farm-ui-pro-max/main/scripts/deploy/repair-deploy.sh
chmod +x repair-deploy.sh
./repair-deploy.sh --backup
```

## 数据库结构修复

```bash
cd /opt/qq-farm-current
bash repair-mysql.sh --backup
```

## 离线更新

```bash
cd /opt/qq-farm-current
bash update-app.sh --image-archive /root/qq-farm-bot-images-amd64.tar.gz
```

## 常见升级顺序

1. 先 `repair-deploy.sh`
2. 再 `repair-mysql.sh`
3. 再 `safe-update.sh` 或 `update-app.sh`
4. 最后 `verify-stack.sh`

## 当前版本的兼容点

- 会维护 `/opt/qq-farm-current`
- 也兼容历史 `/opt/qq-farm-bot-current`
- 更新脚本会继续同步新的部署辅助脚本

## 历史裸机脚本

旧版裸机脚本仍可作为历史兼容参考，但不再是当前推荐主线。

### 轻量守护脚本

```bash
./farm-bot.sh start
./farm-bot.sh stop
./farm-bot.sh restart
./farm-bot.sh status
```

### 查看守护日志

```bash
tail -f logs/farm-bot.log
```

### 说明

- 这套方式适合历史环境或轻量测试。
- 当前生产部署更推荐统一 Docker 安装与更新链路。
