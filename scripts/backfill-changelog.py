#!/usr/bin/env python3
"""
backfill-changelog.py — eenmalige backfill van platform_updates.

Leest git log van laatste N dagen, pakt per commit de modified files via
`git show`, en POSTt naar de Supabase Edge Function changelog-record.

Run vanuit dashboard-react/:
  python scripts/backfill-changelog.py [days=10]

De token komt uit een env-var (CHANGELOG_TOKEN) of als 2e argv.
"""
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

URL = "https://ezxihctobrqoklufawim.supabase.co/functions/v1/changelog-record"

def run(cmd):
    return subprocess.check_output(cmd, shell=False, text=True, encoding='utf-8', errors='replace').strip()

def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 10
    token = os.environ.get("CHANGELOG_TOKEN") or (sys.argv[2] if len(sys.argv) > 2 else None)
    if not token:
        print("ERROR: CHANGELOG_TOKEN env-var of 2e argument vereist", file=sys.stderr)
        sys.exit(2)

    shas = run(["git", "log", f"--since={days} days ago", "--pretty=format:%H", "main"]).splitlines()
    print(f"Backfilling {len(shas)} commits van laatste {days}d…")

    ok = fail = 0
    for sha in shas:
        msg     = run(["git", "log", "-1", "--pretty=format:%s",  sha])
        author  = run(["git", "log", "-1", "--pretty=format:%ae", sha])
        ts      = run(["git", "log", "-1", "--pretty=format:%cI", sha])
        try:
            files = run(["git", "show", "--name-only", "--pretty=format:", sha]).splitlines()
            files = [f for f in files if f.strip()]
        except subprocess.CalledProcessError:
            files = []

        payload = {
            "sha": sha,
            "message": msg,
            "author": author,
            "timestamp": ts,
            "modified": files,
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(URL, data=body, method="POST", headers={
            "Content-Type": "application/json",
            "X-Changelog-Token": token,
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                code = resp.status
                rbody = resp.read().decode("utf-8")
                ok += 1
                short = msg[:60]
                print(f"  {code} {sha[:7]} {short}")
        except urllib.error.HTTPError as e:
            fail += 1
            print(f"  HTTP {e.code} {sha[:7]} {msg[:60]} — {e.read().decode('utf-8', errors='ignore')}")
        except Exception as e:
            fail += 1
            print(f"  FAIL {sha[:7]} {msg[:60]} — {e}")

    print(f"\nKlaar — {ok} ok, {fail} fail")

if __name__ == "__main__":
    main()
