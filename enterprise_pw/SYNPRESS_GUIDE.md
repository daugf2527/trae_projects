# LuckyX Synpress 自动化测试指南

本指南介绍如何配置和运行 LuckyX 项目的 Synpress 自动化测试。我们采用了 Playwright + Synpress (v4) 方案，支持 MetaMask 的全自动交互，包括钱包创建、导入、连接和签名。

## 1. 环境准备

确保已安装 Node.js (v20+) 和 npm。

```bash
cd enterprise_pw
npm install
```

## 2. 配置文件

项目依赖根目录下的 `.env` 文件（从 `luckyx_automation/.env` 读取）。确保包含以下变量：

```ini
METAMASK_PASSWORD=your_password
METAMASK_SEED_PHRASE=your_seed_phrase
# 可选
PROXY=http://user:pass@host:port
```

## 3. 钱包缓存生成（关键步骤）

Synpress 使用预生成的 Chrome 用户数据目录来加速测试启动。首次运行或 `.env` 变更后需要执行：

```bash
# 生成钱包配置并构建缓存（强制使用英文界面以提高稳定性）
npm run wallet:cache:force
```

> **注意**：如果遇到 MetaMask 界面语言问题，脚本已内置 fallback 逻辑支持中文界面解锁，但推荐保持缓存为英文环境。

## 4. 运行测试

### 运行所有测试
```bash
npm run test
```

### 运行特定测试（带头模式，方便调试）
```bash
npm run test:headed -- --grep "连接钱包并打开 LuckyX"
```

### 常用参数
- `--debug`: 开启 Playwright 调试模式
- `--timeout=120000`: 设置全局超时时间（毫秒）

## 5. 项目结构

- `tests/luckyx.spec.ts`: 主测试文件，包含业务逻辑
- `tests/fixtures/metaMaskFixturesWithProxy.ts`: 核心 Fixture，封装了 MetaMask 启动、代理配置和异常处理
- `wallet-setup/`: 钱包初始化脚本，用于生成缓存
- `src/`: 辅助工具类（账号加载、代理处理等）

## 6. 常见问题排查

- **MetaMask 解锁失败**：
  - 检查 `.env` 中的密码是否正确
  - 尝试重新生成缓存：`npm run wallet:cache:force`
  - 查看 `test-results/` 下的截图确认当前 UI 状态

- **连接钱包超时**：
  - 网络问题可能导致 MetaMask 加载缓慢，尝试增加超时时间
  - 检查代理配置是否有效

- **LavaMoat 报错**：
  - Synpress 方案通过预加载插件环境天然规避了 LavaMoat 限制，无需像 Selenium 那样进行 CDP 注入。
