"""Remove only unmodified files installed by this package. Preserve all state."""
import json
import sys
from install import FILES, MARKER, digest, launchctl, options, targets


def uninstall():
    args = options(__doc__)
    plugin, data, plist = targets(args)
    marker = plugin / MARKER
    if not marker.is_file() or marker.is_symlink():
        raise ValueError('No owned installation marker; refusing removal')
    manifest = json.loads(marker.read_text())
    if manifest.get('version') != 1 or set(manifest.get('hashes', {})) != set(FILES):
        raise ValueError('Invalid installation marker; refusing removal')
    if set(p.name for p in plugin.iterdir()) != set((*FILES, MARKER)):
        raise ValueError('Unexpected plugin files; move user additions before uninstall')
    for name in FILES:
        path = plugin / name
        if path.is_symlink() or not path.is_file() or digest(path) != manifest['hashes'][name]:
            raise ValueError('Installed files changed; refusing removal: ' + name)
    scheduled = manifest.get('launchd') is True
    if scheduled:
        if args.no_launchd:
            raise ValueError('Installation owns a LaunchAgent; uninstall without --no-launchd')
        if plist.is_symlink() or not plist.is_file() or digest(plist) != manifest.get('plist_hash'):
            raise ValueError('LaunchAgent changed or missing; refusing removal')
    print('Remove owned plugin:', plugin)
    print('Preserve private ledger, summary and logs:', data)
    if args.dry_run:
        return
    if scheduled:
        result = launchctl('bootout', plist)
        # launchctl exit 3 means the service was not loaded.
        if result.returncode not in (0, 3):
            raise RuntimeError('launchd bootout failed; no files removed: ' + result.stderr.strip())
        plist.unlink()
    for name in (*FILES, MARKER):
        (plugin / name).unlink()
    plugin.rmdir()
    print('Uninstalled; ledger preserved. No Hermes profile or configuration was edited.')


if __name__ == '__main__':
    try:
        uninstall()
    except (OSError, ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
