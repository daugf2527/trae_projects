# 本地生成钱包并写入 .env 设计

## 目标
- 提供本地脚本生成助记词 + 私钥。
- 覆盖写入 `luckyx_automation/.env`，写入 `METAMASK_PASSWORD`、`METAMASK_SEED_PHRASE`、`METAMASK_PRIVATE_KEY`。
- 不在终端打印助记词/私钥，避免泄露。

## 方案
1. 新增脚本 `enterprise_pw/scripts/generate-wallet-env.ts`：
   - 使用 `ethers` 的 `Wallet.createRandom()` 生成助记词与私钥。
   - 构建 `.env` 内容并覆盖写入 `luckyx_automation/.env`。
   - 可选 `--output <path>` 用于写入其它位置（如 `/tmp/...`）。
   - 仅输出成功信息与目标路径（可选输出地址）。
2. 在 `enterprise_pw/package.json` 新增 `generate:wallet` 脚本命令。
3. 在根目录 `.gitignore` 确保包含 `luckyx_automation/.env`。

## 错误处理
- 若无法写入目标路径，输出错误并退出非 0。
- 若 `luckyx_automation` 目录不存在，提示用户确认路径。

## 验证
- 不自动运行脚本（避免生成真实密钥）。
- 可选 dry-run：`npm --prefix enterprise_pw run generate:wallet -- --output /tmp/lx.env`。

## 风险与缓解
- 风险：覆盖写入可能丢失用户现有配置。
  - 缓解：说明为覆盖策略；用户可备份。
- 风险：密钥泄露。
  - 缓解：不在终端输出助记词/私钥，`.gitignore` 屏蔽 `.env`。
