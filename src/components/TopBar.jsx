import React, { useState, useEffect } from 'react';
import { REAL_WORLD_JUNCTIONS } from '../services/trafficApi';

export default function TopBar({
  selectedJunction,
  onSelectJunction,
  junctions = REAL_WORLD_JUNCTIONS,
  mode,
  inputSourceInfo,
  mqttStatus,
  emergencyLane,
  cycle,
  currentTheme = 'modern-dark',
  onToggleTheme,
}) {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('en-GB', { hour12: false })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isEmergency = Boolean(emergencyLane);
  let ledColor = 'green';
  let statusText = 'SYSTEM OPERATIONAL';

  if (isEmergency) {
    ledColor = 'red';
    statusText = `PRIORITY PREEMPTION · ${emergencyLane.toUpperCase()} APPROACH`;
  } else if (!inputSourceInfo?.active && mode !== 'mqtt') {
    ledColor = 'amber';
    statusText = 'STANDBY · AWAITING VIDEO INPUT';
  } else if (inputSourceInfo?.active) {
    ledColor = 'green';
    statusText = `PERCEPTION ACTIVE · ${inputSourceInfo.label || 'VIDEO FEED'}`;
  } else if (mode === 'mqtt') {
    if (mqttStatus?.status === 'connected') {
      ledColor = 'green';
      statusText = 'RASPBERRY PI MQTT ACTIVE';
    } else {
      ledColor = 'amber';
      statusText = 'MQTT STANDBY (AWAITING BROKER)';
    }
  }

  const handlePrintAudit = () => {
    window.print();
  };

  const junctionEntries = Object.entries(junctions || REAL_WORLD_JUNCTIONS);
  const isDark = currentTheme === 'modern-dark' || currentTheme === 'gov-navy';

  return (
    <header className="modern-top-header" role="banner">
      <div className="modern-header-stripe" aria-hidden="true" />

      <div className="ops-topbar">
        <div className="modern-brand-cluster">
          {/* High-Tech Glowing NeuroFlow Neural Hexagon Logo */}
          <div className="smartflow-logo-badge neuroflow-logo-badge" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Outer Hexagon */}
              <polygon
                points="16,2 29,9.5 29,22.5 16,30 3,22.5 3,9.5"
                stroke="var(--accent-primary)"
                strokeWidth="2"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Inner Traffic Neural Node Cross */}
              <circle cx="16" cy="16" r="3.5" fill="var(--signal-green)" />
              <line x1="16" y1="6" x2="16" y2="12.5" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="16" y1="19.5" x2="16" y2="26" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="6" y1="16" x2="12.5" y2="16" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="19.5" y1="16" x2="26" y2="16" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" />
              {/* Signal Aspect Accents */}
              <circle cx="16" cy="7" r="1.5" fill="var(--signal-red)" />
              <circle cx="25" cy="16" r="1.5" fill="var(--signal-amber)" />
              <circle cx="7" cy="16" r="1.5" fill="var(--signal-green)" />
            </svg>
          </div>

          <div>
            <div className="modern-tagline">
              EDGE AI TRAFFIC ORCHESTRATION
            </div>
            <h1 className="ops-title">
              NEUROFLOW
            </h1>
            <div className="modern-sub-title">
              A Vision &ndash; Based Intelligence Traffic Orchestration Platform With Edge AI and Emergence Prioritization
            </div>
          </div>
        </div>

        <div className="ops-telemetry-cluster" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="junction-select" className="ops-control-label" style={{ margin: 0, fontWeight: 700 }}>
              INTERSECTION:
            </label>
            <select
              id="junction-select"
              className="ops-junction-select"
              value={selectedJunction}
              onChange={(e) => onSelectJunction(e.target.value)}
              title="Select active traffic junction (JCT-01..JCT-04)"
            >
              {junctionEntries.map(([key, jct]) => (
                <option key={key} value={key}>
                  {jct?.label || jct?.name || key}
                </option>
              ))}
            </select>
          </div>

          <span aria-hidden="true" style={{ color: 'var(--grid-line)' }}>|</span>

          <div className="ops-status-indicator">
            <span className={`ops-led ${ledColor}`} aria-hidden="true" />
            <span style={{ fontWeight: 600, color: 'var(--text-header)' }}>{statusText}</span>
          </div>

          <span aria-hidden="true" style={{ color: 'var(--grid-line)' }}>|</span>

          <div className="ops-status-indicator">
            <span style={{ color: 'var(--text-muted)' }}>CYCLE:</span>
            <span className="font-mono-tabular" style={{ color: 'var(--text-header)', fontWeight: 700 }}>
              #{String(cycle).padStart(3, '0')}
            </span>
          </div>

          <span aria-hidden="true" style={{ color: 'var(--grid-line)' }}>|</span>

          <div className="ops-status-indicator font-mono-tabular" style={{ color: 'var(--text-header)', fontWeight: 600 }}>
            <span>{clockText} IST</span>
          </div>

          <span aria-hidden="true" style={{ color: 'var(--grid-line)' }}>|</span>

          {/* Modern Theme Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className={`ops-btn ${!isDark ? 'active' : ''}`}
              style={{ fontSize: '0.74rem', padding: '5px 10px' }}
              onClick={() => onToggleTheme && onToggleTheme('modern-light')}
              title="Switch to Modern Clean Light Theme"
            >
              ☀️ Clean Light
            </button>
            <button
              type="button"
              className={`ops-btn ${isDark ? 'active' : ''}`}
              style={{ fontSize: '0.74rem', padding: '5px 10px' }}
              onClick={() => onToggleTheme && onToggleTheme('modern-dark')}
              title="Switch to Cyber Dark Glass Theme"
            >
              🌙 Cyber Dark
            </button>
          </div>

          <button
            type="button"
            className="ops-btn"
            style={{
              fontSize: '0.74rem',
              padding: '5px 12px',
              borderColor: 'var(--accent-primary)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={handlePrintAudit}
            title="Export comprehensive intersection performance report and telemetry docket"
          >
            <span>📊</span>
            <span>Export Report</span>
          </button>
        </div>
      </div>

      <div className="modern-telemetry-strip">
        <span>PLATFORM: NEUROFLOW ORCHESTRATION ENGINE</span>
        <span aria-hidden="true">&bull;</span>
        <span>VISION: YOLOV8 + BYTETRACK MOT</span>
        <span aria-hidden="true">&bull;</span>
        <span>SIGNAL LOGIC: ADAPTIVE DYNAMIC CLAMPED (15s–45s)</span>
        <span aria-hidden="true">&bull;</span>
        <span>SUSTAINABILITY: SDG-11 ECO-OPTIMIZED</span>
        <span aria-hidden="true">&bull;</span>
        <span style={{ color: 'var(--signal-green)', fontWeight: 700 }}>STATUS: 4-WAY ACTIVE SYNCHRONIZATION</span>
      </div>
    </header>
  );
}
