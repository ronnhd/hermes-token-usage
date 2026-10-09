"""Local token delta ledger. Source databases are always SQLite mode=ro."""
import datetime as dt
import json
import math
import pathlib
import sqlite3
import time
import contextlib
import os
import fcntl
import argparse
from zoneinfo import ZoneInfo

COUNTERS = ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'api_call_count')
KEYS = ('session_id', 'model', 'billing_provider', 'billing_base_url', 'billing_mode', 'task')
DEFAULT_TIMEZONE = 'UTC'

class Ledger:
    def __init__(self, path, timezone=DEFAULT_TIMEZONE):
        self.timezone = timezone
        self.tz = ZoneInfo(timezone)
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS snapshots(profile TEXT, key TEXT, counts TEXT, observed REAL, PRIMARY KEY(profile,key))')
        self.db.execute('CREATE TABLE IF NOT EXISTS profiles(profile TEXT PRIMARY KEY, observed REAL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS deltas(id INTEGER PRIMARY KEY, profile TEXT, provider TEXT, lo REAL, hi REAL, counts TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS anomalies(profile TEXT, key TEXT, observed REAL, reason TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value REAL)')
        self.db.commit()

    def observe(self, profile, rows, now, observed_start=None):
        observed_start = now if observed_start is None else min(now,observed_start)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO meta VALUES('installed_at',?)", (now,))
            initialized = self.db.execute('SELECT observed FROM profiles WHERE profile=?', (profile,)).fetchone()
            for row in rows:
                key = json.dumps([row.get(k) for k in KEYS])
                counts = [row.get(k) if row.get(k) is not None else 0 for k in COUNTERS]
                if any(type(v) is not int or v < 0 for v in counts):
                    raise ValueError('Counters must be nonnegative integers or null')
                first_seen = row.get('first_seen')
                if first_seen is None:
                    first_seen = 0  # Unknown creation time cannot establish a new row.
                if type(first_seen) not in (int, float) or not math.isfinite(first_seen):
                    raise ValueError('first_seen must be a finite numeric timestamp or null')
                old = self.db.execute('SELECT counts, observed FROM snapshots WHERE profile=? AND key=?', (profile,key)).fetchone()
                if old:
                    delta = [a-b for a,b in zip(counts,json.loads(old[0]))]
                    lo = old[1]
                elif initialized and first_seen > initialized[0]:
                    delta = counts
                    lo = initialized[0]
                else:
                    delta = [0] * len(COUNTERS)
                    lo = now
                if any(v < 0 for v in delta):
                    self.db.execute('INSERT INTO anomalies VALUES(?,?,?,?)',(profile,key,now,'counter decreased; entire row rebaselined'))
                elif any(delta):
                    self.db.execute('INSERT INTO deltas(profile,provider,lo,hi,counts) VALUES(?,?,?,?,?)', (profile,row.get('billing_provider') or 'Unknown',lo,now,json.dumps(delta)))
                self.db.execute('INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?)', (profile,key,json.dumps(counts),observed_start))
            self.db.execute('INSERT OR REPLACE INTO profiles VALUES(?,?)',(profile,observed_start))

    def summary(self, now):
        local = dt.datetime.fromtimestamp(now,self.tz)
        day = dt.datetime.combine(local.date(), dt.time.min, tzinfo=self.tz)
        starts = {'day':day.timestamp(),'week':(day-dt.timedelta(days=day.weekday())).timestamp(),'month':day.replace(day=1).timestamp()}
        periods = {}
        for period,start in starts.items():
            groups = {}
            ambiguous = {}
            for profile,provider,lo,hi,raw in self.db.execute('SELECT profile,provider,lo,hi,counts FROM deltas WHERE hi>=? AND hi<=?',(start,now)):
                target = groups if lo >= start else ambiguous
                group = target.setdefault((profile,provider),dict(profile=profile,billing_provider=provider,**dict.fromkeys(COUNTERS,0)))
                for k,v in zip(COUNTERS,json.loads(raw)): group[k] += v
            for g in [*groups.values(), *ambiguous.values()]: g['total'] = sum(g[k] for k in COUNTERS[:4])
            periods[period] = {'start':start,'groups':list(groups.values()),'total':sum(g['total'] for g in groups.values()),'boundary_ambiguous_groups':list(ambiguous.values()),'boundary_ambiguous_total':sum(g['total'] for g in ambiguous.values())}
        installed = self.db.execute("SELECT value FROM meta WHERE key='installed_at'").fetchone()
        return {'schema_version':1, 'generated_at':now, 'timezone':self.timezone, 'history':'No historical per-call totals inferred from cumulative rows.', 'installed_at':installed[0] if installed else None, 'periods':periods, 'anomaly_count':self.db.execute('SELECT count(*) FROM anomalies').fetchone()[0]}

@contextlib.contextmanager
def read_source(path):
    db = sqlite3.connect(pathlib.Path(path).resolve().as_uri()+'?mode=ro', uri=True, timeout=5)
    db.execute('PRAGMA query_only=ON')
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()

def collect(ledger, sources, now=None):
    status = {}
    for profile,path in sources.items():
        try:
            observed_start = now if now is not None else time.time()
            with read_source(path) as db:
                rows = [dict(r) for r in db.execute('SELECT '+','.join([*KEYS,*COUNTERS,'first_seen'])+' FROM session_model_usage')]
            stamp = now if now is not None else time.time()
            ledger.observe(profile,rows,stamp,observed_start=observed_start)
            status[profile] = {'ok':True,'observed_at':stamp,'row_count':len(rows),'providers':sorted({r.get('billing_provider') or 'Unknown' for r in rows})}
        except (sqlite3.Error, OSError, ValueError) as exc:
            status[profile] = {'ok':False,'error':str(exc)}
    for (profile,) in ledger.db.execute('SELECT profile FROM profiles'):
        if profile not in status:
            status[profile] = {'ok': False, 'error': 'Profile no longer discovered; prior ledger retained'}
    result = ledger.summary(now if now is not None else time.time())
    result['sources'] = status
    result['limitations'] = [
        'Totals are observed positive deltas since installation, not complete calendar-period history.',
        'Total = uncached canonical input + output + cache read + cache write. Reasoning is an output subset; never added again.',
        'Sampling every 30s. Cross-boundary intervals are quarantined as ambiguous, not assigned to a date. Sleeps/outages widen intervals.',
        'Observation timestamps measure database persistence, not exact API execution time; delayed queued writes may arrive later.',
        'Newly encountered historical rows are baselined; decreases reset the entire row and flag an anomaly. Deleted rows between polls cannot be recovered.',
        'Only session_model_usage is tracked, including auxiliary tasks. Legacy session-only usage is not attributed to a guessed provider.'
    ]
    return result

def discover_sources(home):
    """Discover directory identities only; never open profile config or create DBs."""
    home = pathlib.Path(home)
    sources = {'default': home / 'state.db'}
    profiles = home / 'profiles'
    if profiles.is_dir():
        for directory in sorted(profiles.iterdir()):
            if directory.is_dir() and not directory.is_symlink():
                if directory.name == 'default':
                    raise ValueError('Named profile default conflicts with root identity')
                sources[directory.name] = directory / 'state.db'
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hermes-home', type=pathlib.Path, default=pathlib.Path(os.environ.get('HERMES_HOME', '~/.hermes')).expanduser())
    parser.add_argument('--data-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent / 'data')
    parser.add_argument('--timezone', default=os.environ.get('HERMES_TOKEN_USAGE_TIMEZONE', DEFAULT_TIMEZONE), help='IANA timezone; defaults to UTC')
    args = parser.parse_args()
    ZoneInfo(args.timezone)  # Fail before creating state if invalid.
    os.umask(0o077)

    data = args.data_dir.expanduser().resolve()
    data.mkdir(mode=0o700,exist_ok=True)
    os.chmod(data,0o700)
    with (data/'collector.lock').open('a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return
        sources = discover_sources(args.hermes_home.expanduser().resolve())
        ledger = Ledger(data/'ledger.db', timezone=args.timezone)
        try:
            result = collect(ledger,sources)
            pending = data/'summary.json.pending'
            pending.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True))
            os.chmod(pending,0o600)
            os.replace(pending,data/'summary.json')
            print(json.dumps({'generated_at':result['generated_at'],'rows':{p:s.get('row_count') for p,s in result['sources'].items()},'day_total':result['periods']['day']['total']}))
        finally:
            ledger.db.close()

if __name__ == '__main__':
    main()
