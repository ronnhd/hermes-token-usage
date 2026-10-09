"""Synthetic provider-route regressions; never access real usage/config."""
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('backend', ROOT / 'backend.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class ProviderChecks(unittest.TestCase):
    def test_provider_group_identity_excludes_model_task_mode_not_full_endpoint(self):
        import json
        def resolve(model, endpoint, mode='', task='', provider='custom'):
            return b.resolve_provider(provider, json.dumps([model, provider, endpoint, mode, task]), {'alias-a': endpoint, 'alias-b': endpoint})
        a = resolve('model-a', 'https://one.example/private-a')
        other_model = resolve('model-b', 'https://one.example/private-a', 'other-mode', 'other-task')
        other_endpoint = resolve('model-a', 'https://one.example/private-b')
        self.assertIn('provider_identity', a, 'compact UI needs provider identity independent of route identity')
        self.assertEqual(a['provider_identity'], other_model['provider_identity'])
        self.assertNotEqual(a['identity'], other_model['identity'])
        self.assertNotEqual(a['provider_identity'], other_endpoint['provider_identity'])
        self.assertNotIn('private-a', json.dumps(a))
        self.assertNotEqual(a['provider_identity'], resolve('model-a', 'https://one.example/private-a', provider='named')['provider_identity'])
        self.assertNotEqual(a['provider_identity'], b.resolve_provider('custom', None)['provider_identity'])

    def test_explicit_zero_port_is_not_default_endpoint(self):
        self.assertNotEqual(b.normalized_endpoint('https://one.example:0/v1'), b.normalized_endpoint('https://one.example/v1'))
        self.assertEqual(b.normalized_endpoint('https://one.example:443/v1'), b.normalized_endpoint('https://one.example/v1'))

    def test_custom_endpoints_are_not_collapsed(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='.provider-checks-') as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db')
            self.addCleanup(ledger.db.close)
            rows = [{**dict.fromkeys(b.COUNTERS, 0), 'session_id': str(i), 'billing_provider': 'custom', 'billing_base_url': url, 'model': 'fake-model', 'input_tokens': 10} for i, url in enumerate(('https://one.example/v1', 'https://two.example/v1'))]
            ledger.observe('fake', rows, 100)
            ledger.observe('fake', [{**r, 'input_tokens': 15} for r in rows], 110)
            result = ledger.summary(110)['periods']['day']
            self.assertEqual(result['total'], 10)
            self.assertEqual(len(result['groups']), 2, 'custom must retain distinct endpoint identities')

    def test_config_names_and_zero_rows_use_route_resolver(self):
        try:
            import yaml
        except ImportError:
            self.skipTest('Optional config-label test needs PyYAML; run with a PyYAML interpreter')
        import sqlite3
        import json
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='.provider-checks-') as tmp:
            home = pathlib.Path(tmp)
            source = home / 'state.db'
            (home / 'config.yaml').write_text('providers:\n  fake-one:\n    base_url: https://one.example/v1\n  fake-alias:\n    base_url: https://one.example/v1\ncustom_providers:\n  - name: fake-two\n    base_url: https://two.example/v1\n')
            with sqlite3.connect(source) as db:
                columns = [k + ' TEXT' for k in b.KEYS] + [k + ' INTEGER' for k in b.COUNTERS] + ['first_seen REAL']
                db.execute('CREATE TABLE session_model_usage (' + ','.join(columns) + ')')
                db.execute('INSERT INTO session_model_usage VALUES (' + ','.join('?' for _ in columns) + ')', ['fake', 'fake-model', 'custom', 'https://two.example/v1', '', ''] + [10, 0, 0, 0, 0, 0] + [1])
            ledger = b.Ledger(home / 'ledger.db')
            self.addCleanup(ledger.db.close)
            result = b.collect(ledger, {'fake': source}, now=100)
            identity = result['sources']['fake']['provider_identities'][0]
            self.assertEqual(identity['provider_label'], 'fake-two')
            self.assertEqual(result['sources']['fake']['providers'], ['fake-two'])
            with sqlite3.connect(source) as db:
                db.execute('UPDATE session_model_usage SET input_tokens=15')
            result = b.collect(ledger, {'fake': source}, now=110)
            self.assertEqual(result['periods']['day']['groups'][0]['identity'], identity['identity'])
            (home / 'config.yaml').write_text('providers:\n  renamed:\n    base_url: https://two.example/v1\n')
            result = b.collect(ledger, {'fake': source}, now=120)
            self.assertEqual(result['periods']['day']['total'], 5)
            self.assertEqual(result['periods']['day']['groups'][0]['provider_label'], 'renamed')
            (home / 'config.yaml').write_text('providers: [malformed')
            result = b.collect(ledger, {'fake': source}, now=130)
            self.assertTrue(result['sources']['fake']['ok'])
            self.assertFalse(result['sources']['fake']['config_ok'])
            self.assertEqual(result['periods']['day']['total'], 5)
            self.assertNotIn('malformed', json.dumps(result))

    def test_resolver_ambiguity_named_unknown_and_secrets(self):
        import json
        def route(provider='custom', endpoint='https://one.example/v1', model='claude-fake'):
            return json.dumps([model, provider, endpoint, 'fake-mode', 'fake-task'])
        configs = {'fake-openai': 'https://one.example/v1/', 'fake-claude': 'https://ONE.example:443/v1'}
        result = b.resolve_provider('custom', route(), configs)
        self.assertEqual(result['attribution'], 'ambiguous endpoint')
        self.assertEqual(result['provider_candidates'], ['fake-claude', 'fake-openai'])
        self.assertNotIn(result['provider_label'], configs)
        generic_aliases = {**configs, 'custom':'https://one.example/v1'}
        self.assertEqual(b.resolve_provider('custom', route(), generic_aliases)['attribution'], 'ambiguous endpoint')
        self.assertEqual(b.resolve_provider('removed-name', route('removed-name'), configs)['provider_label'], 'removed-name')
        self.assertEqual(b.resolve_provider('fake-claude', route('fake-claude'), configs)['attribution'], 'explicit provider ID')
        self.assertEqual(b.resolve_provider('Unknown', route('', ''), configs)['provider_label'], 'Unknown')
        self.assertEqual(b.resolve_provider('custom', route(endpoint='https://one.example/other'), configs)['attribution'], 'unmatched endpoint')
        secret_url = 'https://FAKE_USER:FAKE_PASSWORD@one.example/FAKE_PATH_SECRET?token=FAKE_QUERY_SECRET#FAKE_FRAGMENT_SECRET'
        result = b.resolve_provider('custom', route(endpoint=secret_url), {'named': secret_url})
        self.assertEqual(result['provider_label'], 'named')
        self.assertEqual(result['endpoint'], 'https://one.example')
        for secret in ('FAKE_USER', 'FAKE_PASSWORD', 'FAKE_PATH_SECRET', 'FAKE_QUERY_SECRET', 'FAKE_FRAGMENT_SECRET'):
            self.assertNotIn(secret, json.dumps(result))

    def test_config_io_failure_is_safe(self):
        from unittest.mock import patch
        with patch.object(pathlib.Path, 'exists', side_effect=PermissionError('FAKE_SECRET_PATH')):
            configs, ok, status = b.read_provider_config('fake/config.yaml')
        self.assertFalse(ok)
        self.assertEqual(configs, {})
        self.assertNotIn('FAKE_SECRET_PATH', status)

    def test_optional_config_helper_and_no_yaml_fallback(self):
        try:
            import yaml
        except ImportError:
            self.skipTest('Helper success check needs a trusted PyYAML interpreter')
        import subprocess
        import sys
        import json
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='.provider-checks-') as tmp:
            home = pathlib.Path(tmp)
            (home / 'config.yaml').write_text('providers:\n  fake-helper:\n    base_url: https://one.example/v1\n    api_key: FAKE_CONFIG_SECRET\n')
            script = "import runpy,sys,json; b=runpy.run_path(sys.argv[1]); print(json.dumps(b['read_provider_config'](sys.argv[2],sys.argv[3] or None)))"
            def run(helper):
                proc = subprocess.run([sys.executable, '-S', '-c', script, str(ROOT/'backend.py'), str(home/'config.yaml'), helper], capture_output=True, text=True)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertNotIn('FAKE_CONFIG_SECRET', proc.stdout + proc.stderr)
                return json.loads(proc.stdout)
            self.assertEqual(run(sys.executable)[:2], [{'fake-helper':'https://one.example/v1'}, True])
            self.assertEqual(run('')[:2], [{}, False])
            self.assertEqual(run(str(home/'nonexistent-python'))[:2], [{}, False])

    def test_migration_preserves_old_counts_without_route_guess(self):
        import sqlite3
        import json
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='.provider-checks-') as tmp:
            path = pathlib.Path(tmp) / 'ledger.db'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE deltas(id INTEGER PRIMARY KEY, profile TEXT, provider TEXT, lo REAL, hi REAL, counts TEXT)')
                db.execute('INSERT INTO deltas VALUES(1,?,?,?,?,?)', ('fake', 'custom', 100, 110, json.dumps([7, 3, 2, 1, 2, 1])))
            ledger = b.Ledger(path)
            ledger.provider_configs = {'fake': {'tempting-name': 'https://one.example/v1'}}
            self.addCleanup(ledger.db.close)
            rows = ledger.db.execute('SELECT id,profile,provider,lo,hi,counts,route FROM deltas').fetchall()
            self.assertEqual(rows, [(1, 'fake', 'custom', 100., 110., '[7, 3, 2, 1, 2, 1]', None)])
            result = ledger.summary(120)['periods']['day']
            self.assertEqual(result['total'], 13)
            self.assertEqual(result['groups'][0]['attribution'], 'legacy unidentified')
            self.assertNotIn('tempting-name', result['groups'][0]['provider_label'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
