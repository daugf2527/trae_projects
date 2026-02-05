# Hybrid Launcher + Dual-Track Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a cross‑platform launcher that chooses Python or Playwright flows, then close the 1‑8 migration gaps with a hybrid strategy.

**Architecture:** Introduce `run.sh` and `run.ps1` as the single entrypoint with shared flags. Standardize env/outputs, then incrementally fill Playwright gaps (invite/email), harden retry/observability, and phase out Selenium once parity is reached.

**Tech Stack:** Bash, PowerShell, Python (Selenium), Node/Playwright (Synpress), dotenv.

### Task 1: Add Bash launcher with smoke test

**Files:**
- Create: `run.sh`
- Create: `scripts/launcher_smoke.sh`

**Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Expect run.sh to support --help and exit 0
out=$(bash ./run.sh --help 2>/dev/null || true)
if [[ "$out" != *"Usage:"* ]]; then
  echo "Expected Usage output"
  exit 1
fi
```

**Step 2: Run test to verify it fails**

Run: `bash scripts/launcher_smoke.sh`
Expected: FAIL (run.sh missing)

**Step 3: Write minimal implementation**

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Usage: ./run.sh --mode <python|pw> [--env <path>] [--accounts <path>] [--headless] [--base-url <url>] [--artifacts-dir <path>] [--dry-run]
USAGE
  exit 0
fi

echo "Usage: ./run.sh --mode <python|pw> ..." >&2
exit 2
```

**Step 4: Run test to verify it passes**

Run: `bash scripts/launcher_smoke.sh`
Expected: PASS

**Step 5: Commit**

```bash
git add run.sh scripts/launcher_smoke.sh
git commit -m "feat: add bash launcher skeleton"
```

### Task 2: Add PowerShell launcher with smoke test

**Files:**
- Create: `run.ps1`
- Create: `scripts/launcher_smoke.ps1`

**Step 1: Write the failing test**

```powershell
$ErrorActionPreference = 'Stop'
$out = pwsh -File ./run.ps1 --help 2>$null
if ($out -notmatch 'Usage:') { throw 'Expected Usage output' }
```

**Step 2: Run test to verify it fails**

Run: `pwsh -File scripts/launcher_smoke.ps1`
Expected: FAIL (run.ps1 missing)

**Step 3: Write minimal implementation**

```powershell
param(
  [string]$mode,
  [switch]$help
)
if ($help -or $args -contains '--help' -or $args -contains '-h') {
  @'
Usage: ./run.ps1 --mode <python|pw> [--env <path>] [--accounts <path>] [--headless] [--base-url <url>] [--artifacts-dir <path>] [--dry-run]
'@
  exit 0
}
Write-Error 'Usage: ./run.ps1 --mode <python|pw> ...'
exit 2
```

**Step 4: Run test to verify it passes**

Run: `pwsh -File scripts/launcher_smoke.ps1`
Expected: PASS

**Step 5: Commit**

```bash
git add run.ps1 scripts/launcher_smoke.ps1
git commit -m "feat: add powershell launcher skeleton"
```

### Task 3: Add shared flag parsing + dry‑run output

**Files:**
- Modify: `run.sh`
- Modify: `run.ps1`
- Modify: `scripts/launcher_smoke.sh`
- Modify: `scripts/launcher_smoke.ps1`

**Step 1: Write the failing test**

```bash
# scripts/launcher_smoke.sh (append)
cmd=$(bash ./run.sh --mode python --dry-run)
[[ "$cmd" == *"python3"*"main.py"* ]] || exit 1
```

```powershell
# scripts/launcher_smoke.ps1 (append)
$out = pwsh -File ./run.ps1 --mode pw --dry-run
if ($out -notmatch 'playwright test') { throw 'Expected dry-run command' }
```

**Step 2: Run test to verify it fails**

Run: `bash scripts/launcher_smoke.sh` and `pwsh -File scripts/launcher_smoke.ps1`
Expected: FAIL

**Step 3: Write minimal implementation**

```bash
# run.sh (replace body)
MODE=""; ENV_FILE=""; ACCOUNTS=""; HEADLESS="false"; BASE_URL=""; ARTIFACTS_DIR=""; DRY_RUN="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --env) ENV_FILE="$2"; shift 2;;
    --accounts) ACCOUNTS="$2"; shift 2;;
    --headless) HEADLESS="true"; shift 1;;
    --base-url) BASE_URL="$2"; shift 2;;
    --artifacts-dir) ARTIFACTS_DIR="$2"; shift 2;;
    --dry-run) DRY_RUN="true"; shift 1;;
    --help|-h) exec bash "$0" --help;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
 done

if [[ -z "$MODE" ]]; then echo "Missing --mode" >&2; exit 2; fi

ENV_EXPORTS=()
[[ -n "$ENV_FILE" ]] && ENV_EXPORTS+=("DOTENV_PATH=$ENV_FILE")
[[ -n "$ACCOUNTS" ]] && ENV_EXPORTS+=("ACCOUNTS_FILE=$ACCOUNTS")
[[ -n "$BASE_URL" ]] && ENV_EXPORTS+=("BASE_URL=$BASE_URL")
[[ -n "$ARTIFACTS_DIR" ]] && ENV_EXPORTS+=("ARTIFACTS_DIR=$ARTIFACTS_DIR")
[[ "$HEADLESS" == "true" ]] && ENV_EXPORTS+=("HEADLESS=true")

if [[ "$MODE" == "python" ]]; then
  CMD=(python3 main.py)
else
  CMD=(npm --prefix enterprise_pw test)
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "${ENV_EXPORTS[*]} ${CMD[*]}"
  exit 0
fi

((${#ENV_EXPORTS[@]})) && export ${ENV_EXPORTS[*]}
"${CMD[@]}"
```

```powershell
# run.ps1 (replace body)
param(
  [string]$mode,
  [string]$env,
  [string]$accounts,
  [switch]$headless,
  [string]$baseUrl,
  [string]$artifactsDir,
  [switch]$dryRun,
  [switch]$help
)
if ($help -or $args -contains '--help' -or $args -contains '-h') {
  @'
Usage: ./run.ps1 --mode <python|pw> [--env <path>] [--accounts <path>] [--headless] [--base-url <url>] [--artifacts-dir <path>] [--dry-run]
'@
  exit 0
}
if (-not $mode) { Write-Error 'Missing --mode'; exit 2 }

$envs = @{}
if ($env) { $envs.DOTENV_PATH = $env }
if ($accounts) { $envs.ACCOUNTS_FILE = $accounts }
if ($baseUrl) { $envs.BASE_URL = $baseUrl }
if ($artifactsDir) { $envs.ARTIFACTS_DIR = $artifactsDir }
if ($headless) { $envs.HEADLESS = 'true' }

$cmd = if ($mode -eq 'python') { 'python3 main.py' } else { 'npm --prefix enterprise_pw test' }

if ($dryRun) {
  $pairs = $envs.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
  "$($pairs -join ' ') $cmd"
  exit 0
}

$envs.GetEnumerator() | ForEach-Object { [System.Environment]::SetEnvironmentVariable($_.Key, $_.Value) }
if ($mode -eq 'python') { python3 main.py } else { npm --prefix enterprise_pw test }
```

**Step 4: Run test to verify it passes**

Run: `bash scripts/launcher_smoke.sh` and `pwsh -File scripts/launcher_smoke.ps1`
Expected: PASS

**Step 5: Commit**

```bash
git add run.sh run.ps1 scripts/launcher_smoke.sh scripts/launcher_smoke.ps1
git commit -m "feat: add shared launcher flags and dry-run"
```

### Task 4: Standardize artifacts/log directory envs

**Files:**
- Modify: `enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts`
- Modify: `enterprise_pw/playwright.config.ts`
- Modify: `luckyx_automation/config/settings.py`
- Modify: `README.md`

**Step 1: Write the failing test**

```bash
# scripts/launcher_smoke.sh (append)
cmd=$(bash ./run.sh --mode pw --artifacts-dir /tmp/lx-artifacts --dry-run)
[[ "$cmd" == *"ARTIFACTS_DIR=/tmp/lx-artifacts"* ]] || exit 1
```

**Step 2: Run test to verify it fails**

Run: `bash scripts/launcher_smoke.sh`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
const artifactsRoot = process.env.ARTIFACTS_DIR?.trim() || path.join(process.cwd(), 'artifacts')
const dir = path.join(artifactsRoot, sanitizeLabel(accountLabel), testInfo.testId)
```

```ts
// enterprise_pw/playwright.config.ts
use: { ... , outputDir: (env.ARTIFACTS_DIR?.trim() || 'test-results') }
```

```python
# luckyx_automation/config/settings.py
LOGS_DIR = Path(os.getenv("LOGS_DIR", BASE_DIR / "logs"))
```

```md
# README.md (add launcher section with ARTIFACTS_DIR/LOGS_DIR)
```

**Step 4: Run test to verify it passes**

Run: `bash scripts/launcher_smoke.sh`
Expected: PASS

**Step 5: Commit**

```bash
git add enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts enterprise_pw/playwright.config.ts luckyx_automation/config/settings.py README.md
git commit -m "feat: unify artifacts/logs directories via env"
```

### Task 5: Playwright 补齐邀请流程（1）

**Files:**
- Modify: `enterprise_pw/tests/luckyx.spec.ts`
- (Optional) Create: `enterprise_pw/src/luckyxPage.ts`

**Step 1: Write the failing test**

```ts
// add in luckyx.spec.ts
await tryBindInviteCode(page, account.inviteCode ?? '')
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix enterprise_pw test -- -g "邀请"`
Expected: FAIL (function missing)

**Step 3: Write minimal implementation**

```ts
async function tryBindInviteCode(page: Page, inviteCode: string): Promise<void> {
  const code = inviteCode.trim()
  if (!code) return
  const input = page.getByPlaceholder(/invite code|邀请码/i).first()
  if (await input.isVisible().catch(() => false)) {
    await input.fill(code)
    await page.getByRole('button', { name: /confirm|submit|绑定|确认/i }).first().click().catch(() => {})
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix enterprise_pw test -- -g "邀请"`
Expected: PASS

**Step 5: Commit**

```bash
git add enterprise_pw/tests/luckyx.spec.ts
git commit -m "feat: add invite binding in playwright flow"
```

### Task 6: 页面层抽象（2）

**Files:**
- Create: `enterprise_pw/src/luckyxPage.ts`
- Modify: `enterprise_pw/tests/luckyx.spec.ts`

**Step 1: Write the failing test**

```ts
import { LuckyXPage } from '../src/luckyxPage.js'
// replace direct calls with LuckyXPage methods
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix enterprise_pw test -- -g "连接钱包"`
Expected: FAIL (module missing)

**Step 3: Write minimal implementation**

```ts
export class LuckyXPage {
  constructor(private page: Page) {}
  async connect(metamask: any) { /* move connectLuckyX */ }
  async checkIn() { /* move tryDailyCheckIn */ }
  async bindEmail(input: { emailAccount: string; emailPassword: string; emailImapServer: string }) { /* move tryBindEmail */ }
  async bindInvite(code: string) { /* move tryBindInviteCode */ }
}
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix enterprise_pw test -- -g "连接钱包"`
Expected: PASS

**Step 5: Commit**

```bash
git add enterprise_pw/src/luckyxPage.ts enterprise_pw/tests/luckyx.spec.ts
git commit -m "refactor: extract LuckyX page object"
```

### Task 7: 扩展加载策略明确化（3）

**Files:**
- Modify: `enterprise_pw/playwright.config.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

```ts
// README check: add note that Playwright uses bundled Chromium
```

**Step 2: Run test to verify it fails**

Run: `rg -n "Chromium" README.md`
Expected: FAIL (no mention)

**Step 3: Write minimal implementation**

```md
- Playwright 扩展加载要求 persistent context，建议使用自带 Chromium (`npx playwright install chromium`)。
```

**Step 4: Run test to verify it passes**

Run: `rg -n "Chromium" README.md`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: clarify chromium requirement for extensions"
```

### Task 8: 重试/错误分层（5）

**Files:**
- Modify: `enterprise_pw/src/utils.ts`
- Modify: `enterprise_pw/tests/luckyx.spec.ts`

**Step 1: Write the failing test**

```ts
// utils.ts
export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> { /* placeholder */ }
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix enterprise_pw test -- -g "连接钱包"`
Expected: FAIL (no retry usage)

**Step 3: Write minimal implementation**

```ts
export async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 2): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try { return await fn() } catch (err) { lastErr = err }
  }
  throw lastErr
}
```

```ts
// luckyx.spec.ts (wrap key steps)
await withRetry(() => connectLuckyX(page, metamask), 'connect')
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix enterprise_pw test -- -g "连接钱包"`
Expected: PASS

**Step 5: Commit**

```bash
git add enterprise_pw/src/utils.ts enterprise_pw/tests/luckyx.spec.ts
git commit -m "feat: add retry wrapper for flaky steps"
```

### Task 9: 代理认证方案与落地（6）

**Files:**
- Modify: `enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

```ts
// Document proxy auth requirements and CapSolver override
```

**Step 2: Run test to verify it fails**

Run: `rg -n "proxy auth" README.md`
Expected: FAIL

**Step 3: Write minimal implementation**

```md
- 代理包含账号密码时，优先使用 CapSolver 扩展配置注入；否则 Chrome 可能无法认证。
```

**Step 4: Run test to verify it passes**

Run: `rg -n "proxy auth" README.md`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: clarify proxy auth strategy"
```

### Task 10: Selenium 退役路线（7）

**Files:**
- Modify: `README.md`
- Create: `docs/plans/2026-02-05-selenium-retirement.md`

**Step 1: Write the failing test**

```bash
# README should mention retirement criteria
```

**Step 2: Run test to verify it fails**

Run: `rg -n "retire|退役" README.md`
Expected: FAIL

**Step 3: Write minimal implementation**

```md
- Selenium 退役条件：Playwright 覆盖 connect/sign/tx/checkin/email/invite 全流程 + 稳定运行 1 周。
```

```md
# docs/plans/2026-02-05-selenium-retirement.md
- 退役里程碑与回滚策略
```

**Step 4: Run test to verify it passes**

Run: `rg -n "Selenium 退役" README.md`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md docs/plans/2026-02-05-selenium-retirement.md
git commit -m "docs: add selenium retirement criteria"
```

### Task 11: 采用 Synpress/dAppwright 高层 API（8）

**Files:**
- Modify: `enterprise_pw/tests/luckyx.spec.ts`
- Modify: `enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts`

**Step 1: Write the failing test**

```ts
// Replace direct popup actions with MetaMaskClass API where possible
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix enterprise_pw test -- -g "PoC 签名"`
Expected: FAIL if APIs not wired

**Step 3: Write minimal implementation**

```ts
// use MetaMaskClass methods for connect/sign/confirm consistently
```

**Step 4: Run test to verify it passes**

Run: `npm --prefix enterprise_pw test -- -g "PoC 签名"`
Expected: PASS

**Step 5: Commit**

```bash
git add enterprise_pw/tests/luckyx.spec.ts enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts
git commit -m "refactor: use synpress metamask APIs"
```

---

**Plan complete and saved to `docs/plans/2026-02-05-dual-launcher-hybrid-migration.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration
2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
