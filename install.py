"""Install the experimental local desktop plugin; never modify Hermes config."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
from zoneinfo import ZoneInfo

LABEL = 'io.github.hermes-token-usage.collector'
MARKER = '.token-usage-install.json'
FILES = ('backend.py', 'plugin.js')
ROOT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def options(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--user-home', type=Path, default=Path.home())
    parser.add_argument('--hermes-home', type=Path)
    parser.add_argument('--no-launchd', action='store_true', help='Install files only; manual collection')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--timezone', default=os.environ.get('HERMES_TOKEN_USAGE_TIMEZONE', 'UTC'))
    args = parser.parse_args()
    args.user_home = args.user_home.expanduser().resolve()
    default_home = args.user_home / '.hermes'
    if args.user_home == Path.home().resolve():
        default_home = Path(os.environ.get('HERMES_HOME', str(default_home)))
    args.hermes_home = (args.hermes_home or default_home).expanduser().resolve()
    if not args.no_launchd:
        if sys.platform != 'darwin':
            parser.error('Automatic scheduling supports macOS only; use --no-launchd')
        if args.user_home != Path.home().resolve():
            parser.error('Alternate user homes require --no-launchd')
    ZoneInfo(args.timezone)
    return args


def targets(args):
    plugin = args.hermes_home / 'desktop-plugins' / 'token-usage'
    data = args.hermes_home / 'token-usage-state'
    plist = args.user_home / 'Library' / 'LaunchAgents' / (LABEL + '.plist')
    # Refuse symlinks before writes/deletes, including dangling symlinks.
    for target in (plugin, data, plist):
        for part in (target, *target.parents):
            if part.is_symlink():
                raise ValueError('Refusing symlink in installation path')
    return plugin, data, plist


def launchctl(action, target):
    command = ['launchctl', action, 'gui/' + str(os.getuid()), str(target)]
    return subprocess.run(command, text=True, capture_output=True)


def install():
    args = options(__doc__)
    plugin, data, plist = targets(args)
    if plugin.exists() or (not args.no_launchd and plist.exists()):
        raise ValueError('Installation target exists; refusing overwrite. Uninstall an owned installation first.')
    print('Install plugin:', plugin)
    print('Keep private state:', data)
    print('Scheduler:', 'manual' if args.no_launchd else 'launchd every 30 seconds')
    if args.dry_run:
        return
    os.umask(0o077)
    plugin.mkdir(parents=True, mode=0o700)
    owned_plist = False
    try:
        data.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(data, 0o700)
        (plugin / 'backend.py').write_bytes((ROOT / 'backend.py').read_bytes())
        config = {'summaryPath': str(data / 'summary.json'), 'timezone': args.timezone}
        source = (ROOT / 'plugin.js').read_text()
        token = "'__HERMES_TOKEN_USAGE_CONFIG__'"
        if source.count(token) != 1:
            raise ValueError('Plugin configuration template missing or duplicated')
        (plugin / 'plugin.js').write_text(source.replace(token, json.dumps(config, ensure_ascii=True)))
        manifest = {'version': 1, 'hashes': {name: digest(plugin / name) for name in FILES}, 'launchd': not args.no_launchd}
        if not args.no_launchd:
            plist.parent.mkdir(parents=True, exist_ok=True)
            payload = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(plugin / 'backend.py'), '--hermes-home', str(args.hermes_home), '--data-dir', str(data), '--timezone', args.timezone], 'RunAtLoad': True, 'StartInterval': 30, 'Umask': 0o077, 'StandardOutPath': str(data / 'collector.log'), 'StandardErrorPath': str(data / 'collector-error.log')}
            with plist.open('xb') as stream:
                plistlib.dump(payload, stream)
            owned_plist = True
            manifest['plist_hash'] = digest(plist)
        (plugin / MARKER).write_text(json.dumps(manifest))
        if owned_plist:
            result = launchctl('bootstrap', plist)
            if result.returncode:
                raise RuntimeError('launchd bootstrap failed: ' + result.stderr.strip())
        print('Installed. Reload desktop plugins if needed. Existing rows baseline on first collection.')
    except BaseException:
        if owned_plist:
            try:
                result = launchctl('bootout', plist)
                # A nonzero exit alone does not reliably prove the job is absent.
                if result.returncode:
                    raise RuntimeError('launchd bootout failed: ' + result.stderr.strip())
            except (OSError, RuntimeError) as cleanup_error:
                raise RuntimeError('Installation cleanup failed; plugin and LaunchAgent preserved because scheduler stop was not confirmed: ' + str(cleanup_error)) from cleanup_error
            plist.unlink(missing_ok=True)
        for name in (*FILES, MARKER):
            (plugin / name).unlink(missing_ok=True)
        plugin.rmdir()
        raise


if __name__ == '__main__':
    try:
        install()
    except (OSError, ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
