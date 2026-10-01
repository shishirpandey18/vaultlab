# Git basics

> **Remember in one line:** `add` chooses, `commit` saves, `push` shares, `pull` brings back. A conflict is Git asking me to decide.

## What is it?

Git records snapshots (commits) of a project, so I can see every change, go back, and work on several things in parallel. GitHub keeps a copy online.

## The four places

```
working directory ──git add──▶ staging area ──git commit──▶ local repo ──git push──▶ GitHub
       ◀───────────────────────────── git pull ─────────────────────────────────────
```

| Place | What it is |
| --- | --- |
| Working directory | The files I edit |
| Staging area | Changes I chose for the next commit |
| Local repository | My saved commits (on the Mac) |
| Remote (GitHub) | The shared copy |

## Everyday commands

```bash
git status                     # what changed? (red = not staged, green = staged)
git add <file>  /  git add .   # stage
git commit -m "day-01: ..."    # save a snapshot
git push                       # send to GitHub
git pull                       # get changes from GitHub and merge them
git log --oneline --graph      # history as a picture
```

## Branches

A branch is a separate line of commits. When I switch branch, the files on disk really change to that branch's version.

```bash
git switch -c my-branch        # create and switch
git switch main                # go back
git merge my-branch            # bring its commits into the current branch
git branch -d my-branch        # delete after merging
```

## Merge conflicts (what I practised on Day 1)

**Why it happens:** two branches changed the **same lines** of the same file, so Git can't decide which version wins.

**What it looks like:**

```
<<<<<<< HEAD
# VaultLab (30-day project)          ← my current branch
=======
# VaultLab: my password manager lab  ← the branch I am merging in
>>>>>>> practice/conflict
```

**How to fix:**

1. `git status` lists the file as "both modified".
2. Open it, keep the text I want, delete all three marker lines.
3. `git add <file>` (tells Git "resolved").
4. `git commit`, then `git push`.
5. Check: `grep -n "<<<<<<<" <file>` prints nothing.

**Escape hatch:** `git merge --abort` returns to before the merge.

## Rejected push

`Updates were rejected because the remote contains work that you do not have locally` means GitHub has a commit my Mac doesn't. Fix: `git pull` (merge it in), then `git push`.

## Security problems

- Never commit secrets: `.env` files, passwords, private keys. Once pushed to a public repo, consider them leaked, even if deleted later (they stay in the history).
- `.gitignore` lists files Git must never track.

## Quick self-quiz

1. What is the difference between `git add` and `git commit`?
2. When does a merge conflict happen?
3. What do the three marker lines mean, and what do I do with them?
4. My push is rejected. What happened and what do I do?
5. I committed a password by mistake and pushed. Is deleting the file enough?
