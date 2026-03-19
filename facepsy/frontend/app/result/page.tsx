import React from 'react';

const mockData = {
  AU04: 75, // Brow Lowerer
  AU15: 60, // Lip Corner Depressor
  AU12: 20, // Smiling
  pitch: -15 // Head Pose in degrees
};

function calculateScore(data: typeof mockData): number {
  // Logic: weight AU15 40%, AU04 40%, AU12 10%, pitch influence 10%
  const baseScore = (data.AU15 * 0.4) + (data.AU04 * 0.4) + (data.AU12 * 0.1);
  const pitchInfluence = Math.min(Math.abs(data.pitch) / 90 * 10, 10); // max 10
  const totalScore = Math.min(baseScore + pitchInfluence, 100);
  return Math.round(totalScore);
}

function getRiskLevel(score: number) {
  if (score <= 33) return { level: 'Low Risk', color: 'green' };
  if (score <= 66) return { level: 'Moderate', color: 'yellow' };
  return { level: 'High Risk', color: 'red' };
}

export default function ResultPage() {
  const score = calculateScore(mockData);
  const risk = getRiskLevel(score);
  const pitchText = mockData.pitch < 0 ? 'ก้มหน้า' : 'หน้าตรง';

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {/* Top Section: Gauge Chart */}
      <div className="flex justify-center mb-8">
        <div className="relative w-64 h-64">
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" stroke="#e5e7eb" strokeWidth="10" fill="none" />
            <circle cx="50" cy="50" r="45" stroke={`var(--color-${risk.color})`} strokeWidth="10" fill="none" strokeDasharray={`${score * 2.83} 283`} strokeLinecap="round" transform="rotate(-90 50 50)" />
            <text x="50" y="45" textAnchor="middle" className="text-2xl font-bold">{score}</text>
            <text x="50" y="60" textAnchor="middle" className="text-lg">{risk.level}</text>
          </svg>
        </div>
      </div>

      {/* Middle Section: AU Indicators */}
      <div className="max-w-md mx-auto mb-8">
        <h2 className="text-xl font-semibold mb-4">AU Indicators</h2>
        <div className="space-y-4">
          <div>
            <label className="block mb-2">AU04 (Brow Lowerer): {mockData.AU04}%</label>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div className="bg-blue-600 h-4 rounded-full" style={{width: `${mockData.AU04}%`}}></div>
            </div>
          </div>
          <div>
            <label className="block mb-2">AU15 (Lip Corner Depressor): {mockData.AU15}%</label>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div className="bg-blue-600 h-4 rounded-full" style={{width: `${mockData.AU15}%`}}></div>
            </div>
          </div>
          <div>
            <label className="block mb-2">AU12 (Smiling): {mockData.AU12}%</label>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div className="bg-blue-600 h-4 rounded-full" style={{width: `${mockData.AU12}%`}}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Pose Analysis */}
      <div className="max-w-md mx-auto mb-8">
        <h2 className="text-xl font-semibold mb-4">วิเคราะห์ท่าทาง</h2>
        <p>Pitch: {mockData.pitch}° - {pitchText}</p>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center space-x-4 mb-8">
        <button className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600" onClick={() => alert('Download Report')}>Download Report</button>
        <button className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600" onClick={() => alert('Consult Specialist')}>Consult Specialist</button>
      </div>

      {/* Disclaimer */}
      <div className="text-center text-sm text-gray-600">
        ผลลัพธ์นี้ไม่ใช่การวินิจฉัยทางการแพทย์
      </div>
    </div>
  );
}