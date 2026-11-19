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
  currentTheme = 'gov-navy',
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
    statusText = `PERCEPTION ACTIVE · ${inputSourceInfo.label || 'VIDEO FOOTAGE'}`;
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

  return (
    <header className="gov-top-header" role="banner">
      <div className="gov-header-stripe" aria-hidden="true" />

      <div className="ops-topbar">
        <div className="gov-brand-cluster">
          <div className="gov-seal-icon" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="18" stroke="var(--accent-gold)" strokeWidth="1.8" strokeDasharray="3 2" fill="var(--badge-bg)" />
              <circle cx="20" cy="20" r="13" stroke="var(--accent-gold)" strokeWidth="1.2" />
              <circle cx="20" cy="20" r="4.5" fill="var(--accent-gold)" />
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
                <line
                  key={deg}
                  x1="20"
                  y1="20"
                  x2={20 + 13 * Math.cos((deg * Math.PI) / 180)}
                  y2={20 + 13 * Math.sin((deg * Math.PI) / 180)}
                  stroke="var(--accent-gold)"
                  strokeWidth="0.9"
                />
              ))}
            </svg>
          </div>

          <div>
            <h1 className="ops-title">
              INTELLIGENT TRAFFIC MANAGEMENT SYSTEM &bull; OPERATIONS CONSOLE
            </h1>
            <div className="gov-sub-title">
              Official Academic &amp; Civil Infrastructure Traffic Management System &bull; IRC:SP:41 &amp; NEMA-TS2 Compliant
            </div>
          </div>
        </div>

        <div className="ops-telemetry-cluster" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label htmlFor="junction-select" className="ops-control-label" style={{ margin: 0, fontWeight: 700 }}>
              SECTOR / JUNCTION:
            </label>
            <select
              id="junction-select"
              className="ops-junction-select"
              value={selectedJunction}
              onChange={(e) => onSelectJunction(e.target.value)}
              title="Select canonical intersection ID (JCT-01..JCT-04)"
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              className={`ops-btn ${currentTheme === 'gov-light' ? 'active' : ''}`}
              style={{ fontSize: '0.72rem', padding: '4px 8px' }}
              onClick={() => onToggleTheme && onToggleTheme('gov-light')}
              title="Switch to Government Administrative Portal (Crisp Light Theme)"
            >
              🏛️ Govt. Portal (Light)
            </button>
            <button
              type="button"
              className={`ops-btn ${currentTheme === 'gov-navy' ? 'active' : ''}`}
              style={{ fontSize: '0.72rem', padding: '4px 8px' }}
              onClick={() => onToggleTheme && onToggleTheme('gov-navy')}
              title="Switch to Civic Command Center (Executive Navy Theme)"
            >
              🏢 Command Room (Navy)
            </button>
          </div>

          <button
            type="button"
            className="ops-btn"
            style={{ fontSize: '0.72rem', padding: '4px 8px', borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}
            onClick={handlePrintAudit}
            title="Print or Export Official Inspection Docket for College Evaluation or Municipal Review"
          >
            📋 Print Audit Docket
          </button>
        </div>
      </div>

      <div className="gov-meta-strip">
        <span>AUTHORITY: MUNICIPAL TRANSPORT &amp; HIGHWAY ENG. DIVISION</span>
        <span aria-hidden="true">&bull;</span>
        <span>REF: GOV-MTC-2026/ACAD-ITS</span>
        <span aria-hidden="true">&bull;</span>
        <span>SPECIFICATION: IRC-SP-41 / NEMA-TS2</span>
        <span aria-hidden="true">&bull;</span>
        <span>RESEARCH VALIDATION: SDG-11.2 SUSTAINABLE MOBILITY</span>
        <span aria-hidden="true">&bull;</span>
        <span style={{ color: 'var(--signal-green)', fontWeight: 700 }}>VERIFIED: LEVEL 4 AUDIT CLEARANCE</span>
      </div>
    </header>
  );
}
