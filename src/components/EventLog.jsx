import React, { useState } from 'react';
import { LANES } from '../services/trafficApi';

export default function EventLog({
  events = [],
  sqliteSummary = null,
  onRunPythonBatch,
  isRunningPython = false,
  onClearLog,
}) {
  const [filter, setFilter] = useState('ALL');

  const filteredEvents = events.filter((ev) => {
    if (filter === 'ALL') return true;
    return ev.type === filter;
  });

  const activeWaitStats = sqliteSummary?.waiting_time_comparison || {
    fixed_baseline_wait_s: 0,
    adaptive_wait_s: 0,
    wait_reduction_s: 0,
    wait_reduction_pct: 0,
    total_vehicles_evaluated: 0,
    fuel_saved_liters: 0,
    co2_saved_kg: 0,
  };

  return (
    <div className="ops-bottom-grid">
      <section className="ops-panel" aria-label="Timestamped Event Log">
        <div className="ops-panel-header">
          <h2 className="ops-panel-title">EVENT LOG · REAL-TIME TELEMETRY (NEWEST FIRST)</h2>
          <div className="ops-control-group">
            {['ALL', 'CYCLE', 'EMERGENCY', 'INPUT', 'MQTT'].map((tab) => (
              <button
                key={tab}
                type="button"
                className={`ops-btn ${filter === tab ? 'active' : ''}`}
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onClick={() => setFilter(tab)}
              >
                {tab}
              </button>
            ))}
            {typeof onClearLog === 'function' && (
              <button
                type="button"
                className="ops-btn"
                style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                onClick={onClearLog}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="ops-log-list">
          {filteredEvents.length === 0 ? (
            <div style={{ padding: '18px 8px', color: 'var(--text-muted)' }}>
              No telemetry events matching filter ({filter}).
            </div>
          ) : (
            filteredEvents.map((ev) => (
              <div
                key={ev.id}
                className={`ops-log-entry ${ev.type.toLowerCase()}`}
              >
                <span style={{ color: 'var(--text-muted)' }}>{ev.time}</span>
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      ev.type === 'EMERGENCY'
                        ? 'var(--signal-red)'
                        : ev.type === 'MQTT'
                          ? 'var(--signal-amber)'
                          : ev.type === 'INPUT'
                            ? 'var(--signal-green)'
                            : 'var(--accent-cyan)',
                  }}
                >
                  {ev.type}
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{ev.message}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="ops-panel" aria-label="SDG 11 Waiting Time Comparison and SQLite Telemetry">
        <div className="ops-panel-header">
          <div>
            <h2 className="ops-panel-title">SDG 11 BENCHMARK &amp; PYTHON SQLITE TELEMETRY</h2>
            <div className="ops-panel-subtitle" style={{ marginTop: '2px' }}>
              {sqliteSummary
                ? `LIVE DB: data/traffic_history.db · Session: ${sqliteSummary.total_cycles} cycles (${sqliteSummary.historical_total_cycles ?? sqliteSummary.total_cycles} historical)`
                : 'AWAITING PYTHON SQLITE TELEMETRY'}
            </div>
          </div>

          {typeof onRunPythonBatch === 'function' && (
            <button
              type="button"
              className="ops-btn active"
              disabled={isRunningPython}
              onClick={onRunPythonBatch}
            >
              {isRunningPython ? 'Running Python Pipeline...' : 'Run +4 Python Cycles (SQLite)'}
            </button>
          )}
        </div>

        <div
          className="font-mono-tabular"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            justifyContent: 'space-between',
            flex: 1,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--grid-line)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>FIXED-TIMER BASELINE (30s)</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--signal-amber)', marginTop: '3px' }}>
                {Number(activeWaitStats.fixed_baseline_wait_s || 0).toFixed(1)}s
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Avg red wait / queued vehicle
              </div>
            </div>

            <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--grid-line)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ADAPTIVE SIGNAL CONTROL</div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--signal-green)', marginTop: '3px' }}>
                {Number(activeWaitStats.adaptive_wait_s || 0).toFixed(1)}s
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Avg red wait / queued vehicle
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--signal-green-dim)',
              border: '1px solid var(--signal-green)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                MEASURED QUEUE WAIT &amp; EMISSIONS REDUCTION
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {activeWaitStats.total_vehicles_evaluated} vehicles · Idle Fuel Saved:{' '}
                <strong style={{ color: 'var(--accent-cyan)' }}>
                  {Number(activeWaitStats.fuel_saved_liters || 0).toFixed(2)} L
                </strong>{' '}
                · CO2 Avoided:{' '}
                <strong style={{ color: 'var(--signal-green)' }}>
                  {Number(activeWaitStats.co2_saved_kg || 0).toFixed(2)} kg
                </strong>
              </div>
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--signal-green)' }}>
              -{Number(activeWaitStats.wait_reduction_s || 0).toFixed(1)}s (
              {Number(activeWaitStats.wait_reduction_pct || 0).toFixed(1)}%)
            </div>
          </div>

          {sqliteSummary && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '6px',
                paddingTop: '6px',
                borderTop: '1px solid var(--grid-line-subtle)',
                fontSize: '0.69rem',
              }}
            >
              {LANES.map((ln) => (
                <div
                  key={ln}
                  style={{
                    padding: '5px 7px',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--grid-line-subtle)',
                  }}
                >
                  <div style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                    {ln.toUpperCase()} DB AVG
                  </div>
                  <div style={{ color: 'var(--text-primary)', marginTop: '2px' }}>
                    {Number(sqliteSummary.avg_green_time_by_lane?.[ln] || 0).toFixed(1)}s · Peak:{' '}
                    {sqliteSummary.busiest_lane_counts?.[ln] || 0}x
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
