'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

interface AnalysisResult {
  success: boolean;
  message: string;
  data: {
    face_detected: boolean;
    bounding_box: { x: number; y: number; width: number; height: number };
    head_pose: { pitch: number; yaw: number; roll: number } | null;
    eye_analysis: { left_eye_openness: number; right_eye_openness: number; average_openness: number };
    expressions: { smile_probability: number };
    action_units: Record<string, number> | null;
    landmarks_count: number;
  } | null;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAutoCapture, setIsAutoCapture] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [scanStatus, setScanStatus] = useState<'ready' | 'scanning' | 'success' | 'no-face'>('ready');

  // Bangkok Hospital Colors - Blue & Red
  const colors = {
    primary: '#1565C0',      // Blue
    primaryDark: '#0D47A1',  // Dark Blue
    accent: '#E31937',       // Red
    accentLight: '#FFEBEE',  // Light Red bg
    lightBg: '#E3F2FD',      // Light Blue bg
    text: '#1A237E',         // Dark Blue text
    textLight: '#546E7A',
    white: '#FFFFFF',
    success: '#2E7D32',
    warning: '#F57C00'
  };

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Check API status on mount
  useEffect(() => {
    fetch("http://localhost:8000")
      .then(res => res.json())
      .then(data => console.log("API OK:", data))
      .catch(err => console.error("API ERROR:", err));
  }, []);

  // Auto capture interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoCapture && isStreaming) {
      interval = setInterval(() => {
        captureAndAnalyze();
      }, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoCapture, isStreaming]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
        setError(null);
        setScanStatus('ready');
      }
    } catch (err) {
      setError('ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการใช้งานกล้อง');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
      setIsAutoCapture(false);
      setScanStatus('ready');
    }
  };

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);

    setIsAnalyzing(true);
    setScanStatus('scanning');

    try {
      const response = await fetch('http://localhost:8000/analyze-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData })
      });

      const data: AnalysisResult = await response.json();
      setResult(data);
      setError(null);

      if (data.success && data.data?.face_detected) {
        setScanStatus('success');
      } else {
        setScanStatus('no-face');
      }
    } catch (err) {
      setError('การวิเคราะห์ล้มเหลว กรุณาตรวจสอบการเชื่อมต่อ');
      setScanStatus('ready');
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing]);

  // Calculate Depression Risk Score
  const calculateDepressionRisk = () => {
    if (!result?.data?.action_units) return null;

    const aus = result.data.action_units;
    let riskScore = 0;
    let factors: string[] = [];

    // AU04 - Brow Lowerer (worry)
    const au04 = Object.entries(aus).find(([k]) => k.includes('AU04'))?.[1] || 0;
    if (au04 > 0.4) { riskScore += 20; factors.push('คิ้วขมวด'); }

    // AU15 - Lip Corner Depressor (sadness)
    const au15 = Object.entries(aus).find(([k]) => k.includes('AU15'))?.[1] || 0;
    if (au15 > 0.4) { riskScore += 25; factors.push('มุมปากตก'); }

    // AU01 - Inner Brow Raiser (distress)
    const au01 = Object.entries(aus).find(([k]) => k.includes('AU01'))?.[1] || 0;
    if (au01 > 0.5) { riskScore += 15; factors.push('คิ้วยกด้านใน'); }

    // Low smile
    if (result.data.expressions.smile_probability < 0.2) {
      riskScore += 15; factors.push('ไม่ยิ้ม');
    }

    // Head down (negative pitch)
    if (result.data.head_pose && result.data.head_pose.pitch < -10) {
      riskScore += 10; factors.push('ก้มหน้า');
    }

    // Low eye openness
    if (result.data.eye_analysis.average_openness < 0.5) {
      riskScore += 15; factors.push('ดวงตาเปิดน้อย');
    }

    return { score: Math.min(100, riskScore), factors };
  };

  const depressionRisk = result?.success ? calculateDepressionRisk() : null;

  // Format date in Thai
  const formatThaiDate = (date: Date) => {
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const thaiDays = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
    const buddhistYear = date.getFullYear() + 543;
    return `${thaiDays[date.getDay()]}ที่ ${date.getDate()} ${thaiMonths[date.getMonth()]} ${buddhistYear}`;
  };

  const formatEnglishDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return { hours, minutes, seconds };
  };

  const time = formatTime(currentTime);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #F5F7FA 0%, #E8EEF5 100%)',
      padding: '30px 40px',
      fontFamily: '"Noto Sans Thai", "Inter", system-ui, sans-serif'
    }}>
      {/* Header Bar */}
      <div style={{
        background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
        borderRadius: '16px',
        padding: '20px 30px',
        marginBottom: '25px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 4px 20px rgba(21, 101, 192, 0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img
            src="/LOGO-BKH.svg"
            alt="Bangkok Hospital"
            style={{ height: '50px', objectFit: 'contain' }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '700', color: 'white' }}>
              Bangkok Hospital
            </h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)' }}>
              RATCHASIMA - Mental Wellness Screening
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right', color: 'white' }}>
          <div style={{ fontSize: '2rem', fontWeight: '300' }}>
            {time.hours}:{time.minutes}<span style={{ fontSize: '1rem', opacity: 0.8 }}>:{time.seconds}</span>
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{formatThaiDate(currentTime)}</div>
        </div>
      </div>

      <div style={{
        maxWidth: '1500px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '320px 1fr 420px',
        gap: '25px',
        alignItems: 'start'
      }}>
        {/* Left Side - Instructions */}
        <div>
          {/* Instructions Card */}
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '22px',
            boxShadow: '0 2px 15px rgba(0,0,0,0.05)',
            marginBottom: '20px',
            borderTop: `4px solid ${colors.primary}`
          }}>
            <h3 style={{
              margin: '0 0 18px',
              fontSize: '0.9rem',
              color: colors.primary,
              fontWeight: '700',
              letterSpacing: '0.5px'
            }}>
              INSTRUCTIONS / คำแนะนำ
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <InstructionItem
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill={colors.primary}><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>}
                title="Remove Accessories"
                subtitle="กรุณาถอดแว่นตา หน้ากาก หรือหมวก"
                color={colors.primary}
              />
              <InstructionItem
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill={colors.primary}><path d="M9 11.75c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>}
                title="Position Face"
                subtitle="วางใบหน้าให้อยู่ในกรอบวงกลม"
                color={colors.primary}
              />
              <InstructionItem
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill={colors.primary}><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>}
                title="Stay Relaxed"
                subtitle="ทำใจให้สบาย แสดงสีหน้าตามธรรมชาติ"
                color={colors.primary}
              />
            </div>
          </div>

          {/* Depression Info Card */}
          <div style={{
            background: colors.accentLight,
            borderRadius: '16px',
            padding: '20px',
            borderLeft: `4px solid ${colors.accent}`
          }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', color: colors.accent, fontWeight: '700' }}>
              Depression Indicators
            </h4>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: '0.8rem', color: '#5D4037', lineHeight: '1.8' }}>
              <li><strong>AU04</strong> - คิ้วขมวด (กังวล)</li>
              <li><strong>AU15</strong> - มุมปากตก (เศร้า)</li>
              <li><strong>AU12 ต่ำ</strong> - ไม่ยิ้ม</li>
              <li><strong>Pitch ติดลบ</strong> - ก้มหน้า</li>
            </ul>
          </div>
        </div>

        {/* Center - Camera */}
        <div>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '25px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.08)'
          }}>
            {/* Status Badge */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                background: scanStatus === 'success' ? '#E8F5E9' :
                           scanStatus === 'scanning' ? '#FFF8E1' :
                           scanStatus === 'no-face' ? colors.accentLight : colors.lightBg,
                borderRadius: '25px'
              }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: scanStatus === 'success' ? colors.success :
                             scanStatus === 'scanning' ? colors.warning :
                             scanStatus === 'no-face' ? colors.accent : colors.primary,
                  animation: scanStatus === 'scanning' ? 'pulse 1s infinite' : 'none'
                }} />
                <span style={{
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  color: scanStatus === 'success' ? colors.success :
                         scanStatus === 'scanning' ? colors.warning :
                         scanStatus === 'no-face' ? colors.accent : colors.primary
                }}>
                  {scanStatus === 'success' ? 'Face Detected / ตรวจพบใบหน้า' :
                   scanStatus === 'scanning' ? 'Scanning... / กำลังสแกน...' :
                   scanStatus === 'no-face' ? 'No Face / ไม่พบใบหน้า' :
                   'Ready to Scan / พร้อมใช้งาน'}
                </span>
              </div>
            </div>

            {/* Camera Container */}
            <div style={{
              position: 'relative',
              background: 'linear-gradient(145deg, #2C3E50 0%, #1A252F 100%)',
              borderRadius: '16px',
              overflow: 'hidden',
              aspectRatio: '4/3'
            }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)'
                }}
              />

              {/* Face Guide Overlay */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '260px',
                height: '320px',
                pointerEvents: 'none'
              }}>
                <svg width="100%" height="100%" viewBox="0 0 260 320">
                  <ellipse
                    cx="130"
                    cy="160"
                    rx="110"
                    ry="145"
                    fill="none"
                    stroke={scanStatus === 'success' ? colors.success :
                           scanStatus === 'scanning' ? colors.warning : colors.primary}
                    strokeWidth="3"
                    strokeDasharray={scanStatus === 'scanning' ? '10,5' : 'none'}
                  />
                  <path d="M 30 70 L 30 30 L 70 30" fill="none" stroke={colors.accent} strokeWidth="4" strokeLinecap="round"/>
                  <path d="M 230 70 L 230 30 L 190 30" fill="none" stroke={colors.accent} strokeWidth="4" strokeLinecap="round"/>
                  <path d="M 30 250 L 30 290 L 70 290" fill="none" stroke={colors.accent} strokeWidth="4" strokeLinecap="round"/>
                  <path d="M 230 250 L 230 290 L 190 290" fill="none" stroke={colors.accent} strokeWidth="4" strokeLinecap="round"/>
                </svg>
              </div>

              {/* Camera Off State */}
              {!isStreaming && (
                <div style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(145deg, #34495E 0%, #2C3E50 100%)'
                }}>
                  <svg width="70" height="70" viewBox="0 0 24 24" fill="#7F8C8D" style={{ marginBottom: '15px' }}>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-6c.78 2.34 2.72 4 5 4s4.22-1.66 5-4H7z"/>
                  </svg>
                  <p style={{ color: '#BDC3C7', fontSize: '1rem', margin: 0 }}>คลิกเริ่มต้นเพื่อเปิดกล้อง</p>
                </div>
              )}

            </div>

            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              {!isStreaming ? (
                <button
                  onClick={startCamera}
                  style={{
                    flex: 1,
                    padding: '14px 20px',
                    background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '1rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(21, 101, 192, 0.3)'
                  }}
                >
                  Start Camera / เริ่มต้น
                </button>
              ) : (
                <>
                  <button
                    onClick={captureAndAnalyze}
                    disabled={isAnalyzing}
                    style={{
                      flex: 1,
                      padding: '14px 20px',
                      background: isAnalyzing ? '#B0BEC5' : `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '1rem',
                      fontWeight: '600',
                      cursor: isAnalyzing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isAnalyzing ? 'Analyzing...' : 'Scan Now / สแกน'}
                  </button>
                  <button
                    onClick={() => setIsAutoCapture(!isAutoCapture)}
                    style={{
                      padding: '14px 18px',
                      background: isAutoCapture ? colors.warning : '#ECEFF1',
                      color: isAutoCapture ? 'white' : colors.textLight,
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    {isAutoCapture ? 'Stop' : 'Auto'}
                  </button>
                  <button
                    onClick={stopCamera}
                    style={{
                      padding: '14px 18px',
                      background: colors.accentLight,
                      color: colors.accent,
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Stop
                  </button>
                </>
              )}
            </div>

            {error && (
              <div style={{
                marginTop: '14px',
                padding: '12px 14px',
                background: colors.accentLight,
                borderRadius: '8px',
                color: colors.accent,
                fontSize: '0.9rem'
              }}>
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Side - Analysis Results */}
        <div style={{
          background: 'white',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
          borderTop: `4px solid ${colors.accent}`
        }}>
          <h2 style={{
            margin: '0 0 20px',
            fontSize: '1.1rem',
            color: colors.primary,
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={colors.primary}>
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
            Analysis Results / ผลการวิเคราะห์
          </h2>

          {!result?.success || !result.data ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: colors.textLight }}>
              <svg width="60" height="60" viewBox="0 0 24 24" fill="#E0E0E0" style={{ marginBottom: '15px' }}>
                <path d="M9 11.75c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
              </svg>
              <p style={{ margin: 0, fontSize: '0.95rem' }}>Scan face to see results</p>
              <p style={{ margin: '5px 0 0', fontSize: '0.85rem' }}>สแกนใบหน้าเพื่อดูผลวิเคราะห์</p>
            </div>
          ) : (
            <>
              {/* Depression Risk Score */}
              {depressionRisk && (
                <div style={{
                  background: depressionRisk.score > 50 ? colors.accentLight : colors.lightBg,
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '20px',
                  borderLeft: `4px solid ${depressionRisk.score > 50 ? colors.accent : colors.primary}`
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: '600', color: depressionRisk.score > 50 ? colors.accent : colors.primary }}>
                      Depression Risk Score
                    </span>
                    <span style={{
                      fontSize: '1.5rem',
                      fontWeight: '700',
                      color: depressionRisk.score > 50 ? colors.accent : colors.primary
                    }}>
                      {depressionRisk.score}%
                    </span>
                  </div>
                  <div style={{
                    height: '8px',
                    background: '#E0E0E0',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${depressionRisk.score}%`,
                      height: '100%',
                      background: depressionRisk.score > 50
                        ? `linear-gradient(90deg, ${colors.warning}, ${colors.accent})`
                        : `linear-gradient(90deg, ${colors.success}, ${colors.primary})`,
                      borderRadius: '4px',
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                  {depressionRisk.factors.length > 0 && (
                    <div style={{ marginTop: '10px', fontSize: '0.8rem', color: '#5D4037' }}>
                      <strong>ปัจจัย:</strong> {depressionRisk.factors.join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Head Pose Section */}
              {result.data.head_pose && (
                <ResultSection title="Head Pose / ท่าทางศีรษะ" color={colors.primary}>
                  <ResultBar label="Pitch (X) / ก้ม-เงย" value={result.data.head_pose.pitch} min={-45} max={45} unit="°" color={colors.primary} />
                  <ResultBar label="Yaw (Y) / หันซ้าย-ขวา" value={result.data.head_pose.yaw} min={-45} max={45} unit="°" color={colors.primary} />
                  <ResultBar label="Roll (Z) / เอียง" value={result.data.head_pose.roll} min={-45} max={45} unit="°" color={colors.primary} />
                </ResultSection>
              )}

              {/* Eye Analysis Section */}
              <ResultSection title="Eye Analysis / การวิเคราะห์ดวงตา" color={colors.primary}>
                <ResultBar label="Left Eye / ตาซ้าย" value={result.data.eye_analysis.left_eye_openness} min={0} max={1} unit="%" multiplier={100} color={colors.primary} />
                <ResultBar label="Right Eye / ตาขวา" value={result.data.eye_analysis.right_eye_openness} min={0} max={1} unit="%" multiplier={100} color={colors.primary} />
                <ResultBar label="Average / เฉลี่ย" value={result.data.eye_analysis.average_openness} min={0} max={1} unit="%" multiplier={100} color={colors.primaryDark} />
              </ResultSection>

              {/* Expression Section */}
              <ResultSection title="Expressions / การแสดงออก" color={colors.primary}>
                <ResultBar label="Smile / รอยยิ้ม" value={result.data.expressions.smile_probability} min={0} max={1} unit="%" multiplier={100} color={colors.success} />
              </ResultSection>

              {/* Action Units Section */}
              {result.data.action_units && (
                <ResultSection title="Action Units / หน่วยการเคลื่อนไหวใบหน้า" color={colors.primary} subtitle="Depression Indicators">
                  {Object.entries(result.data.action_units).map(([name, value]) => {
                    const auNumber = name.split(' - ')[0];
                    const auDesc = name.split(' - ')[1] || '';
                    const isDepression = ['AU04', 'AU15', 'AU01'].some(au => name.includes(au));
                    return (
                      <ResultBar
                        key={name}
                        label={auNumber}
                        sublabel={auDesc}
                        value={value}
                        min={0}
                        max={1}
                        unit="%"
                        multiplier={100}
                        color={isDepression && value > 0.4 ? colors.accent : colors.primary}
                        highlight={isDepression && value > 0.4}
                      />
                    );
                  })}
                </ResultSection>
              )}

              {/* Metadata */}
              <div style={{
                marginTop: '16px',
                padding: '12px 14px',
                background: colors.lightBg,
                borderRadius: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.85rem', color: colors.textLight }}>Landmarks Detected</span>
                <span style={{ fontSize: '1.1rem', fontWeight: '700', color: colors.primary }}>{result.data.landmarks_count}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* API Status */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        background: 'white',
        borderRadius: '25px',
        boxShadow: '0 2px 15px rgba(0,0,0,0.1)'
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: apiStatus === 'connected' ? colors.success : apiStatus === 'checking' ? colors.warning : colors.accent
        }} />
        <span style={{ fontSize: '0.8rem', color: colors.textLight }}>
          {apiStatus === 'connected' ? 'API Connected' : apiStatus === 'checking' ? 'Connecting...' : 'API Offline'}
        </span>
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb {
          background: #c1c1c1;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}

// Instruction Item Component
function InstructionItem({ icon, title, subtitle, color }: { icon: React.ReactNode; title: string; subtitle: string; color: string }) {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{
        width: '36px',
        height: '36px',
        background: '#E3F2FD',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}>
        {icon}
      </div>
      <div>
        <p style={{ margin: 0, fontWeight: '600', color: '#1A237E', fontSize: '0.95rem' }}>{title}</p>
        <p style={{ margin: '2px 0 0', color: '#546E7A', fontSize: '0.85rem' }}>{subtitle}</p>
      </div>
    </div>
  );
}

// Component for result sections
function ResultSection({ title, subtitle, color, children }: { title: string; subtitle?: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: color, fontWeight: '600' }}>{title}</h4>
        {subtitle && <span style={{ fontSize: '0.75rem', color: '#9E9E9E' }}>{subtitle}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {children}
      </div>
    </div>
  );
}

// Component for result bars
function ResultBar({
  label,
  sublabel,
  value,
  min,
  max,
  unit,
  multiplier = 1,
  color,
  highlight = false
}: {
  label: string;
  sublabel?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  multiplier?: number;
  color: string;
  highlight?: boolean;
}) {
  const normalizedValue = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const displayValue = (value * multiplier).toFixed(1);

  return (
    <div style={{
      padding: highlight ? '10px 12px' : '0',
      background: highlight ? 'rgba(227, 25, 55, 0.08)' : 'transparent',
      borderRadius: highlight ? '8px' : '0',
      borderLeft: highlight ? '3px solid #E31937' : 'none'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div>
          <span style={{ fontSize: '0.85rem', color: '#37474F', fontWeight: '500' }}>{label}</span>
          {sublabel && <span style={{ fontSize: '0.75rem', color: '#9E9E9E', marginLeft: '6px' }}>{sublabel}</span>}
        </div>
        <span style={{ fontSize: '0.9rem', fontWeight: '600', color: color }}>{displayValue}{unit}</span>
      </div>
      <div style={{
        height: '6px',
        background: '#ECEFF1',
        borderRadius: '3px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${normalizedValue}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${color}, ${color}dd)`,
          borderRadius: '3px',
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  );
}
