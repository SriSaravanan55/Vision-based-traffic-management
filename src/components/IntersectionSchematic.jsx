import React, { useState, useEffect, useRef } from 'react';
import { LANES } from '../services/trafficApi';

const CANVAS_W = 680;
const CANVAS_H = 560;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;
const ROAD_HALF = 76;

const STOP_LINES = {
  north: CY - ROAD_HALF - 18,
  south: CY + ROAD_HALF + 18,
  west: CX - ROAD_HALF - 18,
  east: CX + ROAD_HALF + 18,
};

const VEHICLE_SPECS = {
  car: { length: 26, width: 14, maxSpeed: 2.3, color: '#38bdf8', roof: '#0284c7', label: 'CAR' },
  motorcycle: { length: 15, width: 8, maxSpeed: 2.7, color: '#00e37a', roof: '#059669', label: 'MOTO' },
  bicycle: { length: 13, width: 6, maxSpeed: 1.5, color: '#a3e635', roof: '#65a30d', label: 'BIKE' },
  bus: { length: 44, width: 16, maxSpeed: 1.75, color: '#f59e0b', roof: '#d97706', label: 'BUS' },
  truck: { length: 40, width: 16, maxSpeed: 1.65, color: '#f97316', roof: '#ea580c', label: 'TRUCK' },
  ambulance: { length: 30, width: 15, maxSpeed: 3.1, color: '#ffffff', roof: '#ef4444', label: 'AMB', emergency: true },
  fire_truck: { length: 42, width: 16, maxSpeed: 2.9, color: '#ef4444', roof: '#b91c1c', label: 'FIRE', emergency: true },
  police_vehicle: { length: 28, width: 14, maxSpeed: 3.2, color: '#1e293b', roof: '#3b82f6', label: 'POL', emergency: true },
};

function getSignalColor(isGreen, mode) {
  if (mode === 'hold') return '#64748b';
  if (isGreen) return '#00e37a';
  return '#ff4444';
}

function getTickCount(weightedScore) {
  const score = Number(weightedScore || 0);
  return Math.min(10, Math.max(1, Math.round((score / 34) * 10)));
}

function createVehicleEntity(id, lane, subLane, type, offsetDist = 0) {
  const spec = VEHICLE_SPECS[type] || VEHICLE_SPECS.car;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;

  if (lane === 'north') {
    x = subLane === 0 ? CX - 52 : CX - 22;
    y = -30 - offsetDist;
    vy = spec.maxSpeed;
  } else if (lane === 'south') {
    x = subLane === 0 ? CX + 22 : CX + 52;
    y = CANVAS_H + 30 + offsetDist;
    vy = -spec.maxSpeed;
  } else if (lane === 'west') {
    x = -30 - offsetDist;
    y = subLane === 0 ? CY + 22 : CY + 52;
    vx = spec.maxSpeed;
  } else {
    x = CANVAS_W + 30 + offsetDist;
    y = subLane === 0 ? CY - 52 : CY - 22;
    vx = -spec.maxSpeed;
  }

  return {
    id,
    lane,
    subLane,
    type,
    x,
    y,
    vx,
    vy,
    speed: spec.maxSpeed * 0.8,
    maxSpeed: spec.maxSpeed,
    length: spec.length,
    width: spec.width,
    color: spec.color,
    roof: spec.roof,
    label: spec.label,
    emergency: Boolean(spec.emergency),
    braking: false,
  };
}

export default function IntersectionSchematic({
  lanesData = {},
  countdowns = {},
  activeGreenLane = 'east',
  phaseStage = 'GREEN',
  stageTimer = 8,
  autoPhaseRotate = true,
  onToggleAutoRotate,
  onRequestSignalSwitch,
  emergencyLane = null,
  cycle = 1,
  junctionInfo,
  inputSourceInfo,
  onForceEmergency,
  onUpdateManualCounts,
}) {
  const [viewMode, setViewMode] = useState('simulation');
  const [spawnApproach, setSpawnApproach] = useState('east');

  const canvasRef = useRef(null);
  const vehiclesRef = useRef([]);
  const nextVehIdRef = useRef(1);

  // Refs read by the continuous 60 FPS canvas loop without restarting requestAnimationFrame on state changes
  const activeGreenLaneRef = useRef(activeGreenLane);
  const stageTimerRef = useRef(stageTimer);
  const lanesDataRef = useRef(lanesData);
  const countdownsRef = useRef(countdowns);
  const signalStateRef = useRef({
    north: 'RED',
    south: 'RED',
    east: 'GREEN',
    west: 'RED',
  });

  useEffect(() => {
    activeGreenLaneRef.current = activeGreenLane;
    stageTimerRef.current = stageTimer;
    lanesDataRef.current = lanesData;
    countdownsRef.current = countdowns;

    const map = { north: 'RED', south: 'RED', east: 'RED', west: 'RED' };
    if (phaseStage === 'GREEN') {
      map[activeGreenLane] = 'GREEN';
    } else if (phaseStage === 'YELLOW') {
      map[activeGreenLane] = 'YELLOW';
    }
    signalStateRef.current = map;
  }, [activeGreenLane, phaseStage, stageTimer, lanesData, countdowns]);

  // Sync vehicle population on canvas with authoritative lanesData raw_counts (including despawn on shrink/reset)
  useEffect(() => {
    const current = vehiclesRef.current;

    if (cycle === 0) {
      vehiclesRef.current = [];
      return;
    }

    for (const lane of LANES) {
      const raw = lanesData[lane]?.raw_counts || {};
      const vehTotal = Number(lanesData[lane]?.vehicle_total || 0);
      const desiredTotal =
        vehTotal <= 0 ? 0 : Math.min(14, Math.max(1, Math.round(vehTotal * 0.55)));

      let existingInLane = current.filter((v) => v.lane === lane);

      const hasEm =
        lane === emergencyLane ||
        Number(raw.ambulance || 0) > 0 ||
        Number(raw.fire_truck || 0) > 0 ||
        Number(raw.police_vehicle || 0) > 0;

      if (!hasEm) {
        for (let idx = current.length - 1; idx >= 0; idx -= 1) {
          if (current[idx].lane === lane && current[idx].emergency) {
            current.splice(idx, 1);
          }
        }
        existingInLane = current.filter((v) => v.lane === lane);
      } else if (!existingInLane.some((v) => v.emergency)) {
        const emType =
          Number(raw.fire_truck || 0) > 0
            ? 'fire_truck'
            : Number(raw.police_vehicle || 0) > 0
              ? 'police_vehicle'
              : 'ambulance';
        current.push(
          createVehicleEntity(nextVehIdRef.current++, lane, 0, emType, 15)
        );
        existingInLane = current.filter((v) => v.lane === lane);
      }

      // Despawn excess non-emergency vehicles when counts drop
      if (existingInLane.length > desiredTotal) {
        let toRemove = existingInLane.length - desiredTotal;
        for (let idx = current.length - 1; idx >= 0 && toRemove > 0; idx -= 1) {
          if (current[idx].lane === lane && !current[idx].emergency) {
            current.splice(idx, 1);
            toRemove -= 1;
          }
        }
        existingInLane = current.filter((v) => v.lane === lane);
      }

      if (existingInLane.length < desiredTotal) {
        const toAdd = desiredTotal - existingInLane.length;
        const pool = [];
        for (let i = 0; i < Number(raw.car || 0); i += 1) pool.push('car');
        for (let i = 0; i < Number(raw.motorcycle || 0); i += 1) pool.push('motorcycle');
        for (let i = 0; i < Number(raw.bus || 0); i += 1) pool.push('bus');
        for (let i = 0; i < Number(raw.truck || 0); i += 1) pool.push('truck');
        for (let i = 0; i < Number(raw.bicycle || 0); i += 1) pool.push('bicycle');
        if (pool.length === 0) pool.push('car', 'motorcycle');

        for (let k = 0; k < toAdd; k += 1) {
          const subLane = k % 2;
          const vType = pool[k % pool.length];
          const sameSub = current.filter(
            (v) => v.lane === lane && v.subLane === subLane
          );
          const spacing = (sameSub.length + 1) * 48 + Math.random() * 18;
          current.push(
            createVehicleEntity(nextVehIdRef.current++, lane, subLane, vType, spacing)
          );
        }
      }
    }
  }, [lanesData, emergencyLane, cycle]);

  const handleSpawnVehicle = (vType) => {
    const lane = spawnApproach;
    const subLane = Math.random() > 0.5 ? 1 : 0;
    vehiclesRef.current.push(
      createVehicleEntity(nextVehIdRef.current++, lane, subLane, vType, 10)
    );

    if (vType === 'ambulance' || vType === 'fire_truck' || vType === 'police_vehicle') {
      if (typeof onForceEmergency === 'function') {
        onForceEmergency(lane);
      }
    } else if (typeof onUpdateManualCounts === 'function') {
      const curRaw = { ...(lanesData[lane]?.raw_counts || {}) };
      curRaw[vType] = Number(curRaw[vType] || 0) + 1;
      onUpdateManualCounts(lane, curRaw);
    }
  };

  // Continuous 60 FPS Canvas Animation Loop (stable, never restarts every 1s)
  useEffect(() => {
    if (viewMode !== 'simulation') return undefined;
    let animId;
    let tick = 0;

    const renderFrame = () => {
      tick += 1;
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(renderFrame);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const sigMap = signalStateRef.current;
      const curGreenLane = activeGreenLaneRef.current;
      const curStageTimer = stageTimerRef.current;
      const curLanesData = lanesDataRef.current;
      const curCountdowns = countdownsRef.current;

      ctx.fillStyle = '#070d17';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = '#0f1e33';
      ctx.lineWidth = 1;
      for (let gx = 40; gx < CANVAS_W; gx += 40) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, CANVAS_H);
        ctx.stroke();
      }
      for (let gy = 40; gy < CANVAS_H; gy += 40) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(CANVAS_W, gy);
        ctx.stroke();
      }

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(CX - ROAD_HALF - 8, 0, (ROAD_HALF + 8) * 2, CANVAS_H);
      ctx.fillRect(0, CY - ROAD_HALF - 8, CANVAS_W, (ROAD_HALF + 8) * 2);

      ctx.fillStyle = '#111827';
      ctx.fillRect(CX - ROAD_HALF, 0, ROAD_HALF * 2, CANVAS_H);
      ctx.fillRect(0, CY - ROAD_HALF, CANVAS_W, ROAD_HALF * 2);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(CX - ROAD_HALF, CY - ROAD_HALF, ROAD_HALF * 2, ROAD_HALF * 2);

      ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(CX - ROAD_HALF + 6, CY - ROAD_HALF + 6, ROAD_HALF * 2 - 12, ROAD_HALF * 2 - 12);
      ctx.beginPath();
      ctx.moveTo(CX - ROAD_HALF + 6, CY - ROAD_HALF + 6);
      ctx.lineTo(CX + ROAD_HALF - 6, CY + ROAD_HALF - 6);
      ctx.moveTo(CX + ROAD_HALF - 6, CY - ROAD_HALF + 6);
      ctx.lineTo(CX - ROAD_HALF + 6, CY + ROAD_HALF - 6);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(CX, 0);
      ctx.lineTo(CX, STOP_LINES.north);
      ctx.moveTo(CX, STOP_LINES.south);
      ctx.lineTo(CX, CANVAS_H);
      ctx.moveTo(0, CY);
      ctx.lineTo(STOP_LINES.west, CY);
      ctx.moveTo(STOP_LINES.east, CY);
      ctx.lineTo(CANVAS_W, CY);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 10]);
      [-37, 37].forEach((offset) => {
        ctx.beginPath();
        ctx.moveTo(CX + offset, 0);
        ctx.lineTo(CX + offset, STOP_LINES.north);
        ctx.moveTo(CX + offset, STOP_LINES.south);
        ctx.lineTo(CX + offset, CANVAS_H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, CY + offset);
        ctx.lineTo(STOP_LINES.west, CY + offset);
        ctx.moveTo(STOP_LINES.east, CY + offset);
        ctx.lineTo(CANVAS_W, CY + offset);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(241, 245, 249, 0.65)';
      for (let s = -ROAD_HALF + 8; s < ROAD_HALF - 6; s += 14) {
        ctx.fillRect(CX + s, STOP_LINES.north + 3, 7, 12);
        ctx.fillRect(CX + s, STOP_LINES.south - 15, 7, 12);
        ctx.fillRect(STOP_LINES.west + 3, CY + s, 12, 7);
        ctx.fillRect(STOP_LINES.east - 15, CY + s, 12, 7);
      }

      const drawStopLine = (lane, x1, y1, x2, y2) => {
        const st = sigMap[lane];
        ctx.strokeStyle =
          st === 'GREEN' ? '#00e37a' : st === 'YELLOW' ? '#ffb020' : '#ff4444';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };
      drawStopLine('north', CX - ROAD_HALF + 2, STOP_LINES.north, CX - 2, STOP_LINES.north);
      drawStopLine('south', CX + 2, STOP_LINES.south, CX + ROAD_HALF - 2, STOP_LINES.south);
      drawStopLine('west', STOP_LINES.west, CY + 2, STOP_LINES.west, CY + ROAD_HALF - 2);
      drawStopLine('east', STOP_LINES.east, CY - ROAD_HALF + 2, STOP_LINES.east, CY - 2);

      const vehicles = vehiclesRef.current;

      for (const lane of LANES) {
        for (const sub of [0, 1]) {
          const group = vehicles.filter((v) => v.lane === lane && v.subLane === sub);
          if (lane === 'north') group.sort((a, b) => b.y - a.y);
          if (lane === 'south') group.sort((a, b) => a.y - b.y);
          if (lane === 'west') group.sort((a, b) => b.x - a.x);
          if (lane === 'east') group.sort((a, b) => a.x - b.x);

          const sig = sigMap[lane];

          for (let i = 0; i < group.length; i += 1) {
            const v = group[i];
            const lead = i > 0 ? group[i - 1] : null;
            let mustStopForSignal = false;
            let distToStopLine = 999;

            if (lane === 'north') {
              const frontY = v.y + v.length / 2;
              distToStopLine = STOP_LINES.north - frontY;
            } else if (lane === 'south') {
              const frontY = v.y - v.length / 2;
              distToStopLine = frontY - STOP_LINES.south;
            } else if (lane === 'west') {
              const frontX = v.x + v.length / 2;
              distToStopLine = STOP_LINES.west - frontX;
            } else if (lane === 'east') {
              const frontX = v.x - v.length / 2;
              distToStopLine = frontX - STOP_LINES.east;
            }

            if (sig !== 'GREEN' && distToStopLine >= -4 && distToStopLine < 75) {
              mustStopForSignal = true;
            }

            let distToLead = 999;
            if (lead) {
              if (lane === 'north') {
                distToLead = (lead.y - lead.length / 2) - (v.y + v.length / 2);
              } else if (lane === 'south') {
                distToLead = (v.y - v.length / 2) - (lead.y + lead.length / 2);
              } else if (lane === 'west') {
                distToLead = (lead.x - lead.length / 2) - (v.x + v.length / 2);
              } else if (lane === 'east') {
                distToLead = (v.x - v.length / 2) - (lead.x + lead.length / 2);
              }
            }

            const minGap = 10;
            if (distToLead < minGap + 18) {
              v.speed = Math.max(0, Math.min(v.speed - 0.18, lead ? lead.speed * 0.9 : 0));
              if (distToLead <= minGap) v.speed = 0;
              v.braking = true;
            } else if (mustStopForSignal) {
              if (distToStopLine <= 6) {
                v.speed = 0;
              } else {
                v.speed = Math.max(0, Math.min(v.speed - 0.14, distToStopLine * 0.045));
              }
              v.braking = true;
            } else {
              v.speed = Math.min(v.maxSpeed, v.speed + 0.09);
              v.braking = false;
            }

            if (lane === 'north') v.y += v.speed;
            if (lane === 'south') v.y -= v.speed;
            if (lane === 'west') v.x += v.speed;
            if (lane === 'east') v.x -= v.speed;

            const exited =
              (lane === 'north' && v.y > CANVAS_H + 50) ||
              (lane === 'south' && v.y < -50) ||
              (lane === 'west' && v.x > CANVAS_W + 50) ||
              (lane === 'east' && v.x < -50);

            if (exited) {
              const tailOffset = 45 + Math.random() * 35;
              if (lane === 'north') {
                const minY = Math.min(...group.map((g) => g.y), -20);
                v.y = Math.min(-30, minY - tailOffset);
              } else if (lane === 'south') {
                const maxY = Math.max(...group.map((g) => g.y), CANVAS_H + 20);
                v.y = Math.max(CANVAS_H + 30, maxY + tailOffset);
              } else if (lane === 'west') {
                const minX = Math.min(...group.map((g) => g.x), -20);
                v.x = Math.min(-30, minX - tailOffset);
              } else if (lane === 'east') {
                const maxX = Math.max(...group.map((g) => g.x), CANVAS_W + 20);
                v.x = Math.max(CANVAS_W + 30, maxX + tailOffset);
              }
            }
          }
        }
      }

      for (const v of vehicles) {
        ctx.save();
        ctx.translate(v.x, v.y);
        if (v.lane === 'north') ctx.rotate(Math.PI / 2);
        if (v.lane === 'south') ctx.rotate(-Math.PI / 2);
        if (v.lane === 'east') ctx.rotate(Math.PI);

        const hw = v.length / 2;
        const hh = v.width / 2;

        ctx.fillStyle = 'rgba(254, 249, 195, 0.16)';
        ctx.beginPath();
        ctx.moveTo(hw, -hh + 2);
        ctx.lineTo(hw + 22, -hh - 4);
        ctx.lineTo(hw + 22, hh + 4);
        ctx.lineTo(hw, hh - 2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(-hw + 1, -hh + 2, v.length, v.width);

        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.roundRect(-hw, -hh, v.length, v.width, 3);
        ctx.fill();

        ctx.fillStyle = v.roof;
        ctx.fillRect(-hw * 0.45, -hh + 2, v.length * 0.55, v.width - 4);

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(hw * 0.18, -hh + 2.5, v.length * 0.18, v.width - 5);

        ctx.fillStyle = '#fef08a';
        ctx.fillRect(hw - 1.5, -hh + 1.5, 2, 3);
        ctx.fillRect(hw - 1.5, hh - 4.5, 2, 3);

        if (v.braking) {
          ctx.fillStyle = '#ff2a2a';
          ctx.shadowColor = '#ff2a2a';
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = '#7f1d1d';
        }
        ctx.fillRect(-hw - 0.5, -hh + 1.5, 2.2, 3.2);
        ctx.fillRect(-hw - 0.5, hh - 4.7, 2.2, 3.2);
        ctx.shadowBlur = 0;

        if (v.emergency) {
          const flashRed = Math.floor(tick / 6) % 2 === 0;
          ctx.fillStyle = flashRed ? '#ef4444' : '#3b82f6';
          ctx.shadowColor = flashRed ? '#ef4444' : '#3b82f6';
          ctx.shadowBlur = 10;
          ctx.fillRect(-3, -hh + 2, 6, v.width - 4);
          ctx.shadowBlur = 0;

          const ringR = 14 + (tick % 24) * 0.9;
          ctx.strokeStyle = flashRed
            ? 'rgba(239, 68, 68, 0.55)'
            : 'rgba(59, 130, 246, 0.55)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      const drawTrafficSignalHead = (lane, boxX, boxY) => {
        const st = sigMap[lane];
        const laneData = curLanesData[lane] || {};
        const mode = laneData.mode || 'normal';
        const rem =
          lane === curGreenLane
            ? curStageTimer
            : curCountdowns[lane] ?? laneData.green_seconds ?? 0;

        const w = 96;
        const h = 48;
        ctx.fillStyle = 'rgba(9, 15, 26, 0.94)';
        ctx.strokeStyle =
          st === 'GREEN' ? '#00e37a' : st === 'YELLOW' ? '#ffb020' : '#334155';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, w, h, 5);
        ctx.fill();
        ctx.stroke();

        const lamps = [
          { id: 'RED', cx: boxX + 16, cy: boxY + 15, activeColor: '#ff3b3b', dimColor: '#3b1219' },
          { id: 'YELLOW', cx: boxX + 34, cy: boxY + 15, activeColor: '#ffb020', dimColor: '#3d2c0e' },
          { id: 'GREEN', cx: boxX + 52, cy: boxY + 15, activeColor: '#00e37a', dimColor: '#093524' },
        ];

        for (const lamp of lamps) {
          const isLit = st === lamp.id;
          ctx.beginPath();
          ctx.arc(lamp.cx, lamp.cy, 6.5, 0, Math.PI * 2);
          ctx.fillStyle = isLit ? lamp.activeColor : lamp.dimColor;
          if (isLit) {
            ctx.shadowColor = lamp.activeColor;
            ctx.shadowBlur = 11;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#020617';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.font = '700 12px Arial, Helvetica, sans-serif';
        ctx.fillStyle =
          st === 'GREEN' ? '#00e37a' : st === 'YELLOW' ? '#ffb020' : '#ff5555';
        ctx.textAlign = 'right';
        ctx.fillText(`${String(rem).padStart(2, '0')}s`, boxX + w - 7, boxY + 19);

        ctx.font = '700 9.5px Arial, Helvetica, sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'left';
        const shortMode = mode === 'emergency' ? 'EMERG' : st;
        ctx.fillText(`${lane.toUpperCase()} · ${shortMode}`, boxX + 8, boxY + 38);
      };

      drawTrafficSignalHead('north', CX - ROAD_HALF - 108, STOP_LINES.north - 48);
      drawTrafficSignalHead('south', CX + ROAD_HALF + 12, STOP_LINES.south);
      drawTrafficSignalHead('west', STOP_LINES.west - 98, CY + ROAD_HALF + 12);
      drawTrafficSignalHead('east', STOP_LINES.east + 4, CY - ROAD_HALF - 60);

      animId = requestAnimationFrame(renderFrame);
    };

    animId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animId);
  }, [viewMode]);

  const calloutBoxes = {
    north: { x: 24, y: 24, lineX: 222, lineY: 74 },
    east: { x: 394, y: 24, lineX: 472, lineY: 124 },
    west: { x: 24, y: 416, lineX: 128, lineY: 416 },
    south: { x: 394, y: 416, lineX: 394, lineY: 468 },
  };

  const signalNodes = {
    north: { cx: 274, cy: 192 },
    south: { cx: 326, cy: 408 },
    west: { cx: 192, cy: 326 },
    east: { cx: 408, cy: 274 },
  };

  return (
    <div className="ops-panel">
      <div className="ops-panel-header" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 className="ops-panel-title">
            {`INTELLIGENT 4-WAY SIGNAL CONTROLLER · ${inputSourceInfo?.label || 'LIVE VIDEO INPUT PERCEPTION'}`}
          </h2>
          <div className="ops-panel-subtitle" style={{ marginTop: '2px' }}>
            {junctionInfo?.coordinates || '12.9716° N, 77.5946° E'} · ACTIVE SIGNAL:{' '}
            <strong
              style={{
                color:
                  phaseStage === 'GREEN'
                    ? 'var(--signal-green)'
                    : phaseStage === 'YELLOW'
                      ? 'var(--signal-amber)'
                      : 'var(--signal-red)',
              }}
            >
              {phaseStage === 'ALL_RED'
                ? `ALL-RED CLEARANCE (${stageTimer}s)`
                : `${activeGreenLane.toUpperCase()} ${phaseStage} (${stageTimer}s)`}
            </strong>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            className="ops-btn"
            style={{
              borderColor: viewMode === 'simulation' ? 'var(--signal-green)' : undefined,
              color: viewMode === 'simulation' ? 'var(--signal-green)' : undefined,
            }}
            onClick={() => setViewMode('simulation')}
          >
            Live Traffic &amp; Signals
          </button>
          <button
            type="button"
            className="ops-btn"
            style={{
              borderColor: viewMode === 'blueprint' ? 'var(--accent-cyan)' : undefined,
              color: viewMode === 'blueprint' ? 'var(--accent-cyan)' : undefined,
            }}
            onClick={() => setViewMode('blueprint')}
          >
            CAD Blueprint
          </button>
        </div>
      </div>

      {viewMode === 'simulation' && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            marginBottom: '8px',
            background: 'var(--bg-panel-subtle)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span
              className="font-mono-tabular"
              style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginRight: '2px' }}
            >
              SIGNAL PHASE:
            </span>
            {LANES.map((ln) => {
              const isAct = activeGreenLane === ln && phaseStage !== 'ALL_RED';
              return (
                <button
                  key={ln}
                  type="button"
                  className="ops-btn"
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.68rem',
                    borderColor: isAct ? 'var(--signal-green)' : undefined,
                    color: isAct ? 'var(--signal-green)' : undefined,
                  }}
                  onClick={() => onRequestSignalSwitch && onRequestSignalSwitch(ln)}
                >
                  {ln.toUpperCase()} {isAct ? `(${phaseStage})` : ''}
                </button>
              );
            })}
            <button
              type="button"
              className="ops-btn"
              style={{
                padding: '3px 8px',
                fontSize: '0.68rem',
                borderColor: autoPhaseRotate ? 'var(--accent-cyan)' : undefined,
                color: autoPhaseRotate ? 'var(--accent-cyan)' : undefined,
              }}
              onClick={() => onToggleAutoRotate && onToggleAutoRotate()}
            >
              {autoPhaseRotate ? 'Auto-Rotate: ON' : 'Auto-Rotate: HOLD'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <select
              value={spawnApproach}
              onChange={(e) => setSpawnApproach(e.target.value)}
              className="ops-junction-select font-mono-tabular"
              style={{ padding: '3px 6px', fontSize: '0.68rem' }}
              aria-label="Select road to spawn vehicle"
            >
              {LANES.map((ln) => (
                <option key={ln} value={ln}>
                  Spawn on {ln.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ops-btn"
              style={{ padding: '3px 7px', fontSize: '0.68rem' }}
              onClick={() => handleSpawnVehicle('car')}
            >
              + Car
            </button>
            <button
              type="button"
              className="ops-btn"
              style={{ padding: '3px 7px', fontSize: '0.68rem' }}
              onClick={() => handleSpawnVehicle('bus')}
            >
              + Bus
            </button>
            <button
              type="button"
              className="ops-btn"
              style={{ padding: '3px 7px', fontSize: '0.68rem' }}
              onClick={() => handleSpawnVehicle('truck')}
            >
              + Truck
            </button>
            <button
              type="button"
              className="ops-btn"
              style={{ padding: '3px 7px', fontSize: '0.68rem' }}
              onClick={() => handleSpawnVehicle('motorcycle')}
            >
              + Moto
            </button>
            <button
              type="button"
              className="ops-btn emergency-btn"
              style={{ padding: '3px 8px', fontSize: '0.68rem' }}
              onClick={() => handleSpawnVehicle('ambulance')}
            >
              + Ambulance
            </button>
          </div>
        </div>
      )}

      {viewMode === 'simulation' ? (
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#070d17',
            border: '1px solid var(--border-card)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ width: '100%', maxWidth: '680px', height: 'auto', display: 'block' }}
          />
        </div>
      ) : (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <svg
            viewBox="0 0 600 540"
            style={{ width: '100%', maxWidth: '640px', height: 'auto', display: 'block' }}
            role="img"
            aria-label="Four-way intersection blueprint schematic showing signal states, approach road names, and lane densities"
          >
            <defs>
              <filter id="greenSignalGlow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <rect x="12" y="12" width="576" height="516" fill="var(--cad-bg)" stroke="var(--border-card)" strokeWidth="1.5" />

            {[80, 140, 200, 400, 460, 520].map((pos) => (
              <g key={pos} stroke="var(--cad-grid)" strokeWidth="1">
                <line x1={pos} y1="12" x2={pos} y2="528" />
                <line x1="12" y1={pos} x2="588" y2={pos} />
              </g>
            ))}

            <rect x="230" y="14" width="140" height="512" fill="var(--cad-road)" stroke="var(--border-card)" strokeWidth="1.5" />
            <rect x="14" y="210" width="572" height="140" fill="var(--cad-road)" stroke="var(--border-card)" strokeWidth="1.5" />

            <rect
              x="230"
              y="210"
              width="140"
              height="140"
              fill="var(--cad-box)"
              stroke="var(--accent-primary)"
              strokeWidth="1.2"
              strokeDasharray="6 4"
            />

            <line x1="300" y1="20" x2="300" y2="194" stroke="var(--accent-cyan)" strokeWidth="1.8" strokeDasharray="10 8" strokeOpacity="0.75" />
            <line x1="300" y1="366" x2="300" y2="520" stroke="var(--accent-cyan)" strokeWidth="1.8" strokeDasharray="10 8" strokeOpacity="0.75" />
            <line x1="20" y1="280" x2="212" y2="280" stroke="var(--accent-cyan)" strokeWidth="1.8" strokeDasharray="10 8" strokeOpacity="0.75" />
            <line x1="388" y1="280" x2="580" y2="280" stroke="var(--accent-cyan)" strokeWidth="1.8" strokeDasharray="10 8" strokeOpacity="0.75" />

            <line x1="234" y1="206" x2="298" y2="206" stroke="var(--accent-cyan)" strokeWidth="3" />
            <line x1="302" y1="354" x2="366" y2="354" stroke="var(--accent-cyan)" strokeWidth="3" />
            <line x1="226" y1="282" x2="226" y2="346" stroke="var(--accent-cyan)" strokeWidth="3" />
            <line x1="374" y1="214" x2="374" y2="278" stroke="var(--accent-cyan)" strokeWidth="3" />

            {LANES.map((lane) => {
              const laneInfo = lanesData[lane] || {};
              const activeTicks = getTickCount(laneInfo.weighted_score);
              const mode = laneInfo.mode || 'normal';
              const isGreen = phaseStage === 'GREEN' && activeGreenLane === lane;
              const tickColor = isGreen ? 'var(--signal-green)' : mode === 'hold' ? 'var(--signal-hold)' : 'var(--accent-cyan)';

              return Array.from({ length: 10 }).map((_, idx) => {
                const lit = idx < activeTicks;
                const stroke = lit ? tickColor : 'var(--border-card)';
                const opacity = lit ? 0.95 : 0.35;

                if (lane === 'north') {
                  return <rect key={`tick-n-${idx}`} x="244" y={182 - idx * 15} width="42" height="7" fill={stroke} fillOpacity={opacity} />;
                }
                if (lane === 'south') {
                  return <rect key={`tick-s-${idx}`} x="314" y={370 + idx * 15} width="42" height="7" fill={stroke} fillOpacity={opacity} />;
                }
                if (lane === 'west') {
                  return <rect key={`tick-w-${idx}`} x={200 - idx * 17} y="294" width="8" height="42" fill={stroke} fillOpacity={opacity} />;
                }
                return <rect key={`tick-e-${idx}`} x={390 + idx * 17} y="224" width="8" height="42" fill={stroke} fillOpacity={opacity} />;
              });
            })}

            {LANES.map((lane) => {
              const info = lanesData[lane] || {};
              const mode = info.mode || 'normal';
              const greenSec = Number(info.green_seconds || 0);
              const remSec = lane === activeGreenLane ? stageTimer : countdowns[lane] ?? greenSec;
              const isGreen = phaseStage === 'GREEN' && activeGreenLane === lane;
              const sigColor = getSignalColor(isGreen, mode);
              const nodePos = signalNodes[lane];
              const box = calloutBoxes[lane];

              return (
                <g key={`schematic-lane-${lane}`}>
                  <line
                    x1={nodePos.cx}
                    y1={nodePos.cy}
                    x2={box.lineX}
                    y2={box.lineY}
                    stroke={isGreen ? 'var(--signal-green)' : 'var(--border-card)'}
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={nodePos.cx}
                    cy={nodePos.cy}
                    r="12"
                    fill={sigColor}
                    stroke="var(--cad-bg)"
                    strokeWidth="2.5"
                    filter={isGreen ? 'url(#greenSignalGlow)' : undefined}
                  />
                  <text
                    x={nodePos.cx + (lane === 'east' || lane === 'south' ? 18 : -18)}
                    y={nodePos.cy + 5}
                    fill={isGreen ? 'var(--signal-green)' : 'var(--cad-label)'}
                    textAnchor={lane === 'east' || lane === 'south' ? 'start' : 'end'}
                    fontFamily="Arial, Helvetica, sans-serif"
                    fontSize="12"
                    fontWeight="700"
                  >
                    {lane.toUpperCase()} · {String(remSec).padStart(2, '0')}s
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div
        className="ops-lane-meta-row"
        style={{
          marginTop: '10px',
          paddingTop: '10px',
          borderTop: '1px solid var(--grid-line-subtle)',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <span>
          <strong style={{ color: 'var(--signal-green)' }}>● GREEN LAMP</strong>: Vehicles Flow Through Intersection
        </span>
        <span>
          <strong style={{ color: 'var(--signal-amber)' }}>● YELLOW LAMP (3s)</strong>: Approach Deceleration &amp; Clearance
        </span>
        <span>
          <strong style={{ color: 'var(--signal-red)' }}>● RED LAMP</strong>: Vehicles Queue Behind Stop-Line (Brake Lights ON)
        </span>
        <span>
          <strong style={{ color: 'var(--accent-primary)' }}>■ CAR</strong> ·{' '}
          <strong style={{ color: 'var(--signal-amber)' }}>■ BUS/TRUCK</strong> ·{' '}
          <strong style={{ color: 'var(--signal-green)' }}>■ MOTO</strong> ·{' '}
          <strong style={{ color: 'var(--signal-red)' }}>■ EMERGENCY STROBE</strong>
        </span>
      </div>
    </div>
  );
}
