#!/usr/bin/env python3
"""Consistent PostgreSQL + business files backup; restore only to an empty target."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import urlparse, unquote


def run(args, env=None):
    return subprocess.run(args, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def pg_env():
    url = urlparse(os.environ['PAPOT_DATABASE_URL'])
    if url.scheme not in ('postgres', 'postgresql'):
        raise ValueError('Invalid database URL')
    env = dict(os.environ)
    for key, value in dict(PGHOST=url.hostname, PGPORT=str(url.port or 5432),
                           PGUSER=unquote(url.username or ''), PGPASSWORD=unquote(url.password or ''),
                           PGDATABASE=unquote(url.path.lstrip('/'))).items():
        env[key] = value
    if not env['PGDATABASE']:
        raise ValueError('Database name required')
    return env


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symbolic links are not allowed in a backup')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = digest(path)
    return result


def backup(args):
    target = Path(args.destination).resolve()
    source = Path(args.files).resolve()
    if not source.is_dir() or target.exists() or source == target or source in target.parents:
        raise ValueError('Use an existing files root and a new backup directory outside it')
    if not args.compose_file and not (args.isolated_test and os.environ.get('PAPOT_ISOLATED_TEST') == '1'):
        raise ValueError('A compose file is required to stop all application writers')
    env = pg_env()
    run(['pg_dump', '--version'])
    compose = ['docker', 'compose', '-f', args.compose_file] if args.compose_file else None
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.papot-backup-', dir=target.parent))
    os.chmod(staging, 0o700)
    stopped = False
    try:
        if compose:
            run(compose + ['stop', 'agencement-web'])
            stopped = True
        inventory(source)  # Reject symlinks before copying.
        shutil.copytree(source, staging / 'files', symlinks=True)
        run(['pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file', str(staging / 'database.dump')], env)
        hashes = inventory(staging)
        manifest = {'format': 1, 'revision': args.revision, 'sha256': hashes}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        staging.rename(target)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
        if stopped:
            run(compose + ['start', 'agencement-web'])
    print('Backup completed:', target)


def restore(args):
    source = Path(args.source).resolve()
    target = Path(args.files).resolve()
    manifest = json.loads((source / 'manifest.json').read_text())
    actual = inventory(source)
    actual.pop('manifest.json', None)
    if manifest.get('format') != 1 or actual != manifest.get('sha256'):
        raise ValueError('Backup checksum verification failed')
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError('Restore requires an empty files directory')
    env = pg_env()
    count = run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c',
                 "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')"], env).strip()
    if count != b'0':
        raise ValueError('Restore requires an empty database; existing data will never be overwritten')
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.papot-restore-', dir=target.parent))
    try:
        shutil.copytree(source / 'files', staging / 'files')
        run(['pg_restore', '--dbname', env['PGDATABASE'], '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', str(source / 'database.dump')], env)
        if target.exists():
            target.rmdir()
        (staging / 'files').rename(target)
    finally:
        shutil.rmtree(staging)
    print('Restore completed. Keep the application stopped until the documented checks pass.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    b = commands.add_parser('backup')
    b.add_argument('--files', required=True)
    b.add_argument('--destination', required=True)
    b.add_argument('--compose-file')
    b.add_argument('--revision', required=True)
    b.add_argument('--isolated-test', action='store_true')
    s = commands.add_parser('restore')
    s.add_argument('--source', required=True)
    s.add_argument('--files', required=True)
    args = parser.parse_args()
    try:
        (backup if args.command == 'backup' else restore)(args)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        # Do not print subprocess commands/output containing deployment credentials.
        parser.exit(1, f'Operation failed ({type(error).__name__}). Check prerequisites and application state.\n')


if __name__ == '__main__':
    main()
