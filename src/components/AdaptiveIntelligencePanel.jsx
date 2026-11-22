import React, { useState } from 'react';
import {
  LANES,
  GPIO_PIN_MAP,
  PRIORITY_WEIGHTS,
  MAX_WAITING_TIME,
  PROJECT_AUDIT_MATRIX,
} from '../services/trafficApi';

export default function AdaptiveIntelligencePanel({
  lanesData = {},
  activeGreenLane = 'east',
  phaseStage = 'GREEN',
  predictions = null,
  sqliteSummary = null,
  onTriggerStarvationTest,
  onTriggerPedestrianSurge,
  onTriggerPotentialAccident,
  onTriggerPolicePriority,
}) {
  const [showAuditTable, setShowAuditTable] = useState(false);

  const predData = sqliteSummary?.predictions || predictions;
  const hwInfo = sqliteSummary?.hardware || {};
  const isSimMode = hwInfo.simulation_mode !== undefined ? Boolean(hwInfo.simulation_mode) : true;
  const interlockOk = hwInfo.interlock_ok !== undefined ? Boolean(hwInfo.interlock_ok) : true;
  const pinMap = hwInfo.gpio_pin_map || GPIO_PIN_MAP;
  const pinStates = hwInfo.pin_states || {};

  const resolvedGreen =
    LANES.find((ln) => lanesData[ln]?.active_phase_signal === 'GREEN') ||
    hwInfo.active_green_lane ||
    activeGreenLane ||
    'east';

  return (
    <section
      className="ops-card"
      style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}
      aria-label="Adaptive Priority Engine, 5-Minute ML Prediction & Raspberry Pi Hardware Telemetry"
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          borderBottom: '1px solid var(--border-hairline)',
          paddingBottom: '10px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="ops-led green" />
            <span
              className="font-mono-tabular"
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--text-primary)',
              }}
            >
              ADAPTIVE PRIORITY ENGINE · 5-MIN ML FORECAST · RASPBERRY PI GPIO CONTROLLER
            </span>
          </div>
          <div
            className="font-mono-tabular"
            style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}
          >
            QUEUE METHOD: METER-ESTIMATED · FAIRNESS STARVATION LIMIT: {MAX_WAITING_TIME}s ·
            INTERGREEN SAFETY: GREEN → YELLOW (3s) → ALL_RED (2s) → NEXT GREEN
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <button
            type="button"
            className="ops-btn"
            onClick={() => onTriggerStarvationTest && onTriggerStarvationTest('west')}
            title="Test fairness boost when a road waits longer than MAX_WAITING_TIME (90s)"
          >
            Test Starvation (&gt;90s West)
          </button>
          <button
            type="button"
            className="ops-btn"
            onClick={() => onTriggerPedestrianSurge && onTriggerPedestrianSurge('north')}
            title="Inject waiting pedestrians at North crosswalk to test pedestrian priority weight"
          >
            +12 Pedestrians (North)
          </button>
          <button
            type="button"
            className="ops-btn"
            onClick={() => onTriggerPolicePriority && onTriggerPolicePriority('south')}
            title="Inject Emergency Vehicle preemption on South approach"
          >
            Emergency Escort (South)
          </button>
          <button
            type="button"
            className="ops-btn emergency-btn"
            onClick={() => onTriggerPotentialAccident && onTriggerPotentialAccident('east')}
            title="Simulate stationary vehicle across consecutive frames (Potential Accident — Requires Verification)"
          >
            Flag Stationary Vehicle
          </button>
          <button
            type="button"
            className="ops-btn"
            style={{
              borderColor: showAuditTable ? 'var(--accent-cyan)' : undefined,
              color: showAuditTable ? 'var(--accent-cyan)' : undefined,
            }}
            onClick={() => setShowAuditTable((v) => !v)}
          >
            {showAuditTable ? 'Hide Architecture Matrix' : 'View Architecture Matrix'}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '12px',
        }}
      >
        {/* 1. 5-Minute ML Traffic Prediction Card */}
        <div
          style={{
            background: 'var(--bg-panel-subtle)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '4px',
            padding: '10px 12px',
          }}
        >
          <div
            className="font-mono-tabular"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--accent-cyan)',
              marginBottom: '6px',
            }}
          >
            <span>5-MINUTE ML TRAFFIC PREDICTION (traffic_ai/predictor.py)</span>
            <span>HORIZON: +5 MIN</span>
          </div>
          <div
            className="font-mono-tabular"
            style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '8px' }}
          >
            Model: {predData?.model || 'OLS Linear Trend Regression'} · Backtest MAE:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {Number(predData?.mae ?? 0).toFixed(2)}
            </strong>{' '}
            · RMSE:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {Number(predData?.rmse ?? 0).toFixed(2)}
            </strong>{' '}
            ({predData?.evaluated_samples ?? 0} samples)
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {LANES.map((ln) => {
              const curScore = Number(lanesData[ln]?.weighted_score || 0);
              const lp = predData?.lanes?.[ln] || {};
              const predScore = Number(lp.predicted_score ?? curScore);
              const predCode = lp.predicted_code || lanesData[ln]?.density_code || 'LOW';
              return (
                <div
                  key={ln}
                  className="font-mono-tabular"
                  style={{
                    padding: '6px 8px',
                    background: 'var(--bg-tally-item)',
                    border: '1px solid var(--border-hairline)',
                    borderRadius: '3px',
                    fontSize: '0.69rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{ln.toUpperCase()}</strong>
                    <span style={{ color: 'var(--accent-cyan)' }}>{predCode}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Now: {curScore.toFixed(1)} → +5m: <strong>{predScore.toFixed(1)}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Multi-Factor Priority Engine & Starvation Fairness Card */}
        <div
          style={{
            background: 'var(--bg-panel-subtle)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '4px',
            padding: '10px 12px',
          }}
        >
          <div
            className="font-mono-tabular"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--signal-green)',
              marginBottom: '6px',
            }}
          >
            <span>MULTI-FACTOR PRIORITY ENGINE (calculate_priority)</span>
            <span>MAX WAIT: {MAX_WAITING_TIME}s</span>
          </div>
          <div
            className="font-mono-tabular"
            style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '8px' }}
          >
            Weights: {PRIORITY_WEIGHTS.density_weight} Density + {PRIORITY_WEIGHTS.queue_weight}{' '}
            Queue + {PRIORITY_WEIGHTS.waiting_weight} Wait + {PRIORITY_WEIGHTS.prediction_weight}{' '}
            Pred + {PRIORITY_WEIGHTS.pedestrian_weight} Ped
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {LANES.map((ln) => {
              const d = lanesData[ln] || {};
              const prio = Number(d.priority_score || 0);
              const qm = Number(d.queue_length_meters ?? d.queue_meters ?? 0);
              const occ = Number(d.road_occupancy_pct || 0);
              const maxW = Number(d.maximum_waiting_time || 0);
              const starved = Boolean(d.starvation_flagged);
              return (
                <div
                  key={ln}
                  className="font-mono-tabular"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 8px',
                    background: starved ? 'var(--signal-amber-dim)' : 'var(--bg-tally-item)',
                    border: `1px solid ${starved ? 'var(--signal-amber)' : 'var(--border-hairline)'}`,
                    borderRadius: '3px',
                    fontSize: '0.68rem',
                  }}
                >
                  <span>
                    <strong style={{ color: 'var(--text-primary)' }}>{ln.toUpperCase()}</strong> ·
                    Q: ~{qm.toFixed(1)}m ({occ.toFixed(0)}%) · MaxWait: {maxW.toFixed(0)}s
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: starved ? 'var(--signal-amber)' : 'var(--signal-green)',
                    }}
                  >
                    PRIO {prio.toFixed(1)} {starved ? '[+35 BOOST]' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Raspberry Pi / GPIO Hardware Signal Controller Status */}
        <div
          style={{
            background: 'var(--bg-panel-subtle)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '4px',
            padding: '10px 12px',
          }}
        >
          <div
            className="font-mono-tabular"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--signal-amber)',
              marginBottom: '6px',
            }}
          >
            <span>
              RASPBERRY PI SIGNAL CONTROLLER ({isSimMode ? 'SIMULATION_MODE=True' : 'HARDWARE_MODE=True'})
            </span>
            <span style={{ color: interlockOk ? 'var(--signal-green)' : 'var(--signal-red)' }}>
              INTERLOCK: {interlockOk ? 'OK' : 'FAULT'}
            </span>
          </div>
          <div
            className="font-mono-tabular"
            style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '8px' }}
          >
            Single-Green Safety Lock: {phaseStage === 'ALL_RED' ? 'ALL_RED Clearance' : `${resolvedGreen.toUpperCase()} ${phaseStage}`} · MQTT: <code>traffic/+/signal</code>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {LANES.map((ln) => {
              const pins = pinMap[ln] || GPIO_PIN_MAP[ln];
              const backendPinState = pinStates[ln];
              const sigState =
                phaseStage === 'ALL_RED'
                  ? 'RED'
                  : ln === resolvedGreen
                    ? phaseStage
                    : backendPinState?.signal || 'RED';
              const activePin =
                sigState === 'GREEN'
                  ? pins.GREEN
                  : sigState === 'YELLOW'
                    ? pins.YELLOW
                    : pins.RED;
              const isGreen = sigState === 'GREEN';
              const isYellow = sigState === 'YELLOW';

              return (
                <div
                  key={ln}
                  className="font-mono-tabular"
                  style={{
                    padding: '6px 8px',
                    background: 'var(--bg-tally-item)',
                    border: `1px solid ${
                      isGreen
                        ? 'var(--signal-green)'
                        : isYellow
                          ? 'var(--signal-amber)'
                          : 'var(--border-hairline)'
                    }`,
                    borderRadius: '3px',
                    fontSize: '0.68rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{ln.toUpperCase()}</strong>
                    <span
                      style={{
                        color: isGreen
                          ? 'var(--signal-green)'
                          : isYellow
                            ? 'var(--signal-amber)'
                            : 'var(--signal-red)',
                        fontWeight: 700,
                      }}
                    >
                      {sigState} (BCM {activePin})
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '2px', fontSize: '0.64rem' }}>
                    R:{pins.RED} Y:{pins.YELLOW} G:{pins.GREEN}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showAuditTable && (
        <div
          style={{
            marginTop: '4px',
            borderTop: '1px solid var(--border-hairline)',
            paddingTop: '10px',
            overflowX: 'auto',
          }}
        >
          <div
            className="font-mono-tabular"
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: 'var(--accent-cyan)',
              marginBottom: '8px',
            }}
          >
            CANONICAL SYSTEM ARCHITECTURE MATRIX (INTEGRATED)
          </div>
          <table
            className="font-mono-tabular"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.7rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px' }}>Component</th>
                <th style={{ padding: '6px 8px' }}>Canonical Implementation</th>
                <th style={{ padding: '6px 8px' }}>Verification &amp; Consolidation Status</th>
                <th style={{ padding: '6px 8px' }}>Phase 1 Result</th>
              </tr>
            </thead>
            <tbody>
              {PROJECT_AUDIT_MATRIX.map((row) => (
                <tr
                  key={row.component}
                  style={{ borderBottom: '1px solid var(--grid-line-subtle)' }}
                >
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {row.component}
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>
                    {row.existing}
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-primary)' }}>{row.status}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--signal-green)' }}>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
