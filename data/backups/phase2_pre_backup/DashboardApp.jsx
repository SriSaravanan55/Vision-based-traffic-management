import React, { useState, useEffect, useRef, useCallback } from 'react';
import TopBar from './TopBar';
import ControlBar from './ControlBar';
import IntersectionSchematic from './IntersectionSchematic';
import CameraFeedMatrix from './CameraFeedMatrix';
import AdaptiveIntelligencePanel from './AdaptiveIntelligencePanel';
import EventLog from './EventLog';
import {
  LANES,
  REAL_WORLD_JUNCTIONS,
  SCENARIO_PRESETS,
  TRAFFIC_LIVE_VIDEO_FEEDS,
  DEFAULT_BASELINE_COUNTS,
  createInitialStandbyCycle,
  fetchSystemConfig,
  fetchSqliteSummary,
  executePythonCycle,
  runPythonDemoBatch,
  resetExperimentSession,
} from '../services/trafficApi';
import { connectTrafficMqtt } from '../services/mqttClient';

function formatLogTime(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    return d.toLocaleTimeString('en-GB', { hour12: false });
  } catch {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
  }
}

function cloneCountsMap(countsMap) {
  const out = {};
  for (const ln of LANES) {
    out[ln] = { ...(countsMap?.[ln] || DEFAULT_BASELINE_COUNTS[ln]) };
  }
  return out;
}

function evolveCountsForNextCycle(currentMap, activeGreen, inputCounts, selectedCamLane) {
  const next = cloneCountsMap(currentMap);
  for (const ln of LANES) {
    const cur = next[ln];
    const base = ln === selectedCamLane && inputCounts ? inputCounts : cur;
    const isGreen = ln === activeGreen;
    const carDelta = isGreen ? -Math.floor(Math.random() * 2 + 1) : Math.floor(Math.random() * 3);
    const motoDelta = isGreen ? -Math.floor(Math.random() * 2) : Math.floor(Math.random() * 2);

    cur.car = Math.max(1, Math.min(28, Number(base.car ?? cur.car ?? 6) + carDelta));
    cur.motorcycle = Math.max(0, Math.min(26, Number(base.motorcycle ?? cur.motorcycle ?? 4) + motoDelta));
    cur.bus = Math.max(0, Math.min(6, Number(base.bus ?? cur.bus ?? 1)));
    cur.truck = Math.max(0, Math.min(10, Number(base.truck ?? cur.truck ?? 1)));
    cur.bicycle = Math.max(0, Math.min(6, Number(base.bicycle ?? cur.bicycle ?? 0)));
  }
  return next;
}

export default function DashboardApp({ onOpenDocsModal }) {
  // Authoritative metadata synced from /api/config
  const [junctions, setJunctions] = useState(REAL_WORLD_JUNCTIONS);
  const [presets, setPresets] = useState(SCENARIO_PRESETS);
  const [videoFeeds, setVideoFeeds] = useState(TRAFFIC_LIVE_VIDEO_FEEDS);

  const [selectedJunction, setSelectedJunction] = useState('JCT-01');
  const [mode, setMode] = useState('video_ingest'); // 'video_ingest' | 'mqtt'
  const [isRunning, setIsRunning] = useState(true);
  const [presetId, setPresetId] = useState('auto');
  const [forcedEmergencyLane, setForcedEmergencyLane] = useState(null);
  const [brokerUrl, setBrokerUrl] = useState('ws://localhost:9001');
  const [mqttStatus, setMqttStatus] = useState({
    status: 'offline',
    detail: 'Standalone ATCS standby',
  });

  // Lifted camera approach focus so CameraFeedMatrix and DashboardApp stay synchronized
  const [selectedCamLane, setSelectedCamLane] = useState('east');

  // Input source state: inactive until video, stream, camera, or MQTT connects
  const [inputSourceInfo, setInputSourceInfo] = useState({
    active: false,
    type: null,
    label: 'Standby (No Input)',
    name: '',
    counts: null,
  });

  const [currentTheme, setCurrentTheme] = useState(() => {
    try {
      return localStorage.getItem('traffic_gov_theme') || 'gov-navy';
    } catch {
      return 'gov-navy';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    try {
      localStorage.setItem('traffic_gov_theme', currentTheme);
    } catch {
      // ignore storage failures
    }
  }, [currentTheme]);

  // Backend telemetry & error states
  const [sqliteSummary, setSqliteSummary] = useState(null);
  const [isRunningPython, setIsRunningPython] = useState(false);
  const [apiError, setApiError] = useState('');

  // Signal cycle state & single authoritative signal phase machine
  const [cycleState, setCycleState] = useState(() => createInitialStandbyCycle());
  const [activeGreenLane, setActiveGreenLane] = useState('east');
  const [phaseStage, setPhaseStage] = useState('GREEN'); // 'GREEN' | 'YELLOW' | 'ALL_RED'
  const [stageTimer, setStageTimer] = useState(8);
  const [autoPhaseRotate, setAutoPhaseRotate] = useState(true);
  const [countdowns, setCountdowns] = useState({
    north: 15,
    south: 15,
    east: 15,
    west: 15,
  });

  const [events, setEvents] = useState(() => [
    {
      id: 'init-1',
      time: formatLogTime(new Date().toISOString()),
      type: 'CYCLE',
      message:
        'System Initialized in Standby — Unified Python Engine (traffic_ai/) Ready. Awaiting Video or Live Camera Input Source.',
    },
  ]);

  const laneCountsRef = useRef(cloneCountsMap(DEFAULT_BASELINE_COUNTS));
  const pendingTransitionRef = useRef(null);
  const cycleInFlightRef = useRef(false);
  const activeGreenRef = useRef(activeGreenLane);
  const phaseStageRef = useRef(phaseStage);

  useEffect(() => {
    activeGreenRef.current = activeGreenLane;
  }, [activeGreenLane]);

  useEffect(() => {
    phaseStageRef.current = phaseStage;
  }, [phaseStage]);

  const appendEvent = useCallback((type, message, ts) => {
    setEvents((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        time: formatLogTime(ts),
        type,
        message,
      },
      ...prev.slice(0, 79),
    ]);
  }, []);

  // Load canonical configuration & initial SQLite telemetry on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await fetchSystemConfig();
        if (!mounted) return;
        if (cfg.junctions) setJunctions(cfg.junctions);
        if (cfg.presets) setPresets(cfg.presets);
        if (cfg.video_feeds) setVideoFeeds(cfg.video_feeds);
      } catch (err) {
        if (mounted) {
          setApiError(err?.message || 'Unable to load canonical Python config.');
        }
      }

      try {
        const sum = await fetchSqliteSummary();
        if (!mounted) return;
        setSqliteSummary(sum);
        if (sum?.hardware?.active_green_lane && LANES.includes(sum.hardware.active_green_lane)) {
          setActiveGreenLane(sum.hardware.active_green_lane);
        }
      } catch (err) {
        if (mounted) {
          const msg = err?.message || 'Unable to query Python SQLite backend.';
          setApiError(msg);
          appendEvent('CYCLE', `[BACKEND ERROR] ${msg}`);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [appendEvent]);

  // Apply authoritative Python result & schedule IRC intergreen YELLOW -> ALL_RED -> GREEN clearance if switching lanes
  const applyPythonResult = useCallback(
    (result, sourceLabel = 'PYTHON-ATCS') => {
      if (!result || !result.lanes) return;

      setApiError('');
      setCycleState(result);
      if (result.sqlite_summary) {
        setSqliteSummary(result.sqlite_summary);
      }

      // Sync reference counts from authoritative backend
      const synced = {};
      for (const ln of LANES) {
        synced[ln] = { ...(result.lanes[ln]?.raw_counts || laneCountsRef.current[ln]) };
      }
      laneCountsRef.current = synced;

      setCountdowns({
        north: Number(result.lanes.north?.green_seconds ?? 15),
        south: Number(result.lanes.south?.green_seconds ?? 15),
        east: Number(result.lanes.east?.green_seconds ?? 15),
        west: Number(result.lanes.west?.green_seconds ?? 15),
      });

      const targetGreen =
        result.active_green_lane ||
        LANES.find((ln) => result.lanes[ln]?.active_phase_signal === 'GREEN') ||
        'east';
      const allocatedGreen = Number(result.lanes[targetGreen]?.green_seconds || 15);
      const greenWindow = Math.max(5, Math.min(12, Math.round(allocatedGreen / 3)));

      const currentVisualGreen = activeGreenRef.current;
      const yellowStep = result.transition_steps?.find((s) => s.state === 'YELLOW');
      const allRedStep = result.transition_steps?.find((s) => s.state === 'RED');

      if (targetGreen !== currentVisualGreen) {
        pendingTransitionRef.current = {
          targetLane: targetGreen,
          yellowSeconds: Number(yellowStep?.duration_s || 3),
          allRedSeconds: Number(allRedStep?.duration_s || 2),
          greenWindow,
        };
        setPhaseStage('YELLOW');
        setStageTimer(Number(yellowStep?.duration_s || 3));
      } else {
        pendingTransitionRef.current = null;
        setActiveGreenLane(targetGreen);
        setPhaseStage('GREEN');
        setStageTimer(greenWindow);
      }

      if (result.emergency_lane) {
        const emLane = result.emergency_lane.toUpperCase();
        appendEvent(
          'EMERGENCY',
          `[${sourceLabel}] Cycle #${String(result.cycle).padStart(3, '0')}: Emergency vehicle on ${emLane} — ${emLane} GREEN 25s (YELLOW→ALL_RED clearance), conflicting lanes HOLD (0s)`,
          result.ts
        );
      } else {
        const summaryParts = LANES.map(
          (ln) =>
            `${ln.toUpperCase()} ${result.lanes[ln].green_seconds}s (${result.lanes[ln].density_level}, ${result.lanes[ln].vehicle_total} veh)`
        ).join(' · ');
        appendEvent(
          'CYCLE',
          `[${sourceLabel}] Cycle #${String(result.cycle).padStart(3, '0')} [GREEN→${targetGreen.toUpperCase()}]: ${summaryParts}`,
          result.ts
        );
      }
    },
    [appendEvent]
  );

  // Centralized async bridge to POST /api/pipeline/execute-cycle
  const runCycleOnPython = useCallback(
    async ({
      laneCounts = laneCountsRef.current,
      pedestrianCounts = {},
      priorWaiting = {},
      emergencyLane = forcedEmergencyLane,
      forcedActiveLane = null,
      persist = true,
      sourceLabel = 'PYTHON-ATCS',
    }) => {
      if (cycleInFlightRef.current) return null;
      cycleInFlightRef.current = true;
      try {
        const result = await executePythonCycle({
          lane_counts: laneCounts,
          pedestrian_counts: pedestrianCounts,
          prior_waiting: priorWaiting,
          emergency_lane: emergencyLane,
          forced_active_lane: forcedActiveLane,
          junction_id: selectedJunction,
          persist,
        });
        applyPythonResult(result, sourceLabel);
        return result;
      } catch (err) {
        const msg = err?.message || 'Python signal cycle execution failed.';
        setApiError(msg);
        appendEvent('CYCLE', `[BACKEND ERROR] ${msg}`);
        return null;
      } finally {
        cycleInFlightRef.current = false;
      }
    },
    [forcedEmergencyLane, selectedJunction, applyPythonResult, appendEvent]
  );

  // Switch canonical junction ID (JCT-01..JCT-04)
  const handleSelectJunction = (newJct) => {
    setSelectedJunction(newJct);
    const jctLabel = junctions[newJct]?.label || newJct;
    appendEvent('CYCLE', `Switched active intersection to ${jctLabel}`);
  };

  // Input source connection / disconnection (from Video upload, Live stream, or Webcam)
  const handleInputSourceChange = useCallback(
    (newSourceInfo) => {
      setInputSourceInfo(newSourceInfo);
      if (newSourceInfo?.active) {
        const targetLane = newSourceInfo.targetLane || selectedCamLane;
        if (newSourceInfo.counts) {
          laneCountsRef.current = {
            ...laneCountsRef.current,
            [targetLane]: { ...newSourceInfo.counts },
          };
        }
        runCycleOnPython({
          laneCounts: laneCountsRef.current,
          sourceLabel: `INPUT: ${newSourceInfo.label}`,
        });
        appendEvent(
          'INPUT',
          `[INPUT CONNECTED] Perception Source: ${newSourceInfo.label} -> Approach ${targetLane.toUpperCase()}.`
        );
      } else {
        appendEvent('INPUT', '[INPUT DISCONNECTED] System returned to Standby mode.');
      }
    },
    [selectedCamLane, runCycleOnPython, appendEvent]
  );

  const handleDisconnectInputSource = useCallback(() => {
    pendingTransitionRef.current = null;
    setInputSourceInfo({
      active: false,
      type: null,
      label: 'Standby (No Input)',
      name: '',
      counts: null,
    });
    appendEvent(
      'INPUT',
      '[INPUT EJECTED] Input source removed. Signal controller returned to Standby.'
    );
  }, [appendEvent]);

  const handleLoadSampleVideo = (feedId = 'feed-01') => {
    const feed = videoFeeds.find((f) => f.id === feedId) || videoFeeds[0];
    if (!feed) return;
    const targetLane = feed.defaultApproach || selectedCamLane;
    setSelectedCamLane(targetLane);
    handleInputSourceChange({
      active: true,
      type: 'live_stream',
      label: `Sample Video: ${feed.title}`,
      name: feed.title,
      counts: feed.baseVehicleCounts,
      targetLane,
    });
  };

  // Active gate: 4-way signal controller renders & rotates ONLY when input source or MQTT is active
  const isInputSourceActive = Boolean(inputSourceInfo?.active || mode === 'mqtt');

  // Single authoritative signal state machine timer (1000ms heartbeat)
  useEffect(() => {
    if (!isInputSourceActive || !isRunning) return undefined;

    const timer = setInterval(() => {
      setStageTimer((prev) => {
        if (prev > 1) {
          if (phaseStageRef.current === 'GREEN') {
            setCountdowns((c) => {
              const g = activeGreenRef.current;
              return { ...c, [g]: Math.max(0, Number(c[g] || 0) - 1) };
            });
          }
          return prev - 1;
        }

        // Current phase timer reached 0: advance YELLOW -> ALL_RED -> GREEN -> Next Cycle
        if (phaseStageRef.current === 'YELLOW') {
          const pending = pendingTransitionRef.current;
          setPhaseStage('ALL_RED');
          return Number(pending?.allRedSeconds || 2);
        }

        if (phaseStageRef.current === 'ALL_RED') {
          const pending = pendingTransitionRef.current;
          const nextLane = pending?.targetLane || activeGreenRef.current;
          const nextWindow = Number(pending?.greenWindow || 8);
          pendingTransitionRef.current = null;
          setActiveGreenLane(nextLane);
          setPhaseStage('GREEN');
          return nextWindow;
        }

        // Currently in GREEN phase and timer expired
        if (!autoPhaseRotate) {
          return 8;
        }

        const activePreset = presets[presetId];
        const nextCounts =
          presetId !== 'auto' && activePreset?.counts
            ? cloneCountsMap(activePreset.counts)
            : evolveCountsForNextCycle(
                laneCountsRef.current,
                activeGreenRef.current,
                inputSourceInfo?.counts,
                selectedCamLane
              );

        laneCountsRef.current = nextCounts;
        runCycleOnPython({
          laneCounts: nextCounts,
          sourceLabel:
            presetId !== 'auto'
              ? `PRESET:${presetId.toUpperCase()}`
              : inputSourceInfo?.label || 'LIVE-PERCEPTION',
        });

        // Hold green countdown smoothly while Python call resolves
        return 6;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [
    isInputSourceActive,
    isRunning,
    autoPhaseRotate,
    presetId,
    presets,
    inputSourceInfo,
    selectedCamLane,
    runCycleOnPython,
  ]);

  // Live MQTT WebSocket subscription when mode === 'mqtt'
  useEffect(() => {
    if (mode !== 'mqtt') return undefined;

    const conn = connectTrafficMqtt({
      brokerUrl,
      onStatusChange: (statusObj) => {
        setMqttStatus(statusObj);
        if (statusObj.status === 'connected') {
          appendEvent('MQTT', `Connected to MQTT broker at ${statusObj.brokerUrl}`);
        }
      },
      onSignalState: (payload) => {
        if (!payload || !payload.lanes) return;
        applyPythonResult(
          {
            ts: payload.ts || new Date().toISOString(),
            cycle: Number(payload.cycle || (cycleState.cycle || 0) + 1),
            emergency_lane: payload.emergency_lane || null,
            active_green_lane:
              payload.active_green_lane ||
              LANES.find((ln) => payload.lanes[ln]?.active_phase_signal === 'GREEN') ||
              'east',
            transition_steps: payload.transition_steps || [],
            lanes: payload.lanes,
          },
          'MQTT'
        );
      },
      onLaneCounts: (lane, payload) => {
        if (!LANES.includes(lane) || !payload) return;
        const merged = cloneCountsMap(laneCountsRef.current);
        merged[lane] = { ...(payload.raw_counts || {}) };
        laneCountsRef.current = merged;
        runCycleOnPython({
          laneCounts: merged,
          emergencyLane: forcedEmergencyLane || payload.emergency_lane || null,
          sourceLabel: `MQTT:${lane.toUpperCase()}`,
        });
      },
      onEmergency: (payload) => {
        const emLane = payload?.emergency_lane;
        if (LANES.includes(emLane)) {
          appendEvent(
            'EMERGENCY',
            `[MQTT ALERT] Edge emergency preemption message received for ${emLane.toUpperCase()}`
          );
          runCycleOnPython({
            laneCounts: laneCountsRef.current,
            emergencyLane: emLane,
            sourceLabel: 'MQTT-EMERGENCY',
          });
        }
      },
      onError: (err) => {
        setMqttStatus({ status: 'offline', detail: err?.message || 'MQTT error' });
      },
    });

    return () => {
      conn.disconnect();
    };
  }, [
    mode,
    brokerUrl,
    forcedEmergencyLane,
    cycleState.cycle,
    applyPythonResult,
    runCycleOnPython,
    appendEvent,
  ]);

  // Manual step cycle through Python
  const handleStepCycle = () => {
    const activePreset = presets[presetId];
    const nextCounts =
      presetId !== 'auto' && activePreset?.counts
        ? cloneCountsMap(activePreset.counts)
        : evolveCountsForNextCycle(
            laneCountsRef.current,
            activeGreenRef.current,
            inputSourceInfo?.counts,
            selectedCamLane
          );
    laneCountsRef.current = nextCounts;
    runCycleOnPython({
      laneCounts: nextCounts,
      sourceLabel: 'STEP-MANUAL',
    });
  };

  // Scenario Preset selector handler
  const handlePresetChange = (nextPresetId) => {
    setPresetId(nextPresetId);
    const chosen = presets[nextPresetId];
    if (chosen?.counts) {
      const cloned = cloneCountsMap(chosen.counts);
      laneCountsRef.current = cloned;
      runCycleOnPython({
        laneCounts: cloned,
        sourceLabel: `PRESET:${nextPresetId.toUpperCase()}`,
      });
      appendEvent(
        'CYCLE',
        `[SCENARIO PROFILE] Applied "${chosen.label}" to authoritative Python engine.`
      );
    } else {
      appendEvent('CYCLE', '[SCENARIO PROFILE] Switched to Auto Diurnal Demand cycling.');
    }
  };

  const handleForceEmergency = (lane) => {
    setForcedEmergencyLane(lane);
    const nextCounts = cloneCountsMap(laneCountsRef.current);
    if (!lane) {
      // Ensure clearing override removes temporary emergency markers
      for (const ln of LANES) {
        nextCounts[ln].ambulance = 0;
        nextCounts[ln].fire_truck = 0;
        nextCounts[ln].police_vehicle = 0;
      }
      laneCountsRef.current = nextCounts;
    }

    runCycleOnPython({
      laneCounts: nextCounts,
      emergencyLane: lane,
      sourceLabel: 'OVERRIDE',
    });

    if (lane) {
      appendEvent(
        'EMERGENCY',
        `[OPERATOR OVERRIDE] Emergency Preemption forced on ${lane.toUpperCase()} Approach — granted 25s GREEN`
      );
    } else {
      appendEvent('EMERGENCY', '[OPERATOR OVERRIDE] Emergency Preemption cleared.');
    }
  };

  const handleUpdateManualCounts = (targetLane, updatedLaneRawCounts) => {
    const nextCounts = cloneCountsMap(laneCountsRef.current);
    nextCounts[targetLane] = { ...updatedLaneRawCounts };
    laneCountsRef.current = nextCounts;
    runCycleOnPython({
      laneCounts: nextCounts,
      sourceLabel: 'VIDEO-DETECTION',
    });
  };

  const handleRequestSignalSwitch = (targetLane) => {
    if (!LANES.includes(targetLane)) return;
    runCycleOnPython({
      laneCounts: laneCountsRef.current,
      forcedActiveLane: targetLane,
      sourceLabel: `PHASE-SWITCH:${targetLane.toUpperCase()}`,
    });
    appendEvent(
      'CYCLE',
      `[MANUAL PHASE] Operator requested signal transition to ${targetLane.toUpperCase()} approach.`
    );
  };

  const handleTriggerStarvationTest = (targetLane = 'west') => {
    runCycleOnPython({
      laneCounts: laneCountsRef.current,
      priorWaiting: { [targetLane]: 104 },
      sourceLabel: 'FAIRNESS',
    });
    appendEvent(
      'CYCLE',
      `[FAIRNESS OVERRIDE] Evaluating ${targetLane.toUpperCase()} waiting time (104s > MAX_WAITING_TIME 90s) in Python engine.`
    );
  };

  const handleTriggerPedestrianSurge = (targetLane = 'north') => {
    runCycleOnPython({
      laneCounts: laneCountsRef.current,
      pedestrianCounts: { [targetLane]: 12 },
      sourceLabel: 'PEDESTRIAN',
    });
    appendEvent(
      'CYCLE',
      `[PEDESTRIAN PRIORITY] 12 waiting pedestrians submitted for ${targetLane.toUpperCase()} crosswalk.`
    );
  };

  const handleTriggerPolicePriority = (targetLane = 'south') => {
    const nextCounts = cloneCountsMap(laneCountsRef.current);
    for (const ln of LANES) {
      nextCounts[ln].ambulance = 0;
      nextCounts[ln].fire_truck = 0;
      nextCounts[ln].police_vehicle = 0;
    }
    nextCounts[targetLane].police_vehicle = 1;
    laneCountsRef.current = nextCounts;
    runCycleOnPython({
      laneCounts: nextCounts,
      emergencyLane: targetLane,
      sourceLabel: 'EMERGENCY',
    });
  };

  const handleTriggerPotentialAccident = (targetLane = 'east') => {
    const nowTime = formatLogTime(new Date().toISOString());
    appendEvent(
      'EMERGENCY',
      `[ABNORMAL EVENT] {"event_type": "Potential Accident", "road": "${targetLane.charAt(0).toUpperCase() + targetLane.slice(1)}", "time": "${nowTime}", "status": "Requires Verification"} — stationary vehicle tracked across consecutive frames`
    );
  };

  const handleRunPythonBatch = async () => {
    setIsRunningPython(true);
    setApiError('');
    try {
      const json = await runPythonDemoBatch(4, selectedJunction);
      if (json.sqlite_summary) {
        setSqliteSummary(json.sqlite_summary);
      } else {
        const refreshed = await fetchSqliteSummary();
        setSqliteSummary(refreshed);
      }
      appendEvent(
        'CYCLE',
        '[PYTHON SQLITE] Executed `python -m traffic_ai.pipeline --demo --cycles 4` and persisted to data/traffic_history.db'
      );
    } catch (err) {
      const msg = err?.message || 'Python batch execution failed.';
      setApiError(msg);
      appendEvent('CYCLE', `[BACKEND ERROR] ${msg}`);
    } finally {
      setIsRunningPython(false);
    }
  };

  const handleReset = async () => {
    pendingTransitionRef.current = null;
    setForcedEmergencyLane(null);
    setPresetId('auto');
    laneCountsRef.current = cloneCountsMap(DEFAULT_BASELINE_COUNTS);
    setCycleState(createInitialStandbyCycle());
    setActiveGreenLane('east');
    setPhaseStage('GREEN');
    setStageTimer(8);
    setCountdowns({ north: 15, south: 15, east: 15, west: 15 });

    try {
      const res = await resetExperimentSession(
        selectedJunction,
        'Operator reset active dashboard experiment session'
      );
      if (res?.sqlite_summary) {
        setSqliteSummary(res.sqlite_summary);
      }
      appendEvent(
        'CYCLE',
        `[SESSION RESET] Started new SQLite experiment session (${res?.active_session_id || 'new'}) while preserving historical audit logs.`
      );
    } catch (err) {
      const msg = err?.message || 'Failed to reset SQLite experiment session.';
      setApiError(msg);
      appendEvent('CYCLE', `[BACKEND ERROR] ${msg}`);
    }
  };

  const activeEmergencyLane = cycleState.emergency_lane;
  const junctionInfo = junctions[selectedJunction] || junctions['JCT-01'] || REAL_WORLD_JUNCTIONS['JCT-01'];

  return (
    <div className="ops-blueprint-bg">
      <div className="ops-shell">
        <TopBar
          selectedJunction={selectedJunction}
          onSelectJunction={handleSelectJunction}
          junctions={junctions}
          mode={mode}
          inputSourceInfo={inputSourceInfo}
          mqttStatus={mqttStatus}
          emergencyLane={activeEmergencyLane}
          cycle={cycleState.cycle}
          currentTheme={currentTheme}
          onToggleTheme={setCurrentTheme}
        />

        <ControlBar
          mode={mode}
          onModeChange={setMode}
          inputSourceInfo={inputSourceInfo}
          onDisconnectInputSource={handleDisconnectInputSource}
          isRunning={isRunning}
          onTogglePlay={() => setIsRunning((r) => !r)}
          onStepCycle={handleStepCycle}
          onReset={handleReset}
          forcedEmergencyLane={forcedEmergencyLane}
          onForceEmergency={handleForceEmergency}
          presetId={presetId}
          presets={presets}
          onPresetChange={handlePresetChange}
          mqttStatus={mqttStatus}
          brokerUrl={brokerUrl}
          onBrokerUrlChange={setBrokerUrl}
          onOpenDocsModal={onOpenDocsModal}
        />

        {/* Backend / API Error Alert Banner */}
        {apiError && (
          <div
            className="ops-panel"
            role="alert"
            style={{
              marginBottom: '12px',
              padding: '10px 14px',
              borderColor: 'var(--signal-red)',
              backgroundColor: 'var(--signal-red-dim)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span className="font-mono-tabular" style={{ fontSize: '0.78rem', color: 'var(--signal-red)' }}>
              <strong>BACKEND SYNC NOTICE:</strong> {apiError}
            </span>
            <button type="button" className="ops-btn" onClick={() => setApiError('')}>
              Dismiss
            </button>
          </div>
        )}

        {/* Emergency Preemption Banner */}
        {activeEmergencyLane && (
          <div
            className="ops-emergency-banner emergency-banner-pulse"
            role="alert"
            aria-live="assertive"
          >
            <div className="ops-emergency-banner-title">
              <span>EMERGENCY PREEMPTION ACTIVE</span>
              <span>—</span>
              <span>
                {activeEmergencyLane.toUpperCase()} APPROACH (
                {junctionInfo.approaches?.[activeEmergencyLane]?.road || 'PRIORITY CORRIDOR'}
                ) GRANTED IMMEDIATE RIGHT OF WAY
              </span>
            </div>
            <div className="ops-emergency-right-of-way">
              SIGNAL STATE: {activeEmergencyLane.toUpperCase()} GREEN (25s) · TRANSITION: YELLOW (3s) → ALL_RED (2s) · ALL CONFLICTING LANES HOLD (0s)
            </div>
          </div>
        )}

        {/* Standby Prompt when no input source is connected */}
        {!isInputSourceActive && (
          <div
            className="ops-panel"
            style={{
              marginBottom: '16px',
              padding: '20px 24px',
              border: '2px dashed var(--accent-gold)',
              backgroundColor: 'var(--badge-bg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.25rem' }}>🏛️</span>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-gold)', margin: 0 }}>
                GOVERNMENT &amp; ACADEMIC PERCEPTION STATION &bull; AWAITING VIDEO INPUT
              </h2>
            </div>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px 0' }}>
              In accordance with Municipal Traffic Operations and Academic Evaluation standards, the 4-Way Adaptive Signal Controller and YOLOv8 Vehicle Detector only activate once an input source (traffic video file, live CCTV stream, camera, or edge hardware) is connected. Please upload video footage of traffic or load an official test benchmark:
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button
                type="button"
                className="ops-btn active"
                style={{ backgroundColor: 'var(--accent-primary)', color: '#ffffff', fontWeight: 700 }}
                onClick={() => handleLoadSampleVideo('feed-01')}
              >
                📹 Traffic Benchmark 1: Arterial 4-Way Junction CCTV
              </button>
              <button
                type="button"
                className="ops-btn"
                style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', fontWeight: 600 }}
                onClick={() => handleLoadSampleVideo('feed-02')}
              >
                🏢 Traffic Benchmark 2: Downtown Commercial Crossway
              </button>
              <button
                type="button"
                className="ops-btn"
                style={{ borderColor: 'var(--signal-green)', color: 'var(--signal-green)', fontWeight: 600 }}
                onClick={() => handleLoadSampleVideo('feed-03')}
              >
                🚛 Traffic Benchmark 3: Expressway Inflow CCTV
              </button>
              <button
                type="button"
                className="ops-btn"
                onClick={() => setMode('mqtt')}
              >
                📡 Connect Raspberry Pi MQTT Edge Bridge
              </button>
            </div>
          </div>
        )}

        {/* Video Perception Studio & 4-Way CCTV Matrix */}
        <CameraFeedMatrix
          lanesData={cycleState.lanes}
          countdowns={countdowns}
          junctionInfo={junctionInfo}
          cycle={cycleState.cycle}
          videoFeeds={videoFeeds}
          selectedCamLane={selectedCamLane}
          onSelectedCamLaneChange={setSelectedCamLane}
          inputSourceInfo={inputSourceInfo}
          onInputSourceChange={handleInputSourceChange}
          onDisconnectInputSource={handleDisconnectInputSource}
          onUpdateManualCounts={handleUpdateManualCounts}
        />

        {/* 4-Way Traffic Signal Controller: rendered ONLY when input source or MQTT is connected */}
        {isInputSourceActive && (
          <main style={{ marginTop: '16px', marginBottom: '16px' }}>
            <IntersectionSchematic
              lanesData={cycleState.lanes}
              countdowns={countdowns}
              activeGreenLane={activeGreenLane}
              phaseStage={phaseStage}
              stageTimer={stageTimer}
              autoPhaseRotate={autoPhaseRotate}
              onToggleAutoRotate={() => setAutoPhaseRotate((v) => !v)}
              onRequestSignalSwitch={handleRequestSignalSwitch}
              emergencyLane={activeEmergencyLane}
              cycle={cycleState.cycle}
              junctionInfo={junctionInfo}
              inputSourceInfo={inputSourceInfo}
              onForceEmergency={handleForceEmergency}
              onUpdateManualCounts={handleUpdateManualCounts}
            />
          </main>
        )}

        {/* Adaptive Priority Engine, 5-Min ML Forecast & Raspberry Pi GPIO Telemetry */}
        <div style={{ marginTop: '16px' }}>
          <AdaptiveIntelligencePanel
            lanesData={cycleState.lanes}
            activeGreenLane={activeGreenLane}
            phaseStage={phaseStage}
            predictions={sqliteSummary?.predictions}
            sqliteSummary={sqliteSummary}
            onTriggerStarvationTest={handleTriggerStarvationTest}
            onTriggerPedestrianSurge={handleTriggerPedestrianSurge}
            onTriggerPotentialAccident={handleTriggerPotentialAccident}
            onTriggerPolicePriority={handleTriggerPolicePriority}
          />
        </div>

        {/* Timestamped Event Log & SDG 11 Waiting-Time / SQLite Telemetry Comparison */}
        <EventLog
          events={events}
          sqliteSummary={sqliteSummary}
          onRunPythonBatch={handleRunPythonBatch}
          isRunningPython={isRunningPython}
          onClearLog={() => setEvents([])}
        />
      </div>
    </div>
  );
}
