# Linux users, groups and permissions

> **Remember in one line:** Linux checks **one** set of permissions per person (owner, else group, else others), and you also need `x` on **every folder** on the way to the file.

## What is it?

Every file has an **owner**, a **group**, and three sets of permissions: for the owner, for members of the group, and for everyone else.

## Why does it exist?

Many users and services share one machine. Nginx, Node.js and PostgreSQL each run as their own user, and permissions stop one of them from reading another's secrets.

## How to read `ls -l`

```
-rw-r----- 1 er-shishir vaultteam 25 Oct  1 10:12 secret.txt
│└┬┘└┬┘└┬┘   └───┬────┘ └───┬───┘
│ │  │  │        owner     group
│ │  │  └ others: ---  (nothing)
│ │  └─── group:  r--  (read)
│ └────── owner:  rw-  (read, write)
└──────── type: - file, d directory, l link
```

| Letter | On a file | On a directory |
| --- | --- | --- |
| `r` | read the contents | list the names inside |
| `w` | change the contents | create, delete, rename files inside |
| `x` | run it as a program | enter it and reach anything inside |

## Numbers (octal)

`r = 4`, `w = 2`, `x = 1`, add them per set.

| Letters | Number | Typical use |
| --- | --- | --- |
| `rw-------` | 600 | secrets: private keys, `.env` |
| `rw-r-----` | 640 | config a service's group must read |
| `rw-r--r--` | 644 | normal file anyone may read |
| `rwxr-xr-x` | 755 | program or folder anyone may use |
| `rwx------` | 700 | private folder |

## How do I use it?

```bash
ls -l file                       # see permissions
chmod 640 file                   # set with numbers
chmod g+w file; chmod o-r file   # change with letters (u g o a, + - =)
chown user:group file            # change owner and group (needs sudo)
chgrp group file                 # change only the group
id                               # my user and groups
id testuser                      # another user's groups
sudo -u testuser cat file        # test access as another user
sudo usermod -aG group user      # add user to group (-a = append!)
sudo gpasswd -d user group       # remove user from group
namei -l /path/to/file           # permissions of every folder on the path
```

## What can go wrong? (and how I troubleshoot "Permission denied")

1. **Who am I?** `id`
2. **Who owns the file, which group?** `ls -l file`
3. **Which set applies to me?** Owner? Then only the owner bits count. In the group? Group bits. Otherwise: others.
4. **Can I enter every folder on the path?** `namei -l /path/to/file`
5. **Did I just change my groups?** Then log in again. My Day 1 problem: `testuser` was added back to `vaultteam`, but its open session still had the old group list. `id` (inside the session) and `id testuser` (from outside) showed different groups. Fix: `exit` and log in again.

## Security problems

- `chmod 777` "fixes" every permission error by giving everyone everything. It is never the right fix.
- `usermod -G` **without** `-a` replaces all of a user's groups. On my own account it could remove me from `sudo`.
- Secrets (database passwords, private keys) should be `600` and owned by the user that needs them.
- `root` ignores almost all permission checks, so `sudo` access is powerful.

## What I learned from doing it

- Group changes only apply to **new** login sessions. On a server, that means restarting the service that runs as that user.

## Quick self-quiz

1. What is `-rw-r-----` in numbers, and who can read the file?
2. A file is `644` but `testuser` gets Permission denied. What else do I check?
3. I added a user to a group and they still can't read the file. Why?
4. Why is `usermod -aG` safer than `usermod -G`?
5. What permissions should a file with a database password have?
