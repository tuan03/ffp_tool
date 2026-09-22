---
trigger: always_on
description: Enforces FFP Tool branch discipline, focused task workflow, safe Git behavior, and required handoff format.
---

# Git, Task Discipline, and Handoff

## Branch discipline

Never implement task work directly on `main`.

Before editing code:

1. inspect `git status`;
2. confirm the current branch;
3. preserve unrelated local changes;
4. start task work from the latest safe `main` when repository state permits.

If a remote exists and the worktree is safe, the documented flow is:

```bash
git switch main
git pull --ff-only
git switch -c <type>/<scope>-<short-description>
```

Do not perform destructive Git operations to force this state.

One focused task gets one branch.

Branch pattern:

```text
<type>/<scope>-<short-description>
```

Allowed task types:

- `feature`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`

Use only repository-approved scopes from `AGENTS.md`. If a newly added module has no approved scope yet, do not invent one silently; ask for direction or follow an explicit branch name supplied by the user/leader.

The short description must be lowercase kebab-case, start with a verb, and describe one outcome.

Do not use vague branch names, personal names, or dates.

Commit subject format:

```text
<type>(<scope>): <imperative summary>
```

## Git safety

- Do not force-push.
- Do not rebase a shared branch.
- Do not amend a commit already handed to another person.
- Do not merge your own branch into `main` without leader instruction.
- Do not delete/reset/revert another person's work without explicit instruction.
- Do not commit `dist/`, `node_modules/`, secrets, local environment files, or production data.
- Stage only files belonging to the focused task.

## Step-by-Step Commit Discipline (Kỷ luật Commit theo từng Bước)

- Khi agent hoàn thành xong code và nghiệm thu xong một Bước (Step / Stage, ví dụ B1, B2, B3, B4...), agent **BẮT BUỘC phải tạo commit cho Bước đó trước khi chuyển sang Bước tiếp theo**.
- Không được gom gộp code của nhiều Bước vào một commit lớn khi chưa commit từng bước riêng biệt.
- Mỗi commit cho một Bước chỉ stage các file thuộc phạm vi Bước đó (source code, tests, fixtures, docs nghiệm thu tương ứng).
- Định dạng commit theo từng bước: `<type>(module-seo): implement Stage B<X> - <Stage Name>`.

## Agent task contract

Every coding task should establish:

1. exact ownership scope;
2. branch name;
3. expected behavior and acceptance criteria;
4. whether public contracts, routes, environment settings, dependencies, or shared code may change;
5. required tests/commands;
6. files/folders that must not be changed.

If one of these is materially ambiguous and the ambiguity affects architecture or another owner's code, stop and request direction.

## Self-review before finishing

Review the diff for:

- ownership violations;
- forbidden cross-module imports;
- accidental public API expansion;
- naming/type inconsistencies;
- missing error handling;
- mock/real contract drift;
- unintended shared/root edits;
- unrelated formatting or cleanup.

## Required handoff format

Use:

```text
Summary
- <implemented behavior>

Changed files
- <path>: <reason>

Verification
- <command>: <result>

Contract / environment / route changes
- <none, or exact compatibility note>

Remaining TODOs or risks
- <none, or specific item>
```

State exact verification commands and actual results.

Do not claim success for unfinished integration work. Clearly identify remaining TODOs, blockers, or assumptions.
