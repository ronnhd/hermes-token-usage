"""All fixtures are synthetic; no real Hermes state is accessed."""
import datetime as dt
import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('backend', ROOT / 'backend.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class Checks(unittest.TestCase):
    def test_discovery_is_dynamic_and_preserves_identity(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            home = pathlib.Path(tmp)
            (home / 'profiles' / 'fake-editor').mkdir(parents=True)
            self.assertEqual(set(b.discover_sources(home)), {'default', 'fake-editor'})
            self.assertFalse((home / 'state.db').exists())

    def test_dst_calendar_and_timezone(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db', timezone='America/New_York')
            now = dt.datetime(2026, 3, 9, 12, tzinfo=dt.timezone.utc).timestamp()
            result = ledger.summary(now)
            self.assertEqual(result['timezone'], 'America/New_York')
            self.assertEqual(result['periods']['day']['start'], dt.datetime(2026, 3, 9, 4, tzinfo=dt.timezone.utc).timestamp())
            # March 1 predates DST and must use UTC-5, not the current UTC-4.
            self.assertEqual(result['periods']['month']['start'], dt.datetime(2026, 3, 1, 5, tzinfo=dt.timezone.utc).timestamp())
            ledger.db.close()

    def test_invalid_counters_do_not_replace_baseline(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db')
            row = dict.fromkeys(b.COUNTERS, 0)
            row.update(session_id='fake-session', billing_provider='fake-provider', input_tokens=10)
            ledger.observe('fake', [row], 100)
            for bad in (-1, 1.2, '2', True):
                with self.assertRaises(ValueError):
                    ledger.observe('fake', [{**row, 'input_tokens': bad}], 110)
            ledger.observe('fake', [{**row, 'input_tokens': 15}], 120)
            self.assertEqual(ledger.summary(120)['periods']['day']['total'], 5)
            ledger.db.close()

    def test_invalid_first_seen_isolated_and_profile_transaction_retained(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            path = pathlib.Path(tmp)
            sources = {name: path / (name + '.db') for name in ('fake-invalid', 'fake-healthy')}
            columns = [k + ' TEXT' for k in b.KEYS] + [k + ' INTEGER' for k in b.COUNTERS] + ['first_seen REAL']
            for source in sources.values():
                with sqlite3.connect(source) as db:
                    db.execute('CREATE TABLE session_model_usage (' + ','.join(columns) + ')')
                    db.execute('INSERT INTO session_model_usage VALUES (' + ','.join('?' for _ in columns) + ')', ['fake'] * len(b.KEYS) + [10, 0, 0, 0, 0, 0] + [1])
            ledger = b.Ledger(path / 'ledger.db')
            self.addCleanup(ledger.db.close)
            b.collect(ledger, sources, now=100)
            for index, bad in enumerate(('not-a-timestamp', b'bad', float('inf'), float('-inf'))):
                with self.subTest(first_seen=bad):
                    with sqlite3.connect(sources['fake-invalid']) as db:
                        db.execute('UPDATE session_model_usage SET input_tokens=15')
                        db.execute('DELETE FROM session_model_usage WHERE task=?', ('fake-new',))
                        db.execute('INSERT INTO session_model_usage VALUES (' + ','.join('?' for _ in columns) + ')', ['fake'] * (len(b.KEYS) - 1) + ['fake-new'] + [5, 0, 0, 0, 0, 0] + [bad])
                    with sqlite3.connect(sources['fake-healthy']) as db:
                        db.execute('UPDATE session_model_usage SET input_tokens=?', (15 + index,))
                    result = b.collect(ledger, sources, now=110 + index)
                    self.assertFalse(result['sources']['fake-invalid']['ok'])
                    self.assertIn('first_seen', result['sources']['fake-invalid']['error'])
                    self.assertTrue(result['sources']['fake-healthy']['ok'])
                    self.assertEqual(result['periods']['day']['total'], 5 + index)
                    self.assertEqual(ledger.db.execute('SELECT observed FROM profiles WHERE profile=?', ('fake-invalid',)).fetchone()[0], 100)
                    self.assertEqual(ledger.db.execute('SELECT counts FROM snapshots WHERE profile=?', ('fake-invalid',)).fetchall(), [('[10, 0, 0, 0, 0, 0]',)])

    def test_first_seen_validation_including_existing_rows_and_baselines(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db')
            self.addCleanup(ledger.db.close)
            row = {**dict.fromkeys(b.COUNTERS, 0), 'session_id': 'fake', 'input_tokens': 10}
            for bad in ('bad', '', b'bad', True, float('nan'), float('inf'), float('-inf')):
                with self.subTest(first_seen=bad), self.assertRaisesRegex(ValueError, 'first_seen'):
                    ledger.observe('fake', [{**row, 'first_seen': bad}], 100)
            self.assertEqual(ledger.db.execute('SELECT count(*) FROM profiles').fetchone()[0], 0)
            ledger.observe('fake', [{**row, 'first_seen': None}], 100)
            with self.assertRaisesRegex(ValueError, 'first_seen'):
                ledger.observe('fake', [{**row, 'first_seen': 'bad', 'input_tokens': 20}], 110)
            ledger.observe('fake', [{**row, 'first_seen': 1.5, 'input_tokens': 15}], 120)
            self.assertEqual(ledger.summary(120)['periods']['day']['total'], 5)

    def test_accounting_compound_key_resets_and_imports(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db')
            row = dict.fromkeys(b.COUNTERS, 0)
            row.update(dict.fromkeys(b.KEYS, 'fake'), first_seen=1, input_tokens=100, output_tokens=20, cache_read_tokens=30, cache_write_tokens=5, reasoning_tokens=10)
            ledger.observe('fake', [row], 100)
            self.assertEqual(ledger.summary(100)['periods']['day']['total'], 0)
            changed = {**row, 'input_tokens': 107, 'output_tokens': 24, 'cache_read_tokens': 33, 'cache_write_tokens': 7, 'reasoning_tokens': 12}
            ledger.observe('fake', [changed], 110)
            self.assertEqual(ledger.summary(110)['periods']['day']['total'], 16)
            ledger.observe('fake', [changed, {**row, 'task': 'fake-import', 'first_seen': 1}], 120)
            self.assertEqual(ledger.summary(120)['periods']['day']['total'], 16)
            ledger.observe('fake', [{**changed, 'input_tokens': 1}], 130)
            self.assertEqual(ledger.summary(130)['anomaly_count'], 1)
            self.assertEqual(ledger.summary(130)['periods']['day']['total'], 16)
            ledger.observe('fake', [{**row, 'task': 'fake-new', 'first_seen': 140}], 150)
            self.assertEqual(ledger.summary(150)['periods']['day']['total'], 171)
            ledger.db.close()

    def test_cross_boundary_and_missing_database_retains_deltas(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            path = pathlib.Path(tmp)
            ledger = b.Ledger(path / 'ledger.db')
            row = dict.fromkeys(b.COUNTERS, 0)
            row.update(session_id='fake', billing_provider='provider/raw:fake', input_tokens=5)
            ledger.observe('fake', [row], 86395, observed_start=86390)
            ledger.observe('fake', [{**row, 'input_tokens': 12}], 86405)
            result = b.collect(ledger, {'fake': path / 'missing.db'}, now=86410)
            self.assertFalse(result['sources']['fake']['ok'])
            self.assertFalse((path / 'missing.db').exists())
            self.assertEqual(result['periods']['day']['total'], 0)
            self.assertEqual(result['periods']['day']['boundary_ambiguous_total'], 7)
            self.assertEqual(result['periods']['week']['total'], 7)
            ledger.db.close()

    def test_synthetic_source_is_read_only_and_missing_schema_reported(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            path = pathlib.Path(tmp)
            source = path / 'source.db'
            with sqlite3.connect(source) as db:
                columns = [k + ' TEXT' for k in b.KEYS] + [k + ' INTEGER' for k in b.COUNTERS] + ['first_seen REAL']
                db.execute('CREATE TABLE session_model_usage (' + ','.join(columns) + ')')
                db.execute('INSERT INTO session_model_usage VALUES (' + ','.join('?' for _ in columns) + ')', ['fake'] * len(b.KEYS) + [1] * len(b.COUNTERS) + [1])
            original = source.read_bytes()
            ledger = b.Ledger(path / 'ledger.db')
            self.assertTrue(b.collect(ledger, {'fake': source}, now=100)['sources']['fake']['ok'])
            with b.read_source(source) as db:
                with self.assertRaises(sqlite3.OperationalError):
                    db.execute('DELETE FROM session_model_usage')
            self.assertEqual(original, source.read_bytes())
            missing_schema = path / 'empty.db'
            sqlite3.connect(missing_schema).close()
            self.assertFalse(b.collect(ledger, {'empty-fake': missing_schema}, now=110)['sources']['empty-fake']['ok'])
            ledger.db.close()

    def test_null_key_is_not_empty_key(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db')
            row = dict.fromkeys(b.COUNTERS, 0)
            ledger.observe('fake', [{**row, 'task': None}, {**row, 'task': ''}], 100)
            self.assertEqual(ledger.db.execute('SELECT count(*) FROM snapshots').fetchone()[0], 2)
            ledger.db.close()

    def test_disappeared_profile_is_reported(self):
        with tempfile.TemporaryDirectory(prefix='.backend-checks-', dir=ROOT) as tmp:
            ledger = b.Ledger(pathlib.Path(tmp) / 'ledger.db')
            ledger.observe('fake-gone', [], 100)
            result = b.collect(ledger, {}, now=110)
            self.assertFalse(result['sources']['fake-gone']['ok'])
            ledger.db.close()

if __name__ == '__main__':
    unittest.main(verbosity=2)
