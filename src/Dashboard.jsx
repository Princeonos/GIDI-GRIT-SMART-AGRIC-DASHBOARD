import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, auth } from './firebase'
import { ref as dbRef, onValue, update, serverTimestamp, push, get } from 'firebase/database'
import { signOut } from 'firebase/auth'
import { utils as XLSXUtils, writeFile } from 'xlsx'
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	ResponsiveContainer,
} from 'recharts'
import { Droplet, Thermometer, Cloud, Zap, LogOut, Download, Menu, X } from 'lucide-react'
import './App.css'

function fmtTime(ts) {
	try {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	} catch (e) {
		return '--'
	}
}

export default function Dashboard() {
		const [reading, setReading] = useState({})
		const [history, setHistory] = useState([])
		const [isWatering, setIsWatering] = useState(false)
		const [isAutoPipe, setIsAutoPipe] = useState(false)
		const [tempThreshold, setTempThreshold] = useState(35)
		const [exportLoading, setExportLoading] = useState(false)
		const [menuOpen, setMenuOpen] = useState(false)
	const mounted = useRef(false)
		const lastAutoAction = useRef(0)
		const lastResearchLog = useRef(0)
		const navigate = useNavigate()

	useEffect(() => {
		mounted.current = true
		const nodeRef = dbRef(db, 'field_readings/node_01')

		const unsub = onValue(nodeRef, (snap) => {
			const data = snap.val()
			if (!data) return

			setReading(data)
			setIsWatering(Boolean(data.isWatering))

			setHistory((prev) => {
				const next = prev.length ? prev.slice() : []
				next.push({ time: data.lastUpdated || Date.now(), moisture: Number(data.soilMoisture ?? data.soil_moisture ?? 0) })
				if (next.length > 60) next.shift()
				return next
			})
		})

		return () => {
			mounted.current = false
			try {
				unsub()
			} catch (e) {
				// ignore
			}
		}
	}, [])

	async function handleToggle() {
		const newVal = !isWatering
		setIsWatering(newVal)
		try {
			await update(dbRef(db, 'field_readings/node_01'), { isWatering: newVal, lastUpdated: serverTimestamp() })
		} catch (err) {
			console.error(err)
		}
	}

	const handleLogout = async () => {
		try {
			await signOut(auth)
			navigate('/login')
		} catch (error) {
			console.error('Logout error:', error)
		}
	}

	// Data Logging: Push sensor data to research_logs every 15 minutes
	useEffect(() => {
		if (!mounted.current || !reading.soilMoisture) return

		const logData = async () => {
			const now = Date.now()
			// Check if 15 minutes (900000ms) have passed since last log
			if (now - lastResearchLog.current < 900000) return

			try {
				const logEntry = {
					timestamp: serverTimestamp(),
					moisture: Number(reading.soilMoisture ?? reading.soil_moisture ?? 0),
					temperature: Number(reading.temperature ?? 0),
					humidity: Number(reading.humidity ?? 0),
					isWatering: Boolean(reading.isWatering),
				}

				await push(dbRef(db, 'research_logs'), logEntry)
				lastResearchLog.current = now
				console.log('Research data logged to Firebase')
			} catch (err) {
				console.error('Failed to log research data:', err)
			}
		}

		logData()

		// Also set up an interval to check every minute if we need to log
		const interval = setInterval(logData, 60000)
		return () => clearInterval(interval)
	}, [reading])

	// Excel Export: Download research logs from Firebase as Excel file
	const handleExportData = async () => {
		setExportLoading(true)
		try {
			const logsRef = dbRef(db, 'research_logs')
			const snapshot = await get(logsRef)

			if (!snapshot.exists()) {
				alert('No research data available to export')
				setExportLoading(false)
				return
			}

			// Transform Firebase data into array format
			const logsData = snapshot.val()
			const exportArray = Object.entries(logsData).map(([key, value]) => ({
				'Log ID': key,
				'Timestamp': value.timestamp ? new Date(value.timestamp).toLocaleString() : 'N/A',
				'Soil Moisture (%)': value.moisture?.toFixed(2) ?? 'N/A',
				'Temperature (°C)': value.temperature?.toFixed(2) ?? 'N/A',
				'Humidity (%)': value.humidity?.toFixed(2) ?? 'N/A',
				'Irrigation Status': value.isWatering ? 'Active' : 'Inactive',
			}))

			// Create workbook and worksheet
			const workbook = XLSXUtils.book_new()
			const worksheet = XLSXUtils.json_to_sheet(exportArray)

			// Add some formatting
			worksheet['!cols'] = [
				{ wch: 15 },
				{ wch: 20 },
				{ wch: 18 },
				{ wch: 18 },
				{ wch: 15 },
				{ wch: 18 },
			]

			XLSXUtils.book_append_sheet(workbook, worksheet, 'Research Data')

			// Generate filename with current date
			const currentDate = new Date().toISOString().split('T')[0]
			const filename = `Gidi_GRIT_Farm_Research_Report_${currentDate}.xlsx`

			// Write file to download
			writeFile(workbook, filename)
			console.log(`Excel file "${filename}" downloaded successfully`)
		} catch (err) {
			console.error('Failed to export data:', err)
			alert('Failed to export research data. Please try again.')
		} finally {
			setExportLoading(false)
		}
	}


		// Auto-Pipe logic: when enabled, automatically set isWatering based on temperature threshold.
		useEffect(() => {
			// guard: only run when we have a valid numeric temperature
			const t = Number(reading.temperature ?? 0)
			if (!isAutoPipe) return

			// throttle auto actions to avoid rapid writes (15s)
			const now = Date.now()
			if (now - lastAutoAction.current < 15000) return

			// If temp is above threshold and not watering -> start watering
			if (Number.isFinite(t) && t > Number(tempThreshold) && !isWatering) {
				lastAutoAction.current = now
				;(async () => {
					try {
						await update(dbRef(db, 'field_readings/node_01'), { isWatering: true, lastUpdated: serverTimestamp() })
					} catch (e) {
						console.error('Auto-Pipe failed to enable watering', e)
					}
				})()
				return
			}

			// If temp is below or equal threshold and currently watering -> stop watering
			if (Number.isFinite(t) && t <= Number(tempThreshold) && isWatering) {
				lastAutoAction.current = now
				;(async () => {
					try {
						await update(dbRef(db, 'field_readings/node_01'), { isWatering: false, lastUpdated: serverTimestamp() })
					} catch (e) {
						console.error('Auto-Pipe failed to disable watering', e)
					}
				})()
			}
		}, [isAutoPipe, tempThreshold, reading.temperature, isWatering])

	const soil = Number(reading.soilMoisture ?? reading.soil_moisture ?? 0)
	const temp = Number(reading.temperature ?? 0)
	const humidity = Number(reading.humidity ?? 0)
	const lastUpdated = reading.lastUpdated ? new Date(reading.lastUpdated) : null

	// Mobile-first layout using Tailwind classes
	return (
		<div className="min-h-screen bg-slate-900 text-slate-100 p-2 sm:p-4 md:p-6">
			<div className="w-full max-w-6xl mx-auto">
				{/* Header */}
				<header className="mb-6">
					{/* Top bar - Logo and hamburger */}
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<div className="text-2xl md:text-3xl font-extrabold">Gidi Grit</div>
							<div className="hidden sm:block text-xs md:text-sm text-slate-400">Precision Farming</div>
						</div>

						{/* Hamburger menu button - visible on mobile/tablet */}
						<button
							onClick={() => setMenuOpen(!menuOpen)}
							className="lg:hidden inline-flex items-center gap-2 p-2 rounded-lg bg-slate-800/30 hover:bg-slate-800/50 transition"
							aria-label="Toggle menu"
						>
							{menuOpen ? <X size={20} /> : <Menu size={20} />}
						</button>

						{/* Desktop status indicator */}
						<div className="hidden lg:flex items-center gap-2 bg-slate-800/40 px-3 py-1 rounded-full">
							<Cloud size={16} className="text-green-400" />
							<span className="text-sm text-green-300 font-medium">Cloud Connected</span>
						</div>
					</div>

					{/* Desktop navigation - always visible on large screens */}
					<nav className="hidden lg:flex flex-wrap items-center gap-2 md:gap-3">
						{/* Auto-Pipe toggle */}
						<label className="inline-flex items-center gap-2 bg-slate-800/30 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition">
							<input
								type="checkbox"
								checked={isAutoPipe}
								onChange={() => setIsAutoPipe((v) => !v)}
								className="w-4 h-4"
								aria-label="Enable Auto-Pipe Mode"
							/>
							<span className="text-xs md:text-sm whitespace-nowrap">Auto-Pipe</span>
						</label>

						{/* Temp threshold */}
						<label className="inline-flex items-center gap-2 bg-slate-800/30 px-3 py-2 rounded-lg">
							<span className="text-xs md:text-sm text-slate-300 whitespace-nowrap">Threshold:</span>
							<input
								type="number"
								value={tempThreshold}
								onChange={(e) => setTempThreshold(Number(e.target.value))}
								className="w-12 bg-transparent text-right text-xs md:text-sm"
								min={0}
								step={1}
								aria-label="Temperature Threshold"
							/>
							<span className="text-xs text-slate-400">°C</span>
						</label>

						{/* Manual irrigation button */}
						<button
							onClick={handleToggle}
							className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/30 hover:bg-amber-900/50 transition"
							title="Toggle manual irrigation"
						>
							<Zap size={16} className={isWatering ? 'text-amber-300' : 'text-slate-400'} />
							<span className="text-xs md:text-sm font-medium">{isWatering ? 'Irrigating' : 'Irrigate'}</span>
						</button>

						{/* Export button */}
						<button
							onClick={handleExportData}
							disabled={exportLoading}
							className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/30 hover:bg-blue-900/50 transition disabled:opacity-50"
							title="Download research data"
						>
							<Download size={16} />
							<span className="text-xs md:text-sm font-medium">{exportLoading ? 'Exporting...' : 'Export'}</span>
						</button>

						{/* Pipe status */}
						<div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${isWatering ? 'bg-emerald-900/40' : 'bg-slate-800/30'}`}>
							<span style={{ fontSize: 14 }}>🚰</span>
							<span className={`text-xs md:text-sm font-medium ${isWatering ? 'text-emerald-200' : 'text-slate-400'}`}>
								{isWatering ? 'Active' : 'Idle'}
							</span>
						</div>

						{/* Logout button */}
						<button
							onClick={handleLogout}
							className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 hover:bg-red-900/50 transition"
						>
							<LogOut size={16} />
							<span className="text-xs md:text-sm font-medium">Logout</span>
						</button>
					</nav>

					{/* Mobile/Tablet navigation - collapsible menu */}
					{menuOpen && (
						<nav className="lg:hidden flex flex-col gap-2 bg-slate-800/40 p-3 rounded-lg">
							{/* Cloud status on mobile */}
							<div className="flex lg:hidden items-center gap-2 bg-slate-800/40 px-3 py-2 rounded">
								<Cloud size={14} className="text-green-400" />
								<span className="text-xs text-green-300 font-medium">Cloud Connected</span>
							</div>

							{/* Auto-Pipe toggle */}
							<label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-700/30 rounded transition">
								<input
									type="checkbox"
									checked={isAutoPipe}
									onChange={() => setIsAutoPipe((v) => !v)}
									className="w-4 h-4"
								/>
								<span className="text-sm">Auto-Pipe Mode</span>
							</label>

							{/* Temp threshold - more spaced on mobile */}
							<label className="flex items-center gap-3 px-3 py-2 hover:bg-slate-700/30 rounded">
								<span className="text-sm text-slate-300 flex-shrink-0">Temp Threshold:</span>
								<div className="flex items-center gap-1">
									<input
										type="number"
										value={tempThreshold}
										onChange={(e) => setTempThreshold(Number(e.target.value))}
										className="w-16 bg-slate-700 text-center text-sm px-2 py-1 rounded"
										min={0}
										step={1}
									/>
									<span className="text-sm text-slate-400">°C</span>
								</div>
							</label>

							{/* Manual irrigation button */}
							<button
								onClick={handleToggle}
								className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/30 hover:bg-amber-900/50 transition w-full"
							>
								<Zap size={16} className={isWatering ? 'text-amber-300' : 'text-slate-400'} />
								<span className="text-sm font-medium">{isWatering ? 'Stop Irrigation' : 'Start Irrigation'}</span>
							</button>

							{/* Pipe status */}
							<div className={`flex items-center gap-2 px-3 py-2 rounded ${isWatering ? 'bg-emerald-900/40' : 'bg-slate-800/30'}`}>
								<span style={{ fontSize: 16 }}>🚰</span>
								<span className={`text-sm font-medium ${isWatering ? 'text-emerald-200' : 'text-slate-400'}`}>
									Pipe: {isWatering ? 'Active' : 'Idle'}
								</span>
							</div>

							{/* Export button */}
							<button
								onClick={handleExportData}
								disabled={exportLoading}
								className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/30 hover:bg-blue-900/50 transition disabled:opacity-50 w-full"
							>
								<Download size={16} />
								<span className="text-sm font-medium">{exportLoading ? 'Exporting...' : 'Download Research Data'}</span>
							</button>

							{/* Logout button */}
							<button
								onClick={handleLogout}
								className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 hover:bg-red-900/50 transition w-full"
							>
								<LogOut size={16} />
								<span className="text-sm font-medium">Logout</span>
							</button>
						</nav>
					)}
				</header>

				{/* Main content - mobile-first single column */}
				<main className="space-y-4">
					{/* Key metric: Soil Moisture - full width on all screens */}
					<div className={`p-4 rounded-xl glass ${soil < 30 ? 'glow-red' : ''}`}>
						<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
							<div className="flex items-center gap-3 w-full sm:w-auto">
								<Droplet size={24} className="text-cyan-300 flex-shrink-0" />
								<div>
									<div className="text-xs md:text-sm text-slate-300">Soil Moisture</div>
									<div className="text-3xl md:text-4xl lg:text-5xl font-extrabold">{Number.isFinite(soil) ? `${soil}%` : '--'}</div>
								</div>
							</div>
							<div className="text-xs md:text-sm text-slate-400 whitespace-nowrap">
								{lastUpdated ? lastUpdated.toLocaleString() : '--'}
							</div>
						</div>
						{soil < 30 && <div className="mt-3 text-sm text-rose-200">⚠️ Low moisture — irrigation recommended</div>}
					</div>

					{/* Responsive grid - 1 col mobile, 2 col tablet, 3-4 col desktop */}
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
						{/* Temperature */}
						<div className="p-4 rounded-xl glass">
							<div className="flex items-start gap-3">
								<Thermometer size={20} className="text-amber-300 flex-shrink-0 mt-1" />
								<div className="w-full">
									<div className="text-xs md:text-sm text-slate-300">Temperature</div>
									<div className="text-2xl md:text-3xl lg:text-4xl font-bold mt-1">
										{Number.isFinite(temp) ? `${temp}°` : '--'}
									</div>
									<div className="text-xs text-slate-500 mt-2">Celsius</div>
								</div>
							</div>
						</div>

						{/* Humidity */}
						<div className="p-4 rounded-xl glass">
							<div className="flex items-start gap-3">
								<Droplet size={20} className="text-sky-300 flex-shrink-0 mt-1" />
								<div className="w-full">
									<div className="text-xs md:text-sm text-slate-300">Humidity</div>
									<div className="text-2xl md:text-3xl lg:text-4xl font-bold mt-1">
										{Number.isFinite(humidity) ? `${humidity}%` : '--'}
									</div>
									<div className="text-xs text-slate-500 mt-2">Relative</div>
								</div>
							</div>
						</div>

						{/* Status */}
						<div className="p-4 rounded-xl glass">
							<div className="flex items-start gap-3">
								<Cloud size={20} className="text-green-400 flex-shrink-0 mt-1" />
								<div className="w-full">
									<div className="text-xs md:text-sm text-slate-300">Status</div>
									<div className="text-sm md:text-base font-bold mt-1">
										{isWatering ? '💧 Irrigating' : '✓ Idle'}
									</div>
									<div className="text-xs text-slate-500 mt-2">
										{isAutoPipe ? 'Auto Mode' : 'Manual'}
									</div>
								</div>
							</div>
						</div>

						{/* Last Updated */}
						<div className="p-4 rounded-xl glass">
							<div className="flex items-start gap-3">
								<Zap size={20} className="text-green-400 flex-shrink-0 mt-1" />
								<div className="w-full">
									<div className="text-xs md:text-sm text-slate-300">Updated</div>
									<div className="text-sm font-bold mt-2 text-green-300">
										{lastUpdated ? lastUpdated.toLocaleTimeString() : '--'}
									</div>
									<div className="text-xs text-slate-500 mt-1">
										{lastUpdated ? lastUpdated.toLocaleDateString() : '--'}
									</div>
								</div>
							</div>
						</div>
					</div>

					{/* Chart - responsive area chart with gradient */}
					<div className="p-3 md:p-4 rounded-xl glass w-full overflow-hidden">
						<div className="text-sm md:text-base text-slate-300 mb-3 font-semibold">📊 Soil Moisture History</div>
						<div className="w-full overflow-x-auto -mx-3 md:-mx-4 px-3 md:px-4">
							<div style={{ width: '100%', height: 280, minWidth: 300 }}>
								<ResponsiveContainer width="100%" height="100%">
									<AreaChart data={history.map((h) => ({ ...h, label: fmtTime(h.time) }))}>
										<defs>
											<linearGradient id="moistureGradient" x1="0" y1="0" x2="0" y2="1">
												<stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8} />
												<stop offset="95%" stopColor="#06b6d4" stopOpacity={0.08} />
											</linearGradient>
										</defs>
										<CartesianGrid strokeDasharray="3 3" opacity={0.06} />
										<XAxis 
											dataKey="label" 
											tick={{ fill: '#94a3b8', fontSize: 12 }} 
											minTickGap={40}
										/>
										<YAxis 
											domain={[0, 100]} 
											tick={{ fill: '#94a3b8', fontSize: 12 }} 
											width={40}
										/>
										<Tooltip 
											contentStyle={{ background: '#0f1724', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }} 
											labelFormatter={(l) => `Time: ${l}`}
											formatter={(value) => [`${value.toFixed(1)}%`, 'Moisture']}
										/>
										<Area 
											type="monotone" 
											dataKey="moisture" 
											stroke="#06b6d4" 
											fillOpacity={1} 
											fill="url(#moistureGradient)" 
										/>
									</AreaChart>
								</ResponsiveContainer>
							</div>
						</div>
					</div>
				</main>

				<footer className="mt-8 pt-4 border-t border-slate-700 text-center text-xs md:text-sm text-slate-500">
					<p>🌾 Gidi GRIT Smart Agriculture Dashboard</p>
					<p className="mt-1 text-slate-600">Connected to Firebase RTDB — <code className="text-slate-500">field_readings/node_01</code></p>
				</footer>
			</div>
		</div>
	)
}
