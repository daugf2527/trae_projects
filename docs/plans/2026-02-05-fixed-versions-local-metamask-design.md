# 固定 Playwright/Synpress 版本 + 本地加载 MetaMask 设计

## 目标
- 将 `enterprise_pw` 中 `@playwright/test` 与 `@synthetixio/synpress` 固定到明确版本，避免 `^` 触发隐式升级。
- Playwright 流程优先使用本地固定版本的 MetaMask 扩展，降低 UI 变更导致的不稳定。
- 保持与现有 CapSolver 扩展加载逻辑兼容。

## 非目标
- 不调整 Python/Selenium 侧的扩展加载（已固定使用 `luckyx_automation/assets/metamask-extension`）。
- 不引入新的自动化注册或接口调用能力。

## 方案概述
1. 依赖锁定：
   - `enterprise_pw/package.json` 中将 `@playwright/test` 与 `@synthetixio/synpress` 从 `^` 版本改为固定版本字符串（如 `1.50.0`、`4.1.2`）。
2. 本地扩展优先级：
   - 在 `enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts` 增加本地扩展路径解析：
     - 优先读取环境变量 `METAMASK_EXTENSION_PATH`；若路径存在则使用。
     - 若未设置或无效，则尝试默认路径 `../luckyx_automation/assets/metamask-extension`（相对 `enterprise_pw`）。
     - 两者都不可用时，回退到 `prepareExtension()`（Synpress 默认行为）。
3. 文档更新：
   - README 新增说明：如何固定 MetaMask 扩展目录、默认回退路径与环境变量配置。

## 错误处理
- 若配置了 `METAMASK_EXTENSION_PATH` 但路径不存在，打印警告并回退到默认路径或 `prepareExtension()`。
- 保持 CapSolver 扩展加载逻辑不变。

## 验证
- 在无账号配置环境下不运行 Playwright 测试；仅进行路径存在性检查与 dry-run 验证。
- 若后续补齐账号配置，再用 `npm --prefix enterprise_pw test -- -g "连接钱包"` 做回归。

## 风险与缓解
- 风险：本地扩展目录缺失或版本不匹配导致启动失败。
  - 缓解：保留 `prepareExtension()` 回退逻辑。
- 风险：锁定版本后引入已知 bug。
  - 缓解：保留可手动升级能力（修改固定版本号）。
