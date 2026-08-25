# Project Workflow

## Guiding Principles

1.  **The Plan is the Source of Truth:** All work must be tracked in `plan.md`
2.  **The Tech Stack is Deliberate:** Changes to the tech stack must be
    documented in `tech-stack.md` *before* implementation
3.  **Test-Driven Development:** Write unit tests before implementing
    functionality
4.  **High Code Coverage:** Aim for >80% code coverage for all modules
5.  **User Experience First:** Every decision should prioritize user experience
6.  **Non-Interactive & CI-Aware:** Prefer non-interactive commands. Use
    `CI=true` for watch-mode tools (tests, linters) to ensure single execution.

## Autonomous Orchestration Protocol (自治编排协议)

> 本节由用户于 2026-08-21 授权启用:编排 agent 主导从 track 规划到 DONE 的全流程,
> **所有审批/验收点由编排 agent 代行**,不暂停等待用户;用户事后通过 git log/notes 与
> track 计划文档审计全部决策。

### 角色分工

- **编排 agent(主会话)**:新建 track、拆任务、派发 subagent、验收、提交、推进下一 track;
- **实施 subagent**:每次领一个任务,自包含上下文,完成即返回;
- **用户**:仅在编排 agent 被真正阻塞时介入(如外部凭证缺失、不可逆破坏风险)。

### Subagent Prompt 合同(铁律)

每个派发给 subagent 的 prompt **必须**包含四要素,缺一不可:

1. **目标(Goal)**:可验收的结果描述 + 完成判据(DoD,含必须通过的测试命令);
2. **非目标(Non-goals)**:明确不做的事,防止 scope creep(如"不实现 X,那是下一任务");
3. **改动(Changes)**:预期创建/修改的文件与内容概述;
4. **影响作用域(Blast radius)**:允许触碰的目录/模块清单;禁止触碰的(如 `conductor/`、
   其他 track 的产出、无关包)。

Prompt 必须自包含(仓库路径、相关文档路径、技术栈与铁律约束条目),因为 subagent
没有共享记忆。风格与命名遵守 `code_styleguides/`。

### 验收协议(编排 agent 代行)

- subagent 返回后,编排 agent **必须亲自复跑**其声称通过的测试命令,不信口头报告;
- 任务完成判据包含治理门禁:`pnpm governance` 必须全绿(新增依赖违规、未登记的
  legacy/compat 标记、超限文件/目录都会失败);例外须先登记
  `scripts/governance/exceptions.json` 再写代码(AGENTS.md GR1–GR5);
- **业务优先原则(2026-08-26 授权)**:实施期间治理的行数上限(check-size)不驱动
  代码裁剪或文件拆分——业务功能实现优先,不为凑行数重构。文件按架构归属落位;
  确实超限时**优先登记例外**:超限文件/目录记入
  `scripts/governance/size-baseline.json`(注明在途 track 与处置计划),依赖/兼容
  例外记入 `scripts/governance/exceptions.json`,例外登记由编排 agent 统一执行。
  派发 subagent 的 prompt 必须写明该策略(以及相关 leaf 目录的现值/余量事实),
  subagent 遇治理失败**只如实报告,不自行核算预算、不裁剪代码**;
- `plan.md` 任务状态流转、commit、git notes 由编排 agent 执行;
- Phase Checkpoint 协议中"等待用户确认"(Step 5)由编排 agent 代行:以自动化等效验证
  (测试全绿 + 将手动验证步骤脚本化执行,如 curl/Playwright)作为确认依据,并在 git
  notes 中如实标注"自治验收"及验证证据;
- 验收失败处理:最多两次修复尝试(派回 subagent 或直接修复);仍失败则回滚该任务
  (`conductor-revert` 语义),在计划文档记录原因后继续后续任务,不无限阻塞;
- 每个里程碑(track)结束时系统必须处于可运行状态(GOAL.md 约束),编排 agent 须实际
  启动系统验证,而非仅凭单测通过。

## Task Workflow

All tasks follow a strict lifecycle:

### Standard Task Workflow

1.  **Select Task:** Choose the next available task from `plan.md` in sequential
    order

2.  **Mark In Progress:** Before beginning work, edit `plan.md` and change the
    task from `[ ]` to `[~]`

3.  **Write Failing Tests (Red Phase):**

    -   Create a new test file for the feature or bug fix.
    -   Write one or more unit tests that clearly define the expected behavior
        and acceptance criteria for the task.
    -   **CRITICAL:** Run the tests and confirm that they fail as expected. This
        is the "Red" phase of TDD. Do not proceed until you have failing tests.

4.  **Implement to Pass Tests (Green Phase):**

    -   Write the minimum amount of application code necessary to make the
        failing tests pass.
    -   Run the test suite again and confirm that all tests now pass. This is
        the "Green" phase.

5.  **Refactor (Optional but Recommended):**

    -   With the safety of passing tests, refactor the implementation code and
        the test code to improve clarity, remove duplication, and enhance
        performance without changing the external behavior.
    -   Rerun tests to ensure they still pass after refactoring.

6.  **Verify Coverage:** Run coverage reports using the project's chosen tools.
    For example, in a Python project, this might look like: `bash pytest
    --cov=app --cov-report=html` Target: >80% coverage for new code. The
    specific tools and commands will vary by language and framework.

7.  **Document Deviations:** If implementation differs from tech stack:

    -   **STOP** implementation
    -   Update `tech-stack.md` with new design
    -   Add dated note explaining the change
    -   Resume implementation

8.  **Commit Code Changes:**

    -   Stage all code changes related to the task.
    -   Propose a clear, concise commit message e.g, `feat(ui): Create basic
        HTML structure for calculator`.
    -   Perform the commit.

9.  **Attach Task Summary with Git Notes:**

    -   **Step 9.1: Get Commit Hash:** Obtain the hash of the *just-completed
        commit* (`git log -1 --format="%H"`).
    -   **Step 9.2: Draft Note Content:** Create a detailed summary for the
        completed task. This should include the task name, a summary of changes,
        a list of all created/modified files, and the core "why" for the change.
    -   **Step 9.3: Attach Note:** Use the `git notes` command to attach the
        summary to the commit. `bash # The note content from the previous step
        is passed via the -m flag. git notes add -m "<note content>"
        <commit_hash>`

10. **Get and Record Task Commit SHA:**

    -   **Step 10.1: Update Plan:** Read `plan.md`, find the line for the
        completed task, update its status from `[~]` to `[x]`, and append the
        first 7 characters of the *just-completed commit's* commit hash.
    -   **Step 10.2: Write Plan:** Write the updated content back to `plan.md`.

11. **Commit Plan Update:**

    -   **Action:** Stage the modified `plan.md` file.
    -   **Action:** Commit this change with a descriptive message (e.g.,
        `conductor(plan): Mark task 'Create user model' as complete`).

### Task Correction & Plan Amendment Workflows

When an implemented task or phase requires corrections, amendments, or additions, follow these standard workflows to maintain plan integrity and avoid untracked code drift:

1.  **In-Flight Refinements:** If minor gaps are found while a task is actively
    in-progress (`[~]`), make the adjustments directly in the active
    implementation stream and ensure passing tests before committing.
2.  **Code Review Corrections (`conductor-review`):** If issues are identified
    during or after a code review, instruct the agent to review your changes
    (e.g., *"run a review"* or triggering the action manually in compatible
    clients). The review agent will automatically append a `Review Fixes` phase
    to `plan.md` so that correction tasks are formally tracked and
    checkpointed.
3.  **Logical State Reversions (`conductor-revert`):** If a task implementation
    is fundamentally flawed or needs to be redone, instruct the agent to revert
    the changes (e.g., *"revert the last task"* or triggering the action
    manually in compatible clients). This safely rolls back associated git
    commits and resets the task state in `plan.md` back to pending `[ ]` to
    allow a clean restart.

### Phase Completion Verification and Checkpointing Protocol

**Trigger:** This protocol is executed immediately after a task is completed
that also concludes a phase in `plan.md`.

1.  **Announce Protocol Start:** Inform the user that the phase is complete and
    the verification and checkpointing protocol has begun.

2.  **Ensure Test Coverage for Phase Changes:**

    -   **Step 2.1: Determine Phase Scope:** To identify the files changed in
        this phase, you must first find the starting point. Read `plan.md` to
        find the Git commit SHA of the *previous* phase's checkpoint. If no
        previous checkpoint exists, the scope is all changes since the first
        commit.
    -   **Step 2.2: List Changed Files:** Execute `git diff --name-only
        <previous_checkpoint_sha> HEAD` to get a precise list of all files
        modified during this phase.
    -   **Step 2.3: Verify and Create Tests:** For each file in the list:
        -   **CRITICAL:** First, check its extension. Exclude non-code files
            (e.g., `.json`, `.md`, `.yaml`).
        -   For each remaining code file, verify a corresponding test file
            exists.
        -   If a test file is missing, you **must** create one. Before writing
            the test, **first, analyze other test files in the repository to
            determine the correct naming convention and testing style.** The new
            tests **must** validate the functionality described in this phase's
            tasks (`plan.md`).

3.  **Execute Automated Tests with Proactive Debugging:**

    -   Before execution, you **must** announce the exact shell command you will
        use to run the tests.
    -   **Example Announcement:** "I will now run the automated test suite to
        verify the phase. **Command:** `CI=true npm test`"
    -   Execute the announced command.
    -   If tests fail, you **must** inform the user and begin debugging. You may
        attempt to propose a fix a **maximum of two times**. If the tests still
        fail after your second proposed fix, you **must stop**, report the
        persistent failure, and ask the user for guidance.

4.  **Propose a Detailed, Actionable Manual Verification Plan:**

    -   **CRITICAL:** To generate the plan, first analyze `product.md`,
        `product-guidelines.md`, and `plan.md` to determine the user-facing
        goals of the completed phase.
    -   You **must** generate a step-by-step plan that walks the user through
        the verification process, including any necessary commands and specific,
        expected outcomes.
    -   The plan you present to the user **must** follow this format:

        **For a Frontend Change:** ``` The automated tests have passed. For
        manual verification, please follow these steps:

        **Manual Verification Steps:** 1. **Start the development server with
        the command:** `npm run dev` 2. **Open your browser to:**
        `http://localhost:3000` 3. **Confirm that you see:** The new user
        profile page, with the user's name and email displayed correctly. ```

        **For a Backend Change:** ``` The automated tests have passed. For
        manual verification, please follow these steps:

        **Manual Verification Steps:** 1. **Ensure the server is running.** 2.
        **Execute the following command in your terminal:** `curl -X POST
        http://localhost:8080/api/v1/users -d '{"name": "test"}'` 3. **Confirm
        that you receive:** A JSON response with a status of `201 Created`. ```

5.  **Await Explicit User Feedback:**

    -   After presenting the detailed plan, ask the user for confirmation:
        "**Does this meet your expectations? Please confirm with yes or provide
        feedback on what needs to be changed.**"
    -   **PAUSE** and await the user's response. Do not proceed without an
        explicit yes or confirmation.

6.  **Identify Target Commit for Report:**

    -   Do NOT create a new empty commit for checkpointing.
    -   Identify the hash of the last functional commit made during this phase. This will be the target for the verification report.

7.  **Attach Auditable Verification Report using Git Notes:**

    -   **Step 7.1: Draft Note Content:** Create a detailed verification report
        including the automated test command, the manual verification steps, and
        the user's confirmation.
    -   **Step 7.2: Attach Note:** Use the `git notes` command to attach the full report to the target commit identified in step 6.

8.  **Get and Record Phase Checkpoint SHA:**

    -   **Step 8.1: Get Commit Hash:** Obtain the hash of the *just-created
        checkpoint commit* (`git log -1 --format="%H"`).
    -   **Step 8.2: Update Plan:** Read `plan.md`, find the heading for the
        completed phase, and append the first 7 characters of the commit hash in
        the format `[checkpoint: <sha>]`.
    -   **Step 8.3: Write Plan:** Write the updated content back to `plan.md`.

9.  **Commit Plan Update:**

    -   **Action:** Stage the modified `plan.md` file.
    -   **Action:** Commit this change with a descriptive message following the
        format `conductor(plan): Mark phase '<PHASE NAME>' as complete`.

10. **Announce Completion:** Inform the user that the phase is complete and the
    checkpoint has been created, with the detailed verification report attached
    as a git note.

### Quality Gates

Before marking any task complete, verify:

-   [ ] All tests pass
-   [ ] Code coverage meets requirements (>80%)
-   [ ] Code follows project's code style guidelines (as defined in
    `code_styleguides/`)
-   [ ] All public functions/methods are documented (e.g., docstrings, JSDoc,
    GoDoc)
-   [ ] Type safety is enforced (e.g., type hints, TypeScript types, Go types)
-   [ ] No linting or static analysis errors (using the project's configured
    tools)
-   [ ] Works correctly on mobile (if applicable)
-   [ ] Documentation updated if needed
-   [ ] No security vulnerabilities introduced

## Development Commands

### Setup

```bash
# 安装依赖(pnpm workspaces monorepo)
pnpm install

# 启动 PostgreSQL(postgres:17-alpine,宿主端口 5433;--wait 等 healthcheck 就绪)
docker compose up -d --wait
```

### Daily Development

```bash
# 一键启动 PostgreSQL + Temporal + worker + web
# PostgreSQL 后台运行;其余进程由 concurrently 管理,Ctrl-C 一起停止
pnpm dev:all

# 单元/集成测试(vitest,CI=true 单次执行)
CI=true pnpm vitest run

# 需要关闭后台 PostgreSQL 时
pnpm infra:down
```

### Before Committing

```bash
# 质量门:typecheck(三 workspace)+ eslint + vitest,任一失败即失败
pnpm check

# Playwright E2E(自动拉起 3100 dev server,单次执行)
CI=true pnpm e2e
```

## Testing Requirements

### Unit Testing

-   Every module must have corresponding tests.
-   Use appropriate test setup/teardown mechanisms (e.g., fixtures,
    beforeEach/afterEach).
-   Mock external dependencies.
-   Test both success and failure cases.

### Integration Testing

-   Test complete user flows
-   Verify database transactions
-   Test authentication and authorization
-   Check form submissions

### Mobile Testing

-   Test on actual iPhone when possible
-   Use Safari developer tools
-   Test touch interactions
-   Verify responsive layouts
-   Check performance on 3G/4G

## Code Review Process

### Self-Review Checklist

Before requesting review:

1.  **Functionality**

    -   Feature works as specified
    -   Edge cases handled
    -   Error messages are user-friendly

2.  **Code Quality**

    -   Follows style guide
    -   DRY principle applied
    -   Clear variable/function names
    -   Appropriate comments

3.  **Testing**

    -   Unit tests comprehensive
    -   Integration tests pass
    -   Coverage adequate (>80%)

4.  **Security**

    -   No hardcoded secrets
    -   Input validation present
    -   SQL injection prevented
    -   XSS protection in place

5.  **Performance**

    -   Database queries optimized
    -   Images optimized
    -   Caching implemented where needed

6.  **Mobile Experience**

    -   Touch targets adequate (44x44px)
    -   Text readable without zooming
    -   Performance acceptable on mobile
    -   Interactions feel native

## Commit Guidelines

### Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

-   `feat`: New feature
-   `fix`: Bug fix
-   `docs`: Documentation only
-   `style`: Formatting, missing semicolons, etc.
-   `refactor`: Code change that neither fixes a bug nor adds a feature
-   `test`: Adding missing tests
-   `chore`: Maintenance tasks

### Examples

```bash
git commit -m "feat(auth): Add remember me functionality"
git commit -m "fix(posts): Correct excerpt generation for short posts"
git commit -m "test(comments): Add tests for emoji reaction limits"
git commit -m "style(mobile): Improve button touch targets"
```

## Definition of Done

A task is complete when:

1.  All code implemented to specification
2.  Unit tests written and passing
3.  Code coverage meets project requirements
4.  Documentation complete (if applicable)
5.  Code passes all configured linting and static analysis checks
6.  Works beautifully on mobile (if applicable)
7.  Implementation notes added to `plan.md`
8.  Changes committed with proper message
9.  Git note with task summary attached to the commit

## Emergency Procedures

### Critical Bug in Production

1.  Create hotfix branch from main
2.  Write failing test for bug
3.  Implement minimal fix
4.  Test thoroughly including mobile
5.  Deploy immediately
6.  Document in plan.md

### Data Loss

1.  Stop all write operations
2.  Restore from latest backup
3.  Verify data integrity
4.  Document incident
5.  Update backup procedures

### Security Breach

1.  Rotate all secrets immediately
2.  Review access logs
3.  Patch vulnerability
4.  Notify affected users (if any)
5.  Document and update security procedures

## Deployment Workflow

### Pre-Deployment Checklist

-   [ ] All tests passing
-   [ ] Coverage >80%
-   [ ] No linting errors
-   [ ] Mobile testing complete
-   [ ] Environment variables configured
-   [ ] Database migrations ready
-   [ ] Backup created

### Deployment Steps

1.  Merge feature branch to main
2.  Tag release with version
3.  Push to deployment service
4.  Run database migrations
5.  Verify deployment
6.  Test critical paths
7.  Monitor for errors

### Post-Deployment

1.  Monitor analytics
2.  Check error logs
3.  Gather user feedback
4.  Plan next iteration

## Continuous Improvement

-   Review workflow weekly
-   Update based on pain points
-   Document lessons learned
-   Optimize for user happiness
-   Keep things simple and maintainable
