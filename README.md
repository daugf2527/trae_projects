# LuckyX Web3 Automation Script

这是一个基于 Python + Selenium (undetected-chromedriver) 的 Web3 自动化脚本，专门用于 LuckyX 平台的自动签到、邀请和绑定任务。

## 功能特点

*   **抗指纹检测**: 使用 `undetected-chromedriver` 绕过 Cloudflare 验证。
*   **MetaMask 自动化**: 完整的钱包导入、连接、签名自动化流程。
*   **邮箱自动验证**: 内置 IMAP 客户端，自动读取验证码完成绑定。
*   **POM 设计模式**: 结构清晰，易于维护和扩展。
*   **跨平台**: 支持 Windows, Mac (Intel/M-series), Linux。

## 目录结构

```
luckyx_automation/
├── config/         # 配置文件
├── core/           # 浏览器驱动工厂
├── pages/          # 页面逻辑 (POM)
├── utils/          # 工具类 (邮箱)
└── assets/         # 存放插件 (需手动放入)
main.py             # 入口脚本
requirements.txt    # 依赖列表
.env.example        # 环境变量模版
```

## 快速开始

### 1. 环境准备

确保已安装 Python 3.8+ 和 Google Chrome 浏览器。

```bash
# 安装依赖
pip install -r luckyx_automation/requirements.txt
```

### 2. 准备 MetaMask 插件

由于自动化需要加载插件，你需要下载 MetaMask 的解压版（或 CRX 解压）：

1.  下载 MetaMask Chrome 插件 (推荐下载 CRX 文件并解压，或者找一个已解压的版本)。
2.  将解压后的文件夹重命名为 `metamask-extension`。
3.  放入 `luckyx_automation/assets/` 目录下。
    *   结构应为: `luckyx_automation/assets/metamask-extension/manifest.json` ...

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并填入你的信息：

```bash
cp luckyx_automation/.env.example luckyx_automation/.env
```

*   `METAMASK_SEED_PHRASE`: 你的钱包助记词（脚本会每次自动导入）。
*   `EMAIL_ACCOUNT` / `PASSWORD`: 你的邮箱和应用专用密码（用于读取验证码）。
*   `INVITE_CODE`: 你想绑定的邀请码。

### 4. 运行脚本

```bash
python main.py
```

## 常见问题

*   **Mac M1/M2/M3 用户**: 如果遇到驱动报错，请确保 `undetected-chromedriver` 是最新版。
*   **Cloudflare 卡住**: 脚本内置了等待逻辑，但如果长时间不过，请检查 IP 质量。
*   **MetaMask 选择器失效**: 如果 MetaMask 更新了 UI，需要更新 `pages/metamask.py` 中的 XPATH。

## 免责声明

本脚本仅供学习交流使用，请勿用于非法用途。
