import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
} from '@microsoft/signalr'
import { QRCodeSVG } from 'qrcode.react'
import {
  Building2,
  Check,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Printer,
  Trash2,
  Users,
} from 'lucide-react'
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

type Branch = {
  id: number
  branchName: string
  code: string
  address: string
}

type ProductRow = {
  id: string
  trackingNumber: string
  description: string
  senderName: string
  senderPhone: string
  senderAddress: string
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  originBranchId: number
  destinationBranchId: number
  originBranchName: string
  destinationBranchName: string
  shippingPrice: number
  status: string
  createdAt: string
}

function ShippingLabelBlock({
  tracking,
  shippingPrice,
}: {
  tracking: string
  shippingPrice: number | null
}) {
  return (
    <div className="print-label-area flex flex-col items-center rounded-2xl bg-white p-6 text-black shadow-xl">
      <QRCodeSVG value={tracking} size={192} />
      <p className="mt-3 font-mono text-sm tracking-wide">{tracking}</p>
      {shippingPrice !== null && Number.isFinite(shippingPrice) && (
        <p className="mt-1 text-base font-medium text-neutral-800">
          Shipping: {shippingPrice.toFixed(2)}
        </p>
      )}
    </div>
  )
}

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
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {role === 'Admin' && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/">
              <Users size={16} /> Approvals
            </Link>
          )}
          <Link className="flex items-center gap-1 hover:text-violet-400" to="/map">
            <MapPin size={16} /> Live map
          </Link>
          {role === 'Admin' && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/branches">
              <Building2 size={16} /> Branches
            </Link>
          )}
          {role === 'Admin' && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/products">
              <Package size={16} /> Products
            </Link>
          )}
          {role === 'Admin' && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/qr">
              <LayoutDashboard size={16} /> New product
            </Link>
          )}
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

function BranchesPage() {
  const role = localStorage.getItem('transport_role')
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [formName, setFormName] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/branches')
    if (res.ok) setBranches(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (role !== 'Admin') return
    void load()
  }, [load, role])

  if (role !== 'Admin') {
    return <Navigate to="/map" replace />
  }

  const resetForm = () => {
    setFormName('')
    setFormCode('')
    setFormAddress('')
    setEditingId(null)
    setError(null)
  }

  const startEdit = (b: Branch) => {
    setEditingId(b.id)
    setFormName(b.branchName)
    setFormCode(b.code)
    setFormAddress(b.address)
    setError(null)
  }

  const saveBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const body = JSON.stringify({
      branchName: formName,
      code: formCode,
      address: formAddress,
    })
    const res = editingId
      ? await apiFetch(`/api/branches/${editingId}`, { method: 'PUT', body })
      : await apiFetch('/api/branches', { method: 'POST', body })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(
        (j as { error?: string }).error ??
          (res.status === 409
            ? 'Code already in use'
            : 'Could not save branch')
      )
      return
    }
    resetForm()
    await load()
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this branch? This cannot be undone if allowed.')) return
    setError(null)
    const res = await apiFetch(`/api/branches/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not delete branch')
      return
    }
    if (editingId === id) resetForm()
    await load()
  }

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Branches</h2>
      <p className="mb-6 text-sm text-slate-400">
        Create and manage branch locations. Branch codes must be unique.
      </p>

      <form
        onSubmit={saveBranch}
        className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h3 className="mb-4 text-sm font-medium text-slate-300">
          {editingId ? 'Edit branch' : 'Add branch'}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm text-slate-400">Branch name</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Code</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm text-slate-400">Address</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
              required
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Update branch' : 'Create branch'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{b.branchName}</td>
                <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                <td className="px-4 py-3 text-slate-300">{b.address}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => startEdit(b)}
                    className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(b.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-950/40"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {branches.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={4}>
                  No branches yet.
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

function ProductsPage() {
  const role = localStorage.getItem('transport_role')
  const location = useLocation()
  const navigate = useNavigate()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [reprint, setReprint] = useState<{
    trackingNumber: string
    shippingPrice: number
  } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [pr, br] = await Promise.all([
      apiFetch('/api/products'),
      apiFetch('/api/branches'),
    ])
    if (pr.ok) setProducts(await pr.json())
    if (br.ok) setBranches(await br.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (role !== 'Admin') return
    void load()
  }, [load, role])

  useEffect(() => {
    const s = location.state as { openLabel?: { trackingNumber: string; shippingPrice: number } } | null
    if (s?.openLabel) {
      setReprint(s.openLabel)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.pathname, location.state, navigate])

  if (role !== 'Admin') {
    return <Navigate to="/map" replace />
  }

  const remove = async (p: ProductRow) => {
    if (
      !window.confirm(
        `Delete product ${p.trackingNumber}? This cannot be undone if allowed by the server.`
      )
    )
      return
    setFormError(null)
    const res = await apiFetch(`/api/products/${p.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setFormError((j as { error?: string }).error ?? 'Could not delete')
      return
    }
    await load()
    if (editing?.id === p.id) setEditing(null)
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setFormError(null)
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    const price = Number(fd.get('shippingPrice'))
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Enter a valid shipping price.')
      return
    }
    const body = {
      description: String(fd.get('description') ?? '').trim() || 'Parcel',
      senderName: String(fd.get('senderName') ?? '').trim(),
      senderPhone: String(fd.get('senderPhone') ?? '').trim(),
      senderAddress: String(fd.get('senderAddress') ?? '').trim(),
      receiverName: String(fd.get('receiverName') ?? '').trim(),
      receiverPhone: String(fd.get('receiverPhone') ?? '').trim(),
      receiverAddress: String(fd.get('receiverAddress') ?? '').trim(),
      originBranchId: Number(fd.get('originBranchId')),
      destinationBranchId: Number(fd.get('destinationBranchId')),
      shippingPrice: price,
    }
    setSaving(true)
    const res = await apiFetch(`/api/products/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setFormError((j as { error?: string }).error ?? 'Could not save')
      return
    }
    setEditing(null)
    await load()
  }

  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.branchName} ({b.code})
    </option>
  ))

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Products</h2>
          <p className="mt-1 text-sm text-slate-400">
            View, edit, or delete shipments. Reprint the shipping label QR anytime. Products on an
            active trip cannot be deleted.
          </p>
        </div>
        <Link
          to="/qr"
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500"
        >
          New product
        </Link>
      </div>

      {formError && (
        <p className="no-print mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {formError}
        </p>
      )}

      <div className="no-print overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-3">Tracking</th>
              <th className="px-3 py-3">Description</th>
              <th className="px-3 py-3">Route</th>
              <th className="px-3 py-3">Price</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-white">{p.trackingNumber}</td>
                <td className="max-w-[140px] truncate px-3 py-2 text-slate-300" title={p.description}>
                  {p.description}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">
                  {p.originBranchName} → {p.destinationBranchName}
                </td>
                <td className="px-3 py-2 text-slate-300">{p.shippingPrice.toFixed(2)}</td>
                <td className="px-3 py-2 text-slate-400">{p.status}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null)
                      setReprint({ trackingNumber: p.trackingNumber, shippingPrice: p.shippingPrice })
                    }}
                    className="mr-1 inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Printer size={12} /> QR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null)
                      setEditing(p)
                    }}
                    className="mr-1 inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(p)}
                    className="inline-flex items-center gap-1 rounded border border-red-900/40 px-2 py-1 text-xs text-red-400 hover:bg-red-950/30"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                  No products yet. Use <Link className="text-violet-400 hover:underline" to="/qr">New product</Link> to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 print:bg-transparent print:p-0">
          <div className="max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl print:border-0 print:bg-transparent print:shadow-none">
            <div className="no-print mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-medium text-white">Shipping label</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-200"
                >
                  <Printer size={16} /> Print
                </button>
                <button
                  type="button"
                  onClick={() => setReprint(null)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex justify-center">
              <ShippingLabelBlock
                tracking={reprint.trackingNumber}
                shippingPrice={reprint.shippingPrice}
              />
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 no-print">
          <form
            onSubmit={saveEdit}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <h3 className="mb-4 text-lg font-medium text-white">Edit product</h3>
            <div className="grid gap-3">
              <div className="md:col-span-2">
                <label className="text-sm text-slate-400">Description</label>
                <input
                  name="description"
                  defaultValue={editing.description}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Sender name</label>
                <input
                  name="senderName"
                  defaultValue={editing.senderName}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Sender phone</label>
                <input
                  name="senderPhone"
                  defaultValue={editing.senderPhone}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm text-slate-400">Sender address</label>
                <input
                  name="senderAddress"
                  defaultValue={editing.senderAddress}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Receiver name</label>
                <input
                  name="receiverName"
                  defaultValue={editing.receiverName}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Receiver phone</label>
                <input
                  name="receiverPhone"
                  defaultValue={editing.receiverPhone}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm text-slate-400">Receiver address</label>
                <input
                  name="receiverAddress"
                  defaultValue={editing.receiverAddress}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Origin branch</label>
                <select
                  name="originBranchId"
                  defaultValue={editing.originBranchId}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                >
                  {branchOptions}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-400">Destination branch</label>
                <select
                  name="destinationBranchId"
                  defaultValue={editing.destinationBranchId}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                >
                  {branchOptions}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-400">Shipping price</label>
                <input
                  name="shippingPrice"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={editing.shippingPrice}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
            </div>
            {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
            <p className="mt-3 font-mono text-xs text-slate-500">Tracking: {editing.trackingNumber}</p>
          </form>
        </div>
      )}
    </div>
  )
}

function QrLabelPage() {
  const role = localStorage.getItem('transport_role')
  const [branches, setBranches] = useState<Branch[]>([])
  const [desc, setDesc] = useState('')
  const [senderName, setSenderName] = useState('')
  const [senderPhone, setSenderPhone] = useState('')
  const [senderAddress, setSenderAddress] = useState('')
  const [receiverName, setReceiverName] = useState('')
  const [receiverPhone, setReceiverPhone] = useState('')
  const [receiverAddress, setReceiverAddress] = useState('')
  const [originBranchId, setOriginBranchId] = useState(0)
  const [destinationBranchId, setDestinationBranchId] = useState(0)
  const [shippingPrice, setShippingPrice] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (role !== 'Admin') return
    void (async () => {
      const res = await apiFetch('/api/branches')
      if (!res.ok) return
      const list: Branch[] = await res.json()
      setBranches(list)
      if (list.length > 0) {
        setOriginBranchId(list[0].id)
        setDestinationBranchId(list[Math.min(1, list.length - 1)].id)
      }
    })()
  }, [role])

  if (role !== 'Admin') {
    return <Navigate to="/map" replace />
  }

  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.branchName} ({b.code})
    </option>
  ))

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const price = Number(shippingPrice)
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Enter a valid shipping price (0 or greater).')
      return
    }
    if (!originBranchId || !destinationBranchId) {
      setFormError('Select origin and destination branches.')
      return
    }
    setSubmitting(true)
    const res = await apiFetch('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        description: desc.trim() || 'Parcel',
        senderName: senderName.trim(),
        senderPhone: senderPhone.trim(),
        senderAddress: senderAddress.trim(),
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        receiverAddress: receiverAddress.trim(),
        originBranchId,
        destinationBranchId,
        shippingPrice: price,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setFormError((j as { error?: string }).error ?? 'Could not create product')
      return
    }
    const data = await res.json() as {
      trackingNumber: string
      shippingPrice: number
    }
    navigate('/products', {
      state: {
        openLabel: { trackingNumber: data.trackingNumber, shippingPrice: data.shippingPrice },
      },
    })
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Product entry &amp; shipping QR</h2>
      <p className="mb-6 text-sm text-slate-400">
        Enter parcel, sender, receiver, branches, and shipping price. After creation you will be taken
        to the product list where you can print the label or manage the shipment.
      </p>

      <form
        onSubmit={createProduct}
        className="mb-8 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <label className="text-sm text-slate-400">Product / parcel description</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Item details"
          />
        </div>

        <div>
          <label className="text-sm text-slate-400">Sender name</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-slate-400">Sender phone</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={senderPhone}
            onChange={(e) => setSenderPhone(e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm text-slate-400">Sender address</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={senderAddress}
            onChange={(e) => setSenderAddress(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="text-sm text-slate-400">Receiver name</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={receiverName}
            onChange={(e) => setReceiverName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-slate-400">Receiver phone</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={receiverPhone}
            onChange={(e) => setReceiverPhone(e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm text-slate-400">Receiver address</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={receiverAddress}
            onChange={(e) => setReceiverAddress(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="text-sm text-slate-400">Origin branch</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={originBranchId || ''}
            onChange={(e) => setOriginBranchId(Number(e.target.value))}
            required
          >
            {branches.length === 0 ? (
              <option value="">No branches — add branches first</option>
            ) : (
              branchOptions
            )}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400">Destination branch</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={destinationBranchId || ''}
            onChange={(e) => setDestinationBranchId(Number(e.target.value))}
            required
          >
            {branches.length === 0 ? (
              <option value="">No branches — add branches first</option>
            ) : (
              branchOptions
            )}
          </select>
        </div>

        <div>
          <label className="text-sm text-slate-400">Shipping price</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={shippingPrice}
            onChange={(e) => setShippingPrice(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>

        <div className="flex flex-col justify-end gap-2 md:col-span-2">
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting || branches.length === 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create product'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/branches')}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
            >
              Manage branches
            </button>
            <button
              type="button"
              onClick={() => navigate('/products')}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
            >
              Product list
            </button>
          </div>
        </div>
      </form>

      <p className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-4 py-6 text-sm text-slate-500">
        The shipping QR and print actions are available on the{' '}
        <button
          type="button"
          onClick={() => navigate('/products')}
          className="text-violet-400 underline hover:text-violet-300"
        >
          Products
        </button>{' '}
        page after each new shipment is created.
      </p>
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
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/products" element={<ProductsPage />} />
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
