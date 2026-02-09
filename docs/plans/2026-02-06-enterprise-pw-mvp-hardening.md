# Enterprise PW MVP Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden `enterprise_pw` to a repeatable MVP by standardizing account input aliases, adding sticky proxy with rotate-on-failure retry, and improving per-account observability artifacts.

**Architecture:** Keep existing Playwright + Synpress flow, then add a thin reliability layer in `src/proxy.ts` and fixture-level launch retries. Expose resolved proxy to tests and enrich artifact logs so each run is diagnosable without replaying locally.

**Tech Stack:** TypeScript, Playwright Test, Synpress, Node fs/promises.

### Task 1: Add failing tests for account alias contract and proxy sticky/rotate behavior

**Files:**
- Create: `enterprise_pw/tests/unit/accounts_proxy_contract.spec.ts`
- Modify: `enterprise_pw/package.json`

**Step 1: Write failing tests (RED)**

Add tests for:
- `loadAccounts` accepts alias fields `srp/pk/email/invite_code`.
- `resolveProxyForAccount` reuses sticky proxy for same account label.
- `resolveProxyForAccount` rotates when `forceRotate=true`.

**Step 2: Run test to verify it fails**

Run: `npm --prefix enterprise_pw run test:unit -- enterprise_pw/tests/unit/accounts_proxy_contract.spec.ts`
Expected: FAIL because aliases/rotation contract are not fully implemented.

**Step 3: Commit (after green in Task 2)**

```bash
git add enterprise_pw/tests/unit/accounts_proxy_contract.spec.ts enterprise_pw/package.json
git commit -m "test: add unit tests for account/proxy contract"
```

### Task 2: Implement account alias mapping + sticky proxy rotation and retry

**Files:**
- Modify: `enterprise_pw/src/accounts.ts`
- Modify: `enterprise_pw/src/proxy.ts`
- Modify: `enterprise_pw/src/types.ts`

**Step 1: Minimal implementation (GREEN)**

Implement:
- Account alias support for `srp/pk/email/invite_code` (and keep old keys).
- Sticky proxy cache keyed by account label.
- `resolveProxyForAccount` options: `accountLabel`, `forceRotate`, retry/backoff controls.
- Retry fetching pool proxy with bounded attempts + exponential backoff.

**Step 2: Run unit tests to verify pass**

Run: `npm --prefix enterprise_pw run test:unit -- enterprise_pw/tests/unit/accounts_proxy_contract.spec.ts`
Expected: PASS.

**Step 3: Refactor for clarity**

- Keep parsing helpers pure.
- Keep cache + retry helpers small and deterministic.

### Task 3: Add fixture-level launch retry and expose resolved proxy to test artifacts

**Files:**
- Modify: `enterprise_pw/tests/fixtures/metaMaskFixturesWithProxy.ts`
- Modify: `enterprise_pw/tests/luckyx.spec.ts`

**Step 1: Write/adjust failing integration expectation (RED-lite)**

- Update `luckyx.spec.ts` to rely on fixture-provided resolved proxy.
- Expect `run.info` to log resolved proxy when proxy pool is used.

**Step 2: Implement (GREEN)**

- Retry persistent context launch on proxy-related failure (`PROXY_LAUNCH_RETRIES`, backoff).
- Rotate proxy between retries (`forceRotate=true` from second attempt).
- Attach resolved proxy to fixtures and log masked credentials into `run.info`.
- Add step-level log entries for connect/sign/tx checkpoints.

**Step 3: Verify targeted test run**

Run: `npm --prefix enterprise_pw test -- --list`
Expected: command succeeds and test suite still discoverable.

### Task 4: Final verification and docs sync

**Files:**
- Modify: `ENGINEERING_GUIDELINES.md` (if behavior contract changes)

**Step 1: Full verification**

Run:
- `npm --prefix enterprise_pw run typecheck`
- `npm --prefix enterprise_pw run test:unit`

Expected:
- Typecheck exit 0.
- Unit tests pass.

**Step 2: Record residual risk**

- Note that live E2E still requires real MetaMask/LuckyX environment and cannot be fully asserted in CI without secrets.
