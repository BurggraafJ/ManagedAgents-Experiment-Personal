#!/usr/bin/env python3
"""
cron_utils.py — Berekent next_run_at op basis van een cron-expressie.

Gebruik:
    python cron_utils.py "0 17 * * 1-5"
    python cron_utils.py "0 8,14,18 * * *" --after "2026-04-12T14:00:00+02:00"
    python cron_utils.py "0 9 * * 1" --format iso
    python cron_utils.py "0 9 2 * *" --format human

Output:
    ISO 8601 timestamp van de eerstvolgende run na 'after' (default: nu)
    in tijdzone Europe/Amsterdam
"""

import sys
import argparse
from datetime import datetime

# Auto-install croniter als niet aanwezig
try:
    from croniter import croniter
except ImportError:
    import subprocess
    subprocess.run(
        [sys.executable, '-m', 'pip', 'install', 'croniter', '--break-system-packages', '-q'],
        capture_output=True
    )
    from croniter import croniter

try:
    import pytz
    TZ = pytz.timezone('Europe/Amsterdam')
except ImportError:
    import subprocess
    subprocess.run(
        [sys.executable, '-m', 'pip', 'install', 'pytz', '--break-system-packages', '-q'],
        capture_output=True
    )
    import pytz
    TZ = pytz.timezone('Europe/Amsterdam')


def next_run_after(cron_expression: str, after: datetime = None) -> datetime:
    """Geeft de eerstvolgende run na 'after' terug, in Europe/Amsterdam tijdzone."""
    if after is None:
        after = datetime.now(TZ)
    elif after.tzinfo is None:
        after = TZ.localize(after)

    cron = croniter(cron_expression, after)
    return cron.get_next(datetime)


def is_due(cron_expression: str, last_run_at: datetime = None, now: datetime = None) -> bool:
    """
    Geeft True als de agent nu aan de beurt is.

    Een agent is aan de beurt als:
    - last_run_at is None (nooit gerund), OF
    - de volgende geplande run na last_run_at <= now
    """
    if now is None:
        now = datetime.now(TZ)
    if now.tzinfo is None:
        now = TZ.localize(now)

    if last_run_at is None:
        return True  # Nog nooit gerund

    if last_run_at.tzinfo is None:
        last_run_at = TZ.localize(last_run_at)

    next_after_last = next_run_after(cron_expression, after=last_run_at)
    return next_after_last <= now


def format_human(dt: datetime) -> str:
    """Leesbaar formaat: 'ma 13 apr 09:00'"""
    days = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
    months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
              'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
    return f"{days[dt.weekday()]} {dt.day} {months[dt.month-1]} {dt.strftime('%H:%M')}"


def main():
    parser = argparse.ArgumentParser(description='Cron next-run calculator')
    parser.add_argument('cron', help='Cron-expressie (bijv. "0 17 * * 1-5")')
    parser.add_argument('--after', default=None,
                        help='ISO timestamp waarna gezocht wordt (default: nu)')
    parser.add_argument('--format', choices=['iso', 'human', 'sql'], default='iso',
                        help='Outputformaat (default: iso)')
    parser.add_argument('--check-due', action='store_true',
                        help='Print true/false of agent nu aan de beurt is')
    parser.add_argument('--last-run', default=None,
                        help='ISO timestamp van laatste run (voor --check-due)')

    args = parser.parse_args()

    # Parse 'after' timestamp
    after = None
    if args.after:
        try:
            after = datetime.fromisoformat(args.after)
        except ValueError:
            print(f"Fout: ongeldige --after timestamp: {args.after}", file=sys.stderr)
            sys.exit(1)

    # Check-due modus
    if args.check_due:
        last_run = None
        if args.last_run:
            try:
                last_run = datetime.fromisoformat(args.last_run)
            except ValueError:
                print(f"Fout: ongeldige --last-run timestamp: {args.last_run}", file=sys.stderr)
                sys.exit(1)
        result = is_due(args.cron, last_run_at=last_run, now=after)
        print('true' if result else 'false')
        return

    # Bereken next_run_at
    try:
        next_run = next_run_after(args.cron, after=after)
    except Exception as e:
        print(f"Fout bij verwerken cron '{args.cron}': {e}", file=sys.stderr)
        sys.exit(1)

    if args.format == 'iso':
        print(next_run.isoformat())
    elif args.format == 'human':
        print(format_human(next_run))
    elif args.format == 'sql':
        # PostgreSQL-compatibel formaat
        print(next_run.strftime("'%Y-%m-%d %H:%M:%S%z'"))


if __name__ == '__main__':
    main()
