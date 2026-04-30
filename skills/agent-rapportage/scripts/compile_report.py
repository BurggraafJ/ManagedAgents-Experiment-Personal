#!/usr/bin/env python3
"""
Compileert alle JSON runlogs van vandaag tot een dagrapport-datastructuur.

Gebruik:
    python compile_report.py /home/user/agent-reports

Output: print JSON naar stdout met het gecompileerde dagrapport.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from collections import defaultdict


def load_json(path):
    """Laad een JSON-bestand, return None bij fouten."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError, PermissionError) as e:
        print(f"Warning: kon {path} niet laden: {e}", file=sys.stderr)
        return None


def get_today_str():
    """Geef vandaag als YYYY-MM-DD string."""
    return datetime.now().strftime('%Y-%m-%d')


def compile_daily_report(reports_dir):
    """
    Compileer alle runlogs van vandaag tot een rapport-datastructuur.

    Args:
        reports_dir: pad naar /home/user/agent-reports

    Returns:
        dict met het volledige dagrapport
    """
    runs_dir = Path(reports_dir) / 'runs'
    skills_dir = Path(reports_dir) / 'skills'
    config_path = Path(reports_dir) / 'config.json'

    today = get_today_str()

    # Laad config
    config = load_json(config_path) or {}

    # Laad alle skill-registraties
    skills = {}
    if skills_dir.exists():
        for f in skills_dir.glob('*.json'):
            data = load_json(f)
            if data and 'skill' in data:
                skills[data['skill']] = data

    # Laad alle runlogs van vandaag
    today_runs = []
    if runs_dir.exists():
        for f in runs_dir.glob(f'*-{today}T*.json'):
            data = load_json(f)
            if data:
                today_runs.append(data)

    # Sorteer op starttijd
    today_runs.sort(key=lambda r: r.get('started_at', ''))

    # Groepeer per skill
    runs_by_skill = defaultdict(list)
    for run in today_runs:
        runs_by_skill[run.get('skill', 'unknown')].append(run)

    # Compileer per-skill statistieken
    skill_stats = []
    total_runs = 0
    total_success = 0
    total_partial = 0
    total_failed = 0
    total_skipped = 0
    all_errors = []
    all_questions = []

    for skill_name, registration in skills.items():
        runs = runs_by_skill.get(skill_name, [])

        # Tel statussen
        success = sum(1 for r in runs if r.get('status') == 'success')
        partial = sum(1 for r in runs if r.get('status') == 'partial')
        failed = sum(1 for r in runs if r.get('status') == 'failed')
        skipped = sum(1 for r in runs if r.get('status') == 'skipped')

        total_runs += len(runs)
        total_success += success
        total_partial += partial
        total_failed += failed
        total_skipped += skipped

        # Bepaal overall status
        if failed > 0:
            overall_status = 'failed'
        elif partial > 0:
            overall_status = 'partial'
        elif success > 0:
            overall_status = 'success'
        elif skipped > 0:
            overall_status = 'skipped'
        else:
            overall_status = 'inactive'

        # Aggregeer primary metric
        primary_metric_key = registration.get('primary_metric', '')
        primary_metric_total = 0
        for run in runs:
            metrics = run.get('metrics', {})
            if primary_metric_key in metrics:
                val = metrics[primary_metric_key]
                if isinstance(val, (int, float)):
                    primary_metric_total += val

        primary_metric_label = registration.get('metric_labels', {}).get(
            primary_metric_key, primary_metric_key
        )

        # Health check
        health_ok = True
        health_issue = None
        health_rules = registration.get('health_rules', {})

        max_hours = health_rules.get('max_hours_without_run')
        if max_hours and runs:
            last_run_time = max(r.get('finished_at', '') for r in runs)
            if last_run_time:
                try:
                    last_dt = datetime.fromisoformat(last_run_time.replace('Z', '+00:00'))
                    now = datetime.now(timezone.utc)
                    hours_since = (now - last_dt).total_seconds() / 3600
                    if hours_since > max_hours:
                        health_ok = False
                        health_issue = f"Niet gedraaid sinds {last_dt.strftime('%H:%M')} (max: {max_hours}u)"
                except ValueError:
                    pass
        elif max_hours and not runs:
            health_ok = False
            health_issue = f"Geen runs vandaag (verwacht: elke {max_hours}u)"

        min_rate = health_rules.get('min_success_rate_24h')
        if min_rate and len(runs) > 0:
            actual_rate = success / len(runs)
            if actual_rate < min_rate:
                health_ok = False
                health_issue = (health_issue or '') + f" | Success rate {actual_rate:.0%} (min: {min_rate:.0%})"

        # Verzamel errors en questions
        for run in runs:
            for error in run.get('errors', []):
                error['skill'] = skill_name
                error['run_time'] = run.get('started_at', '')
                all_errors.append(error)
            for question in run.get('questions', []):
                question['skill'] = skill_name
                all_questions.append(question)

        # Volgende run
        next_scheduled = None
        if runs:
            last_run = runs[-1]
            next_scheduled = last_run.get('next_scheduled')

        skill_stats.append({
            'skill': skill_name,
            'display_name': registration.get('display_name', skill_name),
            'description': registration.get('description', ''),
            'category': registration.get('category', 'other'),
            'schedule': registration.get('schedule', 'onbekend'),
            'runs_today': len(runs),
            'success': success,
            'partial': partial,
            'failed': failed,
            'skipped': skipped,
            'overall_status': overall_status,
            'primary_metric_key': primary_metric_key,
            'primary_metric_label': primary_metric_label,
            'primary_metric_total': primary_metric_total,
            'health_ok': health_ok,
            'health_issue': health_issue,
            'next_scheduled': next_scheduled,
        })

    # Sorteer: fouten eerst, dan warnings, dan succes
    status_order = {'failed': 0, 'inactive': 1, 'partial': 2, 'success': 3, 'skipped': 4}
    skill_stats.sort(key=lambda s: status_order.get(s['overall_status'], 5))

    # Week overzicht (afgelopen 7 dagen)
    week_summary = []
    for days_ago in range(6, -1, -1):
        day = datetime.now() - timedelta(days=days_ago)
        day_str = day.strftime('%Y-%m-%d')
        day_name = day.strftime('%a')

        day_runs = []
        if runs_dir.exists():
            for f in runs_dir.glob(f'*-{day_str}T*.json'):
                data = load_json(f)
                if data:
                    day_runs.append(data)

        if day_runs:
            week_summary.append({
                'date': day_str,
                'day_name': day_name,
                'total': len(day_runs),
                'success': sum(1 for r in day_runs if r.get('status') == 'success'),
                'partial': sum(1 for r in day_runs if r.get('status') == 'partial'),
                'failed': sum(1 for r in day_runs if r.get('status') == 'failed'),
                'is_today': day_str == today,
            })

    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'date': today,
        'date_display': datetime.now().strftime('%A %d %B %Y'),
        'summary': {
            'total_runs': total_runs,
            'total_success': total_success,
            'total_partial': total_partial,
            'total_failed': total_failed,
            'total_skipped': total_skipped,
            'skills_registered': len(skills),
            'skills_active_today': sum(1 for s in skill_stats if s['runs_today'] > 0),
        },
        'skills': skill_stats,
        'errors': all_errors,
        'questions': all_questions,
        'week_summary': week_summary,
        'config': config,
    }


def cleanup_old_runlogs(reports_dir, retention_days=30):
    """Verwijder runlogs ouder dan retention_days."""
    runs_dir = Path(reports_dir) / 'runs'
    if not runs_dir.exists():
        return 0

    cutoff = datetime.now() - timedelta(days=retention_days)
    cutoff_str = cutoff.strftime('%Y-%m-%d')
    removed = 0

    for f in runs_dir.glob('*.json'):
        # Extract datum uit bestandsnaam (format: skill-naam-YYYY-MM-DDT...)
        name = f.stem
        parts = name.split('-')
        # Zoek het datum-deel (YYYY-MM-DD)
        for i, part in enumerate(parts):
            if len(part) == 4 and part.isdigit() and i + 2 < len(parts):
                try:
                    date_str = f"{parts[i]}-{parts[i+1]}-{parts[i+2].split('T')[0]}"
                    if date_str < cutoff_str:
                        f.unlink()
                        removed += 1
                    break
                except (IndexError, ValueError):
                    pass

    return removed


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Gebruik: python compile_report.py /home/user/agent-reports", file=sys.stderr)
        sys.exit(1)

    reports_dir = sys.argv[1]

    # Compileer rapport
    report = compile_daily_report(reports_dir)

    # Optioneel: opruimen
    if '--cleanup' in sys.argv:
        retention = 30
        for arg in sys.argv:
            if arg.startswith('--retention='):
                retention = int(arg.split('=')[1])
        removed = cleanup_old_runlogs(reports_dir, retention)
        report['cleanup'] = {'removed_files': removed, 'retention_days': retention}

    # Output
    print(json.dumps(report, indent=2, ensure_ascii=False))
