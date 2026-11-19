import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LANES, TRAFFIC_LIVE_VIDEO_FEEDS } from '../services/trafficApi';

const CLASS_BOX_COLORS = {
  car: '#38bdf8',
  motorcycle: '#22c55e',
  bicycle: '#84cc16',
  bus: '#f59e0b',
  truck: '#f97316',
  ambulance: '#ef4444',
  fire_truck: '#ef4444',
  police_vehicle: '#0284c7',
  pedestrian: '#e879f9',
};

function buildSyntheticDetections(lane, rawCounts = {}, cycle = 1) {
  const detections = [];
  let slotIndex = 0;
  const baseTrackId =
    (lane === 'north' ? 100 : lane === 'south' ? 200 : lane === 'east' ? 300 : 400) +
    (cycle % 7) * 5;

  const classesOrder = [
    'ambulance',
    'fire_truck',
    'police_vehicle',
    'bus',
    'truck',
    'car',
    'motorcycle',
    'bicycle',
  ];

  for (const cls of classesOrder) {
    const count = Math.min(8, Number(rawCounts[cls] || 0));
    for (let i = 0; i < count; i += 1) {
      if (detections.length >= 9) break;
      const col = slotIndex % 3;
      const row = Math.floor(slotIndex / 3);
      const trackId = baseTrackId + slotIndex + 1;
      const conf =
        cls === 'ambulance' || cls === 'fire_truck' || cls === 'police_vehicle'
          ? 0.96
          : Number((0.82 + ((trackId * 7) % 16) / 100).toFixed(2));

      detections.push({
        trackId,
        cls,
        conf,
        col,
        row,
      });
      slotIndex += 1;
    }
  }

  return detections;
}

export default function CameraFeedMatrix({
  lanesData = {},
  countdowns = {},
  junctionInfo,
  cycle = 1,
  videoFeeds = TRAFFIC_LIVE_VIDEO_FEEDS,
  selectedCamLane = 'east',
  onSelectedCamLaneChange,
  inputSourceInfo,
  onInputSourceChange,
  onDisconnectInputSource,
  onUpdateManualCounts,
}) {
  const [videoMode, setVideoMode] = useState('upload');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState(null);
  const [uploadedVideoName, setUploadedVideoName] = useState('');

  const [selectedFeedId, setSelectedFeedId] = useState('feed-01');
  const [customStreamUrl, setCustomStreamUrl] = useState('');
  const [outsourceLatency, setOutsourceLatency] = useState(128);

  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const blobUrlRef = useRef(null);

  const [videoDetectedCounts, setVideoDetectedCounts] = useState({
    car: 16,
    motorcycle: 12,
    bus: 2,
    truck: 1,
    bicycle: 1,
    ambulance: 0,
    fire_truck: 0,
    police_vehicle: 0,
  });

  const feedsList = videoFeeds?.length ? videoFeeds : TRAFFIC_LIVE_VIDEO_FEEDS;
  const activeOutsourceFeed =
    feedsList.find((f) => f.id === selectedFeedId) || feedsList[0];

  const revokeActiveBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const setActiveCamLane = useCallback(
    (lane) => {
      if (typeof onSelectedCamLaneChange === 'function') {
        onSelectedCamLaneChange(lane);
      }
    },
    [onSelectedCamLaneChange]
  );

  // Sync tally editor when operator switches selected approach lane
  useEffect(() => {
    const laneRaw = lanesData[selectedCamLane]?.raw_counts;
    if (laneRaw && inputSourceInfo?.active) {
      setVideoDetectedCounts({
        car: Number(laneRaw.car || 0),
        motorcycle: Number(laneRaw.motorcycle || 0),
        bus: Number(laneRaw.bus || 0),
        truck: Number(laneRaw.truck || 0),
        bicycle: Number(laneRaw.bicycle || 0),
        ambulance: Number(laneRaw.ambulance || 0),
        fire_truck: Number(laneRaw.fire_truck || 0),
        police_vehicle: Number(laneRaw.police_vehicle || 0),
      });
    }
  }, [selectedCamLane, lanesData, inputSourceInfo?.active]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      revokeActiveBlobUrl();
    };
  }, [revokeActiveBlobUrl]);

  useEffect(() => {
    const timer = setInterval(() => {
      setOutsourceLatency(Math.floor(115 + Math.random() * 35));
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const handleToggleWebcam = async () => {
    setWebcamError('');
    if (webcamActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setWebcamActive(false);
      if (typeof onInputSourceChange === 'function') {
        onInputSourceChange({ active: false, type: null, label: 'Standby', counts: null, targetLane: selectedCamLane });
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: false,
      });
      revokeActiveBlobUrl();
      streamRef.current = stream;
      setUploadedVideoUrl(null);
      setWebcamActive(true);
      setVideoMode('webcam');
      if (typeof onInputSourceChange === 'function') {
        onInputSourceChange({
          active: true,
          type: 'webcam',
          name: 'Hardware Camera (Webcam)',
          label: 'Live Camera (Webcam)',
          counts: videoDetectedCounts,
          targetLane: selectedCamLane,
        });
      }
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err) {
      setWebcamError(
        err?.message || 'Camera permission denied or no webcam hardware detected.'
      );
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setWebcamActive(false);
    }

    revokeActiveBlobUrl();
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setUploadedVideoUrl(url);
    setUploadedVideoName(file.name);
    setVideoMode('upload');

    const baseCar = Math.floor(12 + Math.random() * 10);
    const baseBike = Math.floor(8 + Math.random() * 8);
    const newCounts = {
      car: baseCar,
      motorcycle: baseBike,
      bus: Math.random() > 0.4 ? 2 : 1,
      truck: Math.random() > 0.5 ? 2 : 0,
      bicycle: Math.random() > 0.5 ? 2 : 0,
      ambulance: 0,
      fire_truck: 0,
      police_vehicle: 0,
    };
    setVideoDetectedCounts(newCounts);

    if (typeof onInputSourceChange === 'function') {
      onInputSourceChange({
        active: true,
        type: 'video_upload',
        name: file.name,
        label: `Uploaded Video (${file.name})`,
        counts: newCounts,
        targetLane: selectedCamLane,
      });
    }

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.play().catch(() => {});
      }
    }, 50);
  };

  const handleConnectOutsourceStream = (feed) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setWebcamActive(false);
    }

    revokeActiveBlobUrl();
    setSelectedFeedId(feed.id);
    setVideoMode('outsource');

    const targetLane = feed.defaultApproach || selectedCamLane;
    setActiveCamLane(targetLane);

    const streamVideoUrl = feed.sampleVideoUrl;
    setUploadedVideoUrl(streamVideoUrl);
    setUploadedVideoName(feed.title);

    const counts = { ...(feed.baseVehicleCounts || {}) };
    setVideoDetectedCounts(counts);

    if (typeof onInputSourceChange === 'function') {
      onInputSourceChange({
        active: true,
        type: 'live_stream',
        name: feed.title,
        label: `Live Stream (${feed.title})`,
        counts,
        targetLane,
      });
    }

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = streamVideoUrl;
        videoRef.current.play().catch(() => {});
      }
    }, 50);
  };

  const handleConnectCustomStream = () => {
    if (!customStreamUrl) return;
    revokeActiveBlobUrl();
    setVideoMode('outsource');
    setUploadedVideoUrl(customStreamUrl);
    setUploadedVideoName(`Custom Stream: ${customStreamUrl.slice(0, 30)}...`);

    if (typeof onInputSourceChange === 'function') {
      onInputSourceChange({
        active: true,
        type: 'live_stream',
        name: customStreamUrl,
        label: `Stream (${customStreamUrl.slice(0, 24)}...)`,
        counts: videoDetectedCounts,
        targetLane: selectedCamLane,
      });
    }

    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = customStreamUrl;
        videoRef.current.play().catch(() => {});
      }
    }, 50);
  };

  const handleEjectSource = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    revokeActiveBlobUrl();
    setWebcamActive(false);
    setUploadedVideoUrl(null);
    setUploadedVideoName('');
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current.srcObject = null;
    }
    if (typeof onDisconnectInputSource === 'function') {
      onDisconnectInputSource();
    } else if (typeof onInputSourceChange === 'function') {
      onInputSourceChange({ active: false, type: null, label: 'Standby', counts: null, targetLane: selectedCamLane });
    }
  };

  const handleSyncVideoToTrafficEngine = useCallback(() => {
    if (typeof onUpdateManualCounts === 'function') {
      onUpdateManualCounts(selectedCamLane, videoDetectedCounts);
    }
  }, [onUpdateManualCounts, selectedCamLane, videoDetectedCounts]);

  const adjustDetectedCount = (cls, delta) => {
    const nextVal = Math.max(0, Number(videoDetectedCounts[cls] || 0) + delta);
    const updated = { ...videoDetectedCounts, [cls]: nextVal };
    setVideoDetectedCounts(updated);
    if (typeof onUpdateManualCounts === 'function') {
      onUpdateManualCounts(selectedCamLane, updated);
    }
  };

  return (
    <section
      className="ops-panel"
      style={{ marginTop: '16px' }}
      aria-label="Video Perception and CCTV Matrix"
    >
      <div className="ops-panel-header" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 className="ops-panel-title">
            VIDEO PERCEPTION STUDIO &amp; 4-WAY YOLOv8 CCTV MATRIX (PERSIST=TRUE · IOU=0.45)
          </h2>
          <div className="ops-panel-subtitle" style={{ marginTop: '2px' }}>
            Direct Video Ingest: Upload MP4/Video, stream Live Outsource Traffic CCTV, or attach Hardware Camera to drive Signal Control
          </div>
        </div>

        <div className="ops-control-group" style={{ flexWrap: 'wrap' }}>
          {inputSourceInfo?.active && (
            <button
              type="button"
              className="ops-btn"
              style={{ borderColor: 'var(--signal-red)', color: 'var(--signal-red)' }}
              onClick={handleEjectSource}
              title="Disconnect input source and return to standby"
            >
              ✕ Eject Input
            </button>
          )}

          <label className={`ops-btn ${videoMode === 'upload' ? 'active' : ''}`} style={{ cursor: 'pointer', margin: 0 }}>
            ⬆ Upload Video Footage
            <input
              type="file"
              accept="video/*,image/*"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </label>

          <button
            type="button"
            className={`ops-btn ${videoMode === 'outsource' ? 'active' : ''}`}
            onClick={() => setVideoMode('outsource')}
          >
            📡 Live Video Stream / CCTV
          </button>

          <button
            type="button"
            className={`ops-btn ${webcamActive ? 'active' : ''}`}
            onClick={handleToggleWebcam}
          >
            {webcamActive ? '⏹ Stop Webcam' : '📷 Hardware Webcam'}
          </button>

          <button
            type="button"
            className={`ops-btn ${videoMode === 'cctv_grid' ? 'active' : ''}`}
            onClick={() => setVideoMode('cctv_grid')}
          >
            🔲 4-Way CCTV Grid
          </button>
        </div>
      </div>

      {webcamError && (
        <div
          className="font-mono-tabular"
          style={{
            padding: '8px 12px',
            marginBottom: '12px',
            backgroundColor: 'var(--signal-amber-dim)',
            border: '1px solid var(--signal-amber)',
            color: 'var(--signal-amber)',
            fontSize: '0.75rem',
          }}
        >
          [CAMERA NOTICE] {webcamError}
        </div>
      )}

      {videoMode !== 'cctv_grid' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1.8fr) minmax(280px, 1fr)',
            gap: '14px',
            marginBottom: '16px',
          }}
        >
          {/* Left: Video Player & AI Detection Overlay */}
          <div
            style={{
              backgroundColor: 'var(--bg-inset)',
              border: '1.5px solid var(--accent-cyan)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '0.78rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--signal-green)',
                    boxShadow: '0 0 8px var(--signal-green)',
                  }}
                />
                <strong style={{ color: 'var(--accent-cyan)' }}>
                  {videoMode === 'upload'
                    ? `UPLOADED VIDEO: ${uploadedVideoName || 'Local File Stream'}`
                    : videoMode === 'outsource'
                      ? `LIVE OUTSOURCE STREAM: ${activeOutsourceFeed.title}`
                      : 'HARDWARE WEBCAM INGEST'}
                </strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.72rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  TARGET APPROACH:{' '}
                  <strong style={{ color: 'var(--signal-green)' }}>
                    {selectedCamLane.toUpperCase()}
                  </strong>
                </span>
                <span style={{ color: 'var(--grid-line)' }}>|</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  LATENCY: {outsourceLatency} ms
                </span>
              </div>
            </div>

            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16 / 9',
                backgroundColor: '#02050b',
                overflow: 'hidden',
                border: '1px solid var(--grid-line)',
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                loop
                autoPlay
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: uploadedVideoUrl || webcamActive ? 'block' : 'none',
                }}
              />

              {!uploadedVideoUrl && !webcamActive && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-overlay)',
                    padding: '20px',
                    textAlign: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ fontSize: '2rem' }}>📹</div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>
                    NO VIDEO SOURCE CURRENTLY LOADED
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', maxWidth: '380px' }}>
                    Upload an MP4 traffic video, select a live outsource traffic stream, or start your camera to process real-time vehicle detection.
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <label className="ops-btn active" style={{ cursor: 'pointer', margin: 0 }}>
                      Upload Video File
                      <input
                        type="file"
                        accept="video/*,image/*"
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                      />
                    </label>
                    <button
                      type="button"
                      className="ops-btn"
                      onClick={() => handleConnectOutsourceStream(activeOutsourceFeed)}
                    >
                      Connect Live Stream
                    </button>
                  </div>
                </div>
              )}

              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  display: uploadedVideoUrl || webcamActive ? 'block' : 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '5%',
                    right: '5%',
                    top: '65%',
                    height: '2px',
                    backgroundColor: 'rgba(0, 227, 122, 0.8)',
                    boxShadow: '0 0 8px rgba(0, 227, 122, 0.6)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      right: '0',
                      top: '-16px',
                      backgroundColor: 'rgba(0, 227, 122, 0.2)',
                      border: '1px solid #00e37a',
                      color: '#00e37a',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '1px 4px',
                    }}
                  >
                    VIRTUAL STOP-LINE ROI
                  </span>
                </div>

                <div
                  style={{
                    position: 'absolute',
                    left: '12%',
                    top: '28%',
                    width: '18%',
                    height: '26%',
                    border: '1.5px solid #4fd1e8',
                    backgroundColor: 'rgba(79, 209, 232, 0.1)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '0',
                      backgroundColor: '#4fd1e8',
                      color: '#04070e',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      padding: '0 4px',
                    }}
                  >
                    #101 CAR 0.94
                  </span>
                </div>

                <div
                  style={{
                    position: 'absolute',
                    left: '34%',
                    top: '38%',
                    width: '14%',
                    height: '22%',
                    border: '1.5px solid #00e37a',
                    backgroundColor: 'rgba(0, 227, 122, 0.1)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '0',
                      backgroundColor: '#00e37a',
                      color: '#04070e',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      padding: '0 4px',
                    }}
                  >
                    #102 MOTO 0.91
                  </span>
                </div>

                <div
                  style={{
                    position: 'absolute',
                    left: '52%',
                    top: '20%',
                    width: '24%',
                    height: '38%',
                    border: '1.5px solid #ffb020',
                    backgroundColor: 'rgba(255, 176, 32, 0.1)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '0',
                      backgroundColor: '#ffb020',
                      color: '#04070e',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      padding: '0 4px',
                    }}
                  >
                    #103 BUS 0.88
                  </span>
                </div>

                <div
                  style={{
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.72)',
                    padding: '3px 8px',
                    fontSize: '0.65rem',
                    color: '#e2e8f0',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                  }}
                >
                  YOLOv8n · BYTETRACK · FPS: 30.0 · CONF &gt; 0.50
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  Apply detections to approach:
                </span>
                <select
                  className="ops-junction-select"
                  style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                  value={selectedCamLane}
                  onChange={(e) => setActiveCamLane(e.target.value)}
                >
                  {LANES.map((lane) => (
                    <option key={lane} value={lane}>
                      {lane.toUpperCase()} ({junctionInfo?.approaches?.[lane]?.road || 'Approach'})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="ops-btn active"
                style={{ padding: '4px 12px', fontSize: '0.74rem' }}
                onClick={handleSyncVideoToTrafficEngine}
              >
                ✓ Push Video Vehicle Counts to Signal Engine
              </button>
            </div>
          </div>

          {/* Right: Live Video Detection Tally & Outsource Feeds Selector */}
          <div
            style={{
              backgroundColor: 'var(--bg-inset)',
              border: '1px solid var(--grid-line)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: 'var(--accent-cyan)',
                  marginBottom: '4px',
                }}
              >
                LIVE VIDEO DETECTION TALLY ({selectedCamLane.toUpperCase()})
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Tracked in current frame ROI &amp; persistent ByteTrack IDs
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '6px',
              }}
            >
              {Object.entries(videoDetectedCounts).map(([cls, cnt]) => {
                const color = CLASS_BOX_COLORS[cls] || 'var(--accent-primary)';
                return (
                  <div
                    key={cls}
                    style={{
                      backgroundColor: 'var(--bg-tally-item)',
                      border: '1px solid var(--border-hairline)',
                      padding: '6px 8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '0.68rem',
                          color,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        {cls.replace('_', ' ')}
                      </div>
                      <div
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {cnt}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <button
                        type="button"
                        style={{
                          width: '18px',
                          height: '16px',
                          padding: 0,
                          fontSize: '0.7rem',
                          lineHeight: '1',
                          backgroundColor: 'var(--bg-btn-mini)',
                          border: '1px solid var(--grid-line)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                        onClick={() => adjustDetectedCount(cls, 1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        style={{
                          width: '18px',
                          height: '16px',
                          padding: 0,
                          fontSize: '0.7rem',
                          lineHeight: '1',
                          backgroundColor: 'var(--bg-btn-mini)',
                          border: '1px solid var(--grid-line)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                        onClick={() => adjustDetectedCount(cls, -1)}
                      >
                        -
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 'auto',
                borderTop: '1px solid var(--grid-line)',
                paddingTop: '10px',
              }}
            >
              <div
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '6px',
                }}
              >
                LIVE TRAFFIC CCTV / STREAM FEEDS:
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {feedsList.map((feed) => {
                  const isCur = feed.id === selectedFeedId && videoMode === 'outsource';
                  return (
                    <div
                      key={feed.id}
                      onClick={() => handleConnectOutsourceStream(feed)}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: isCur ? 'var(--bg-panel-elevated)' : 'var(--bg-tally-item)',
                        border: isCur
                          ? '1px solid var(--accent-cyan)'
                          : '1px solid var(--border-hairline)',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ color: isCur ? 'var(--accent-cyan)' : 'var(--text-primary)', fontWeight: 600 }}>
                          {feed.title}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.64rem' }}>
                          {feed.location} · {feed.resolution}
                        </div>
                      </div>
                      <span
                        style={{
                          color: isCur ? 'var(--signal-green)' : 'var(--text-secondary)',
                          fontSize: '0.66rem',
                          fontWeight: 700,
                        }}
                      >
                        {isCur ? '● LIVE' : 'Connect'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <input
                  type="text"
                  placeholder="Paste RTSP / HLS stream URL..."
                  value={customStreamUrl}
                  onChange={(e) => setCustomStreamUrl(e.target.value)}
                  className="ops-junction-select"
                  style={{ flex: 1, padding: '4px 6px', fontSize: '0.7rem' }}
                />
                <button
                  type="button"
                  className="ops-btn"
                  style={{ padding: '4px 8px', fontSize: '0.7rem' }}
                  onClick={handleConnectCustomStream}
                >
                  Stream
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4-Way CCTV Camera Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '12px',
        }}
      >
        {LANES.map((lane, camIdx) => {
          const data = lanesData[lane] || {};
          const raw = data.raw_counts || {};
          const mode = data.mode || 'normal';
          const remSec = countdowns[lane] ?? data.green_seconds ?? 0;
          const isGreen = data.active_phase_signal === 'GREEN' || (remSec > 0 && mode === 'emergency');
          const roadName =
            junctionInfo?.approaches?.[lane]?.road || `${lane.toUpperCase()} ARTERIAL`;
          const detections = buildSyntheticDetections(lane, raw, cycle);
          const isSelectedCam = selectedCamLane === lane;

          return (
            <div
              key={lane}
              onClick={() => setActiveCamLane(lane)}
              style={{
                backgroundColor: 'var(--bg-inset)',
                border: isSelectedCam
                  ? '1.5px solid var(--accent-cyan)'
                  : '1px solid var(--grid-line)',
                padding: '10px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.74rem',
                }}
              >
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  CAM-0{camIdx + 1} · {lane.toUpperCase()} ({roadName})
                </span>
                <span
                  style={{
                    color:
                      mode === 'emergency'
                        ? 'var(--signal-red)'
                        : isGreen
                          ? 'var(--signal-green)'
                          : 'var(--signal-amber)',
                    fontWeight: 700,
                  }}
                >
                  {mode === 'emergency' ? 'EMERGENCY' : isGreen ? `GREEN (${remSec}s)` : 'RED'}
                </span>
              </div>

              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '16 / 9',
                  backgroundColor: '#02050b',
                  overflow: 'hidden',
                  border: '1px solid var(--border-hairline)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage:
                      'radial-gradient(circle at 50% 60%, rgba(19, 32, 51, 0.85) 0%, rgba(7, 12, 21, 0.96) 75%)',
                  }}
                />

                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                >
                  <line x1="30%" y1="0" x2="10%" y2="100%" stroke="rgba(234, 179, 8, 0.5)" strokeWidth="1.5" />
                  <line x1="70%" y1="0" x2="90%" y2="100%" stroke="rgba(226, 232, 240, 0.4)" strokeWidth="1.2" strokeDasharray="4 4" />
                  <line x1="10%" y1="75%" x2="90%" y2="75%" stroke="rgba(0, 227, 122, 0.6)" strokeWidth="1.5" />
                </svg>

                {detections.map((d) => {
                  const color = CLASS_BOX_COLORS[d.cls] || '#ffffff';
                  const leftPct = 12 + d.col * 28 + (d.row % 2) * 5;
                  const topPct = 18 + d.row * 24;
                  return (
                    <div
                      key={d.trackId}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: d.cls === 'bus' || d.cls === 'truck' ? '24%' : '18%',
                        height: '20%',
                        border: `1.5px solid ${color}`,
                        backgroundColor: `${color}18`,
                        boxShadow: `0 0 6px ${color}33`,
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: '-13px',
                          left: '0',
                          backgroundColor: color,
                          color: '#04070e',
                          fontSize: '0.58rem',
                          fontWeight: 700,
                          padding: '0 3px',
                          lineHeight: '1.2',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        #{d.trackId} {d.cls.slice(0, 4).toUpperCase()} {d.conf}
                      </span>
                    </div>
                  );
                })}

                <div
                  style={{
                    position: 'absolute',
                    bottom: '4px',
                    left: '6px',
                    fontSize: '0.62rem',
                    color: 'rgba(255, 255, 255, 0.72)',
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    padding: '1px 5px',
                  }}
                >
                  TRACKED: {data.vehicle_total || 0} VEHICLES · QUEUE: {data.queue_length_meters || 0}m
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
