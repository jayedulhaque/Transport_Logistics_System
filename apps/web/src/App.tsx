import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
} from '@microsoft/signalr'
import { QRCodeSVG } from 'qrcode.react'
import { Check, LayoutDashboard, LogOut, MapPin, Users } from 'lucide-react'
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api'
import { apiFetch, getToken, signalrBase } from './api'

type PendingDriver = {
  id: number
  userId: number
  fullName: string
  phone: string
  vehicleNumber: string
  branchId: number | null
}

type LatLng = { driverProfileId: number; lat: number; lng: number }

function useAuth() {
  const token = getToken()
  return !!token
}

function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('admin')
  const [password, setPassword] = useState('Admin123!')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    })
    if (!res.ok) {
      setError('Invalid credentials')
      return
    }
    const data = await res.json()
    localStorage.setItem('transport_token', data.accessToken)
    localStorage.setItem('transport_role', data.role)
    navigate('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl"
      >
        <h1 className="mb-6 text-center text-2xl font-semibold text-white">
          Transport Admin
        </h1>
        <label className="mb-2 block text-sm text-slate-400">Phone / ID</label>
        <input
          className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="username"
        />
        <label className="mb-2 block text-sm text-slate-400">Password</label>
        <input
          type="password"
          className="mb-6 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-violet-600 py-2 font-medium text-white hover:bg-violet-500"
        >
          Sign in
        </button>
        <p className="mt-4 text-center text-xs text-slate-500">
          Default: admin / Admin123!
        </p>
      </form>
    </div>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const role = localStorage.getItem('transport_role')

  const logout = () => {
    localStorage.removeItem('transport_token')
    localStorage.removeItem('transport_role')
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="font-semibold text-white">Logistics Console</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link className="flex items-center gap-1 hover:text-violet-400" to="/">
            <Users size={16} /> Approvals
          </Link>
          <Link className="flex items-center gap-1 hover:text-violet-400" to="/map">
            <MapPin size={16} /> Live map
          </Link>
          <Link className="flex items-center gap-1 hover:text-violet-400" to="/qr">
            <LayoutDashboard size={16} /> QR label
          </Link>
          <span className="text-slate-500">({role})</span>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 text-slate-400 hover:text-white"
          >
            <LogOut size={16} /> Logout
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}

function ApprovalsPage() {
  const [rows, setRows] = useState<PendingDriver[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/drivers/pending')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (id: number) => {
    const res = await apiFetch(`/api/drivers/${id}/approve`, { method: 'PATCH' })
    if (res.ok) await load()
  }

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Pending driver approvals</h2>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{r.fullName}</td>
                <td className="px-4 py-3">{r.phone}</td>
                <td className="px-4 py-3">{r.vehicleNumber}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => void approve(r.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-500"
                  >
                    <Check size={16} /> Approve
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={4}>
                  No pending drivers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LiveMapPage() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  const [markers, setMarkers] = useState<LatLng[]>([])
  const [connection, setConnection] = useState<HubConnection | null>(null)

  useEffect(() => {
    const token = getToken()
    if (!token) return

    const hub = new HubConnectionBuilder()
      .withUrl(`${signalrBase()}/hubs/transport`, {
        accessTokenFactory: () => token ?? '',
      })
      .withAutomaticReconnect()
      .build()

    hub.on(
      'LocationUpdated',
      (driverProfileId: number, lat: number, lng: number) => {
        setMarkers((prev) => {
          const next = prev.filter((m) => m.driverProfileId !== driverProfileId)
          next.push({
            driverProfileId,
            lat: Number(lat),
            lng: Number(lng),
          })
          return next
        })
      }
    )

    void hub
      .start()
      .then(async () => {
        await hub.invoke('SubscribeLiveTracking')
        setConnection(hub)
      })
      .catch(console.error)

    return () => {
      void hub.stop()
    }
  }, [])

  const center = useMemo(() => {
    if (markers.length === 0) return { lat: 23.8103, lng: 90.4125 }
    const m = markers[markers.length - 1]
    return { lat: m.lat, lng: m.lng }
  }, [markers])

  const mapContainerStyle = useMemo(() => ({ width: '100%', height: '420px' }), [])

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Live driver map</h2>
      <p className="mb-4 text-sm text-slate-500">
        SignalR:{' '}
        {connection?.state === HubConnectionState.Connected ? (
          <span className="text-emerald-400">connected</span>
        ) : (
          <span className="text-amber-400">connecting…</span>
        )}
      </p>

      {apiKey ? (
        <LoadScript googleMapsApiKey={apiKey}>
          <GoogleMap mapContainerStyle={mapContainerStyle} zoom={12} center={center}>
            {markers.map((m) => (
              <Marker
                key={m.driverProfileId}
                position={{ lat: m.lat, lng: m.lng }}
                label={`#${m.driverProfileId}`}
              />
            ))}
          </GoogleMap>
        </LoadScript>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-slate-400">
          Set <code className="text-violet-300">VITE_GOOGLE_MAPS_API_KEY</code> for map tiles.
          Latest positions:
          <ul className="mt-4 list-inside list-disc text-sm">
            {markers.map((m) => (
              <li key={m.driverProfileId}>
                Driver #{m.driverProfileId}: {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
              </li>
            ))}
            {markers.length === 0 && <li>No updates yet.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function QrLabelPage() {
  const [tracking, setTracking] = useState('TN-DEMO0000000001')
  const [desc, setDesc] = useState('')
  const [destBranchId, setDestBranchId] = useState(1)
  const [created, setCreated] = useState<string | null>(null)

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await apiFetch('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        description: desc || 'Parcel',
        senderName: 'Sender',
        senderPhone: '000',
        senderAddress: 'Origin',
        receiverName: 'Receiver',
        receiverPhone: '000',
        receiverAddress: 'Destination',
        destinationBranchId: destBranchId,
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    setCreated(data.trackingNumber)
    setTracking(data.trackingNumber)
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">QR shipping label</h2>
      <p className="mb-6 text-sm text-slate-400">
        Tracking numbers are generated by the API; QR encodes the tracking string only.
      </p>

      <form
        onSubmit={createProduct}
        className="mb-8 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <label className="text-sm text-slate-400">Description</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Item details"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400">Destination branch id</label>
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={destBranchId}
            onChange={(e) => setDestBranchId(Number(e.target.value))}
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500"
          >
            Create product (staff)
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-start gap-8">
        <div className="rounded-2xl bg-white p-6 text-black shadow-xl">
          <QRCodeSVG value={tracking} size={192} />
        </div>
        <div>
          <label className="text-sm text-slate-400">Preview tracking #</label>
          <input
            className="mt-1 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
          />
          {created && (
            <p className="mt-2 text-sm text-emerald-400">Created: {created}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function HomePage() {
  const role = localStorage.getItem('transport_role')
  if (role === 'Admin') return <ApprovalsPage />
  return <Navigate to="/map" replace />
}

function DashboardRoutes() {
  if (!useAuth()) return <Navigate to="/login" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<LiveMapPage />} />
        <Route path="/qr" element={<QrLabelPage />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<DashboardRoutes />} />
      </Routes>
    </BrowserRouter>
  )
}
