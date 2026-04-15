import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { auth } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import Login from './Login'
import Dashboard from './Dashboard'
import './App.css'

export default function App() {
	const [user, setUser] = useState(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
			setUser(currentUser)
			setLoading(false)
		})

		return unsubscribe
	}, [])

	if (loading) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
				<div className="text-center">
					<div className="animate-spin inline-block w-12 h-12 bg-gradient-to-r from-green-600 to-green-500 rounded-full"></div>
					<p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
				</div>
			</div>
		)
	}

	return (
		<Router>
			<Routes>
				<Route path="/login" element={<Login />} />
				<Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
				<Route path="/" element={user ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} />
			</Routes>
		</Router>
	)
}
