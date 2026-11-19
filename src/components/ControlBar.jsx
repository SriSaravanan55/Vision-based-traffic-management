import React from 'react';
import { LANES, SCENARIO_PRESETS } from '../services/trafficApi';

export default function ControlBar({
  mode = 'video_ingest',
  onModeChange,
  inputSourceInfo,
  onDisconnectInputSource,
  isRunning,
  onTogglePlay,
  onStepCycle,
  onReset,
  forcedEmergencyLane,
  onForceEmergency,
  presetId = 'auto',
  presets = SCENARIO_PRESETS,
  onPresetChange,
  mqttStatus,
  brokerUrl,
  onBrokerUrlChange,
  onOpenDocsModal,
}) {
  const presetEntries = Object.entries(presets || SCENARIO_PRESETS);

  return (
    <section className="ops-controlbar" aria-label="Intersection Control Bar">
      <div className="ops-control-group">
        <span className="ops-control-label">INPUT MODE</span>
        <button
          type="button"
          className={`ops-btn ${mode === 'video_ingest' ? 'active' : ''}`}
          onClick={() => onModeChange('video_ingest')}
          title="Video perception ingest: Upload video footage or connect live stream"
        >
          📹 Video / Camera Perception
        </button>
        <button
          type="button"
          className={`ops-btn ${mode === 'mqtt' ? 'active' : ''}`}
          onClick={() => onModeChange('mqtt')}
          title="Hardware MQTT broker for Raspberry Pi GPIO"
        >
          📡 Raspberry Pi MQTT
        </button>
      </div>

      {inputSourceInfo?.active && (
        <div
          className="ops-control-group"
          style={{
            background: 'var(--signal-green-dim)',
            border: '1px solid var(--signal-green)',
            borderRadius: '4px',
            padding: '2px 8px',
          }}
        >
          <span style={{ fontSize: '0.78rem', color: 'var(--signal-green)', fontWeight: 600 }}>
            ● CONNECTED: {inputSourceInfo.label}
          </span>
          {typeof onDisconnectInputSource === 'function' && (
            <button
              type="button"
              className="ops-btn"
              style={{ fontSize: '0.72rem', padding: '2px 6px', color: 'var(--signal-red)' }}
              onClick={onDisconnectInputSource}
              title="Disconnect input source and return to standby"
            >
              ✕ Eject
            </button>
          )}
        </div>
      )}

      <div className="ops-control-group">
        <span className="ops-control-label">SIGNAL CONTROLLER</span>
        <button type="button" className={`ops-btn ${isRunning ? 'active' : ''}`} onClick={onTogglePlay}>
          {isRunning ? '⏸ Pause' : '▶ Run'}
        </button>
        <button type="button" className="ops-btn" onClick={onStepCycle}>
          Step Cycle
        </button>
        <button type="button" className="ops-btn" onClick={onReset}>
          Reset
        </button>
      </div>

      {/* Scenario Demand Preset Selector */}
      <div className="ops-control-group">
        <label htmlFor="scenario-preset-select" className="ops-control-label">
          SCENARIO PROFILE
        </label>
        <select
          id="scenario-preset-select"
          className="ops-junction-select"
          style={{ maxWidth: '250px', fontSize: '0.74rem', padding: '4px 8px' }}
          value={presetId}
          onChange={(e) => onPresetChange && onPresetChange(e.target.value)}
          title="Apply benchmark traffic demand profile to Python signal engine"
        >
          {presetEntries.map(([key, item]) => (
            <option key={key} value={key}>
              {item?.label || key}
            </option>
          ))}
        </select>
      </div>

      <div className="ops-control-group">
        <span className="ops-control-label">FORCE EMERGENCY</span>
        {LANES.map((lane) => {
          const isForced = forcedEmergencyLane === lane;
          return (
            <button
              key={lane}
              type="button"
              className={`ops-btn emergency-btn ${isForced ? 'active' : ''}`}
              onClick={() => onForceEmergency(isForced ? null : lane)}
            >
              {lane.toUpperCase()}
            </button>
          );
        })}
        {forcedEmergencyLane && (
          <button
            type="button"
            className="ops-btn"
            onClick={() => onForceEmergency(null)}
          >
            Clear Override
          </button>
        )}
      </div>

      {mode === 'mqtt' && (
        <div className="ops-control-group">
          <label htmlFor="mqtt-url-input" className="ops-control-label">
            BROKER WS
          </label>
          <input
            id="mqtt-url-input"
            type="text"
            className="ops-junction-select"
            style={{ width: '180px' }}
            value={brokerUrl}
            onChange={(e) => onBrokerUrlChange(e.target.value)}
          />
          <span className="font-mono-tabular" style={{ fontSize: '0.74rem' }}>
            STATUS:{' '}
            <strong
              style={{
                color:
                  mqttStatus?.status === 'connected'
                    ? 'var(--signal-green)'
                    : 'var(--signal-amber)',
              }}
            >
              {mqttStatus?.status?.toUpperCase() || 'OFFLINE'}
            </strong>
          </span>
        </div>
      )}

      {typeof onOpenDocsModal === 'function' && (
        <div className="ops-control-group" style={{ marginLeft: 'auto' }}>
          <button type="button" className="ops-btn" onClick={onOpenDocsModal}>
            Hardware &amp; API Guide
          </button>
        </div>
      )}
    </section>
  );
}
