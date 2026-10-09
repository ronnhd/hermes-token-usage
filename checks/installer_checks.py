"""Installer runs only inside temporary synthetic homes, never real launchd."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class InstallerChecks(unittest.TestCase):
    def run_script(self, script, home, *args):
        return subprocess.run([sys.executable, str(ROOT / script), '--user-home', str(home), '--no-launchd', *args], text=True, capture_output=True)

    def test_dry_run_install_uninstall_preserves_state(self):
        with tempfile.TemporaryDirectory(prefix='.installer-checks-', dir=ROOT) as tmp:
            home = pathlib.Path(tmp)
            result = self.run_script('install.py', home, '--dry-run')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(home.iterdir()), [])
            result = self.run_script('install.py', home)
            self.assertEqual(result.returncode, 0, result.stderr)
            plugin = home / '.hermes/desktop-plugins/token-usage'
            text = (plugin / 'plugin.js').read_text()
            self.assertIn(str(home / '.hermes/token-usage-state/summary.json'), text)
            self.assertNotIn('__HERMES_TOKEN_USAGE_CONFIG__', text)
            data = home / '.hermes/token-usage-state'
            (data / 'ledger.db').write_bytes(b'FAKE LEDGER SENTINEL')
            result = self.run_script('uninstall.py', home)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(plugin.exists())
            self.assertEqual((data / 'ledger.db').read_bytes(), b'FAKE LEDGER SENTINEL')

    def test_conflicts_and_tampering_refused(self):
        with tempfile.TemporaryDirectory(prefix='.installer-checks-', dir=ROOT) as tmp:
            home = pathlib.Path(tmp)
            self.assertEqual(self.run_script('install.py', home).returncode, 0)
            self.assertNotEqual(self.run_script('install.py', home).returncode, 0)
            plugin = home / '.hermes/desktop-plugins/token-usage/plugin.js'
            plugin.write_text(plugin.read_text() + '\n// user change\n')
            self.assertNotEqual(self.run_script('uninstall.py', home).returncode, 0)
            self.assertTrue(plugin.exists())

    def test_symlink_target_and_extra_files_refused(self):
        with tempfile.TemporaryDirectory(prefix='.installer-checks-', dir=ROOT) as tmp:
            home = pathlib.Path(tmp)
            plugin = home / '.hermes/desktop-plugins/token-usage'
            plugin.parent.mkdir(parents=True)
            outside = home / 'synthetic-outside'
            outside.mkdir()
            plugin.symlink_to(outside, target_is_directory=True)
            self.assertNotEqual(self.run_script('install.py', home).returncode, 0)
            self.assertEqual(list(outside.iterdir()), [])
            plugin.unlink()
            self.assertEqual(self.run_script('install.py', home).returncode, 0)
            (plugin / 'keep.txt').write_text('FAKE USER ADDITION')
            self.assertNotEqual(self.run_script('uninstall.py', home).returncode, 0)
            self.assertTrue((plugin / 'keep.txt').exists())

    def test_launchd_plist_and_failed_bootstrap_rollback(self):
        import importlib.util
        import plistlib
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('installer', ROOT / 'install.py')
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        with tempfile.TemporaryDirectory(prefix='.installer-checks-', dir=ROOT) as tmp:
            home = pathlib.Path(tmp)
            argv = ['install.py', '--user-home', str(home), '--hermes-home', str(home / '.hermes'), '--timezone', 'America/New_York']
            calls = []
            def failed_bootstrap(action, target):
                calls.append(action)
                if action == 'bootstrap':
                    payload = plistlib.loads(target.read_bytes())
                    self.assertEqual(payload['StartInterval'], 30)
                    self.assertTrue(payload['RunAtLoad'])
                    self.assertIn('America/New_York', payload['ProgramArguments'])
                    self.assertEqual(payload['Umask'], 0o077)
                    return subprocess.CompletedProcess([], 1, '', 'SYNTHETIC FAILURE')
                return subprocess.CompletedProcess([], 0, '', '')
            with patch.object(sys, 'argv', argv), patch.object(sys, 'platform', 'darwin'), patch.object(pathlib.Path, 'home', return_value=home), patch.object(installer, 'launchctl', side_effect=failed_bootstrap):
                with self.assertRaises(RuntimeError):
                    installer.install()
            self.assertEqual(calls, ['bootstrap', 'bootout'])
            self.assertFalse((home / '.hermes/desktop-plugins/token-usage').exists())
            self.assertFalse((home / 'Library/LaunchAgents' / (installer.LABEL + '.plist')).exists())
            self.assertTrue((home / '.hermes/token-usage-state').exists())

    def test_failed_rollback_preserves_installation(self):
        import importlib.util
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('installer', ROOT / 'install.py')
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        for failure in (3, 5, OSError('SYNTHETIC LAUNCHCTL UNAVAILABLE')):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(prefix='.installer-checks-', dir=ROOT) as tmp:
                home = pathlib.Path(tmp)
                argv = ['install.py', '--user-home', str(home), '--hermes-home', str(home / '.hermes')]
                calls = []
                def failed_stop(action, target):
                    calls.append(action)
                    if action == 'bootstrap':
                        return subprocess.CompletedProcess([], 1, '', 'SYNTHETIC BOOTSTRAP FAILURE')
                    if isinstance(failure, OSError):
                        raise failure
                    return subprocess.CompletedProcess([], failure, '', 'SYNTHETIC BOOTOUT FAILURE')
                with patch.object(sys, 'argv', argv), patch.object(sys, 'platform', 'darwin'), patch.object(pathlib.Path, 'home', return_value=home), patch.object(installer, 'launchctl', side_effect=failed_stop):
                    with self.assertRaisesRegex(RuntimeError, 'cleanup failed.*preserved'):
                        installer.install()
                self.assertEqual(calls, ['bootstrap', 'bootout'])
                plugin = home / '.hermes/desktop-plugins/token-usage'
                for name in (*installer.FILES, installer.MARKER):
                    self.assertTrue((plugin / name).is_file())
                manifest = json.loads((plugin / installer.MARKER).read_text())
                for name in installer.FILES:
                    self.assertEqual(installer.digest(plugin / name), manifest['hashes'][name])
                plist = home / 'Library/LaunchAgents' / (installer.LABEL + '.plist')
                self.assertEqual(installer.digest(plist), manifest['plist_hash'])
                self.assertTrue((home / '.hermes/token-usage-state').exists())

    def test_installed_collector_cli_uses_fake_home(self):
        with tempfile.TemporaryDirectory(prefix='.installer-checks-', dir=ROOT) as tmp:
            home = pathlib.Path(tmp)
            self.assertEqual(self.run_script('install.py', home, '--timezone', 'UTC').returncode, 0)
            hermes = home / '.hermes'
            data = hermes / 'token-usage-state'
            result = subprocess.run([sys.executable, str(hermes / 'desktop-plugins/token-usage/backend.py'), '--hermes-home', str(hermes), '--data-dir', str(data), '--timezone', 'UTC'], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            snapshot = json.loads((data / 'summary.json').read_text())
            self.assertEqual(snapshot['timezone'], 'UTC')
            self.assertFalse(snapshot['sources']['default']['ok'])
            self.assertFalse((hermes / 'state.db').exists())
            self.assertEqual((data.stat().st_mode & 0o777), 0o700)
            self.assertEqual(((data / 'summary.json').stat().st_mode & 0o777), 0o600)
            self.assertEqual(((data / 'ledger.db').stat().st_mode & 0o777), 0o600)
            self.assertEqual(self.run_script('uninstall.py', home).returncode, 0)

if __name__ == '__main__':
    unittest.main(verbosity=2)
