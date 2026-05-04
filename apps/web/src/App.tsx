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
  BarChart3,
  Building2,
  Check,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Printer,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react'
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api'
import L from 'leaflet'
import icon2x from 'leaflet/dist/images/marker-icon-2x.png'
import icon from 'leaflet/dist/images/marker-icon.png'
import shadow from 'leaflet/dist/images/marker-shadow.png'
import { MapContainer, Marker as LeafletMarker, Popup, TileLayer, useMap } from 'react-leaflet'
import { apiFetch, getToken, signalrBase } from './api'

const leafletDefaultIcon = L.icon({
  iconRetinaUrl: icon2x,
  iconUrl: icon,
  shadowUrl: shadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = leafletDefaultIcon

type PendingDriver = {
  id: number
  userId: number
  fullName: string
  phone: string
  vehicleNumber: string
  branchId: number | null
  branchName: string | null
}

type ApprovedDriver = PendingDriver & { isOnline: boolean }

type StaffRow = {
  id: number
  fullName: string
  phone: string
  branchId: number | null
  branchName: string | null
  isActive: boolean
}

type DriverOnMap = {
  driverProfileId: number
  fullName: string
  vehicleNumber: string
  lat: number
  lng: number
  lastSeenAt: string | null
  isOnline: boolean
}

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
    if (data.branchId != null) localStorage.setItem('transport_branch_id', String(data.branchId))
    else localStorage.removeItem('transport_branch_id')
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
          Defaults: admin / Admin123! · branchmanager / Manager123!
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
    localStorage.removeItem('transport_branch_id')
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
          {role === 'Admin' && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/branch-managers">
              <UserCog size={16} /> Branch managers
            </Link>
          )}
          <Link className="flex items-center gap-1 hover:text-violet-400" to="/map">
            <MapPin size={16} /> Live map
          </Link>
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/reports">
              <BarChart3 size={16} /> Reports
            </Link>
          )}
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/branches">
              <Building2 size={16} /> Branches
            </Link>
          )}
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/staff">
              <Users size={16} /> Staff
            </Link>
          )}
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/products">
              <Package size={16} /> Products
            </Link>
          )}
          {(role === 'Admin' || role === 'BranchManager') && (
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
  const [approved, setApproved] = useState<ApprovedDriver[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [driverBranch, setDriverBranch] = useState<Record<number, number>>({})
  const [savingDriverId, setSavingDriverId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [pendingRes, approvedRes, branchesRes] = await Promise.all([
      apiFetch('/api/drivers/pending'),
      apiFetch('/api/drivers/approved'),
      apiFetch('/api/branches'),
    ])
    if (pendingRes.ok) setRows(await pendingRes.json())
    if (approvedRes.ok) setApproved(await approvedRes.json())
    if (branchesRes.ok) setBranches(await branchesRes.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (id: number) => {
    const res = await apiFetch(`/api/drivers/${id}/approve`, { method: 'PATCH' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not approve driver.')
      return
    }
    await load()
  }

  const updateDriverBranch = async (id: number, fallbackBranchId: number | null) => {
    const branchId = driverBranch[id] ?? fallbackBranchId
    if (!branchId) return
    setSavingDriverId(id)
    setError(null)
    const res = await apiFetch(`/api/drivers/${id}/branch`, {
      method: 'PATCH',
      body: JSON.stringify({ branchId }),
    })
    setSavingDriverId(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not update driver branch.')
      return
    }
    await load()
  }

  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.branchName} ({b.code})
    </option>
  ))

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div className="space-y-10">
      {error && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      <div>
        <h2 className="mb-4 text-xl font-semibold text-white">Pending driver approvals</h2>
        <p className="mb-3 text-sm text-slate-500">
          Drivers who registered and are waiting for admin approval.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">{r.fullName}</td>
                  <td className="px-4 py-3">{r.phone}</td>
                  <td className="px-4 py-3">{r.vehicleNumber}</td>
                  <td className="px-4 py-3 text-slate-300">{r.branchName ?? '—'}</td>
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
                  <td className="px-4 py-6 text-slate-500" colSpan={5}>
                    No pending drivers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xl font-semibold text-white">Approved drivers</h2>
        <p className="mb-3 text-sm text-slate-500">
          Drivers who can sign in and go online for trips at their branch.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Online</th>
                <th className="px-4 py-3 text-right">Update branch</th>
              </tr>
            </thead>
            <tbody>
              {approved.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">{r.fullName}</td>
                  <td className="px-4 py-3">{r.phone}</td>
                  <td className="px-4 py-3">{r.vehicleNumber}</td>
                  <td className="px-4 py-3 text-slate-300">{r.branchName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.isOnline ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-slate-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <select
                        value={driverBranch[r.id] ?? r.branchId ?? ''}
                        onChange={(e) =>
                          setDriverBranch((prev) => ({
                            ...prev,
                            [r.id]: Number(e.target.value),
                          }))
                        }
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                      >
                        <option value="">Select branch</option>
                        {branchOptions}
                      </select>
                      <button
                        type="button"
                        disabled={savingDriverId === r.id}
                        onClick={() => void updateDriverBranch(r.id, r.branchId)}
                        className="rounded-lg border border-violet-700/60 px-2 py-1 text-xs text-violet-200 hover:bg-violet-900/40 disabled:opacity-50"
                      >
                        {savingDriverId === r.id ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {approved.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={6}>
                    No approved drivers yet. Approve a driver above to see them here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BranchesPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
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
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  if (!isAdmin && !isBranchManager) {
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
        {isAdmin
          ? 'Create and manage branch locations. Branch codes must be unique.'
          : 'All hubs (read-only). Only an admin can add, edit, or remove branches.'}
      </p>

      {isAdmin && (
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
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Address</th>
              {isAdmin && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{b.branchName}</td>
                <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                <td className="px-4 py-3 text-slate-300">{b.address}</td>
                {isAdmin && (
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
                )}
              </tr>
            ))}
            {branches.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={isAdmin ? 4 : 3}>
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

function StaffPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
  const [staffRows, setStaffRows] = useState<StaffRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newBranchId, setNewBranchId] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [staffRes, branchRes] = await Promise.all([
      apiFetch('/api/staff'),
      apiFetch('/api/branches'),
    ])
    if (staffRes.ok) setStaffRows(await staffRes.json())
    if (branchRes.ok) setBranches(await branchRes.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  useEffect(() => {
    if (!isBranchManager) return
    const bid = Number(localStorage.getItem('transport_branch_id'))
    if (Number.isFinite(bid) && bid > 0) setNewBranchId(bid)
  }, [isBranchManager, branches])

  if (!isAdmin && !isBranchManager) return <Navigate to="/map" replace />
  if (loading) return <p className="text-slate-400">Loading…</p>

  const createStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    const mgrBid = Number(localStorage.getItem('transport_branch_id'))
    const branchIdToUse =
      isBranchManager && Number.isFinite(mgrBid) && mgrBid > 0 ? mgrBid : newBranchId
    if (!branchIdToUse) {
      setError('Select a branch for the new staff account.')
      return
    }
    setError(null)
    setCreating(true)
    const res = await apiFetch('/api/staff', {
      method: 'POST',
      body: JSON.stringify({
        fullName: newName.trim(),
        phone: newPhone.trim(),
        password: newPassword,
        branchId: branchIdToUse,
      }),
    })
    setCreating(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not create staff.')
      return
    }
    setNewName('')
    setNewPhone('')
    setNewPassword('')
    const bid = Number(localStorage.getItem('transport_branch_id'))
    if (isBranchManager && Number.isFinite(bid) && bid > 0) setNewBranchId(bid)
    else setNewBranchId(0)
    await load()
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    const lockedBid = Number(localStorage.getItem('transport_branch_id'))
    const branchId = isBranchManager && Number.isFinite(lockedBid) && lockedBid > 0
      ? lockedBid
      : Number(fd.get('branchId'))
    if (!Number.isFinite(branchId) || branchId <= 0) {
      setError('Select a valid branch.')
      return
    }

    setError(null)
    setSaving(true)
    const res = await apiFetch(`/api/staff/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fullName: String(fd.get('fullName') ?? '').trim(),
        phone: String(fd.get('phone') ?? '').trim(),
        branchId,
        isActive: fd.get('isActive') === 'on',
      }),
    })
    setSaving(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not save staff.')
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

  const removeStaff = async (s: StaffRow) => {
    if (!window.confirm(`Delete staff ${s.fullName} (${s.phone})?`)) return
    setError(null)
    const res = await apiFetch(`/api/staff/${s.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not delete staff.')
      return
    }
    if (editing?.id === s.id) setEditing(null)
    await load()
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Staff list</h2>
      <p className="mb-6 text-sm text-slate-400">
        {isBranchManager
          ? 'Create and manage staff accounts for your branch only.'
          : 'Manage staff account details and branch assignment by branch name.'}
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <form
        onSubmit={createStaff}
        className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h3 className="mb-4 text-sm font-medium text-slate-300">Create staff</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm text-slate-400">Full name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Phone / login ID</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Branch</label>
            <select
              value={newBranchId || ''}
              onChange={(e) => setNewBranchId(Number(e.target.value))}
              required
              disabled={isBranchManager}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white disabled:opacity-70"
            >
              <option value="">Select branch</option>
              {branchOptions}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create staff'}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone / ID</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staffRows.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{s.fullName}</td>
                <td className="px-4 py-3">{s.phone}</td>
                <td className="px-4 py-3 text-slate-300">{s.branchName ?? '—'}</td>
                <td className="px-4 py-3">
                  {s.isActive ? (
                    <span className="text-emerald-400">Yes</span>
                  ) : (
                    <span className="text-slate-500">No</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setEditing(s)
                    }}
                    className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeStaff(s)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-950/40"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {staffRows.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                  No staff accounts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 no-print">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <h3 className="mb-4 text-lg font-medium text-white">Edit staff</h3>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-400">Full name</label>
                <input
                  name="fullName"
                  defaultValue={editing.fullName}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Phone / login ID</label>
                <input
                  name="phone"
                  defaultValue={editing.phone}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Branch</label>
                <select
                  name="branchId"
                  defaultValue={editing.branchId ?? ''}
                  required
                  disabled={isBranchManager}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white disabled:opacity-70"
                >
                  <option value="">Select branch</option>
                  {branchOptions}
                </select>
              </div>
              <label className="mt-1 inline-flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="isActive" defaultChecked={editing.isActive} />
                Active account
              </label>
            </div>
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
          </form>
        </div>
      )}
    </div>
  )
}

function BranchManagersPage() {
  const role = localStorage.getItem('transport_role')
  const [rows, setRows] = useState<StaffRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newBranchId, setNewBranchId] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [listRes, branchRes] = await Promise.all([
      apiFetch('/api/branch-managers'),
      apiFetch('/api/branches'),
    ])
    if (listRes.ok) setRows(await listRes.json())
    if (branchRes.ok) setBranches(await branchRes.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (role !== 'Admin') return
    void load()
  }, [load, role])

  if (role !== 'Admin') return <Navigate to="/map" replace />
  if (loading) return <p className="text-slate-400">Loading…</p>

  const createManager = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBranchId) {
      setError('Select a branch for the new branch manager.')
      return
    }
    setError(null)
    setCreating(true)
    const res = await apiFetch('/api/branch-managers', {
      method: 'POST',
      body: JSON.stringify({
        fullName: newName.trim(),
        phone: newPhone.trim(),
        password: newPassword,
        branchId: newBranchId,
      }),
    })
    setCreating(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not create branch manager.')
      return
    }
    setNewName('')
    setNewPhone('')
    setNewPassword('')
    setNewBranchId(0)
    await load()
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    const branchId = Number(fd.get('branchId'))
    if (!Number.isFinite(branchId) || branchId <= 0) {
      setError('Select a valid branch.')
      return
    }

    setError(null)
    setSaving(true)
    const res = await apiFetch(`/api/branch-managers/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fullName: String(fd.get('fullName') ?? '').trim(),
        phone: String(fd.get('phone') ?? '').trim(),
        branchId,
        isActive: fd.get('isActive') === 'on',
      }),
    })
    setSaving(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not save branch manager.')
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

  const remove = async (s: StaffRow) => {
    if (!window.confirm(`Delete branch manager ${s.fullName} (${s.phone})?`)) return
    setError(null)
    const res = await apiFetch(`/api/branch-managers/${s.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not delete branch manager.')
      return
    }
    if (editing?.id === s.id) setEditing(null)
    await load()
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Branch managers</h2>
      <p className="mb-6 text-sm text-slate-400">
        Create and manage branch manager accounts. Each manager is linked to one branch and can only
        access that branch in the console.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <form
        onSubmit={createManager}
        className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h3 className="mb-4 text-sm font-medium text-slate-300">Create branch manager</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm text-slate-400">Full name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Phone / login ID</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Branch</label>
            <select
              value={newBranchId || ''}
              onChange={(e) => setNewBranchId(Number(e.target.value))}
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            >
              <option value="">Select branch</option>
              {branchOptions}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create branch manager'}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone / ID</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{s.fullName}</td>
                <td className="px-4 py-3">{s.phone}</td>
                <td className="px-4 py-3 text-slate-300">{s.branchName ?? '—'}</td>
                <td className="px-4 py-3">
                  {s.isActive ? (
                    <span className="text-emerald-400">Yes</span>
                  ) : (
                    <span className="text-slate-500">No</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setEditing(s)
                    }}
                    className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(s)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-950/40"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                  No branch manager accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 no-print">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <h3 className="mb-4 text-lg font-medium text-white">Edit branch manager</h3>
            <div className="grid gap-3">
              <div>
                <label className="text-sm text-slate-400">Full name</label>
                <input
                  name="fullName"
                  defaultValue={editing.fullName}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Phone / login ID</label>
                <input
                  name="phone"
                  defaultValue={editing.phone}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Branch</label>
                <select
                  name="branchId"
                  defaultValue={editing.branchId ?? ''}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                >
                  <option value="">Select branch</option>
                  {branchOptions}
                </select>
              </div>
              <label className="mt-1 inline-flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="isActive" defaultChecked={editing.isActive} />
                Active account
              </label>
            </div>
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
          </form>
        </div>
      )}
    </div>
  )
}

function hasDriverPosition(d: { lat: number; lng: number }): boolean {
  return Math.abs(d.lat) > 0.0001 || Math.abs(d.lng) > 0.0001
}

function meanCenter(drivers: DriverOnMap[]): { lat: number; lng: number } {
  const valid = drivers.filter(hasDriverPosition)
  if (valid.length === 0) return { lat: 23.8103, lng: 90.4125 }
  const lat = valid.reduce((s, d) => s + d.lat, 0) / valid.length
  const lng = valid.reduce((s, d) => s + d.lng, 0) / valid.length
  return { lat, lng }
}

function LeafletRecenter({
  center,
  zoom,
}: {
  center: { lat: number; lng: number }
  zoom: number
}) {
  const map = useMap()
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom)
  }, [center.lat, center.lng, zoom, map])
  return null
}

function OsmLiveMap({
  drivers,
  mapCenter,
  mapZoom,
  onSelectDriver,
}: {
  drivers: DriverOnMap[]
  mapCenter: { lat: number; lng: number }
  mapZoom: number
  onSelectDriver: (id: number) => void
}) {
  return (
    <MapContainer
      center={[mapCenter.lat, mapCenter.lng]}
      zoom={mapZoom}
      style={{ height: 420, width: '100%' }}
      className="z-0 rounded-xl border border-slate-800 [&_.leaflet-control-attribution]:max-w-[55%] [&_.leaflet-control-attribution]:truncate [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:text-slate-400"
      scrollWheelZoom
    >
      <LeafletRecenter center={mapCenter} zoom={mapZoom} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {drivers.filter(hasDriverPosition).map((d) => (
        <LeafletMarker
          key={d.driverProfileId}
          position={[d.lat, d.lng]}
          eventHandlers={{
            click: () => {
              onSelectDriver(d.driverProfileId)
            },
          }}
        >
          <Popup>
            <span className="text-slate-900">
              {d.fullName} · {d.vehicleNumber} (#{d.driverProfileId})
            </span>
          </Popup>
        </LeafletMarker>
      ))}
    </MapContainer>
  )
}

function LiveMapPage() {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim()
  const [drivers, setDrivers] = useState<DriverOnMap[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [connection, setConnection] = useState<HubConnection | null>(null)

  const mergeLocation = (driverProfileId: number, lat: number, lng: number) => {
    setDrivers((prev) => {
      const rest = prev.filter((d) => d.driverProfileId !== driverProfileId)
      const old = prev.find((d) => d.driverProfileId === driverProfileId)
      const next: DriverOnMap = {
        driverProfileId,
        fullName: old?.fullName ?? `Driver #${driverProfileId}`,
        vehicleNumber: old?.vehicleNumber ?? '',
        lat: Number(lat),
        lng: Number(lng),
        lastSeenAt: new Date().toISOString(),
        isOnline: old?.isOnline ?? true,
      }
      return [...rest, next].sort((a, b) => a.fullName.localeCompare(b.fullName))
    })
  }

  useEffect(() => {
    void (async () => {
      const res = await apiFetch('/api/tracking/driver-locations')
      if (!res.ok) return
      const raw = (await res.json()) as {
        driverProfileId: number
        fullName: string
        vehicleNumber: string
        latitude: number
        longitude: number
        lastSeenAt: string | null
        isOnline: boolean
      }[]
      setDrivers(
        raw
          .map((r) => ({
            driverProfileId: r.driverProfileId,
            fullName: r.fullName,
            vehicleNumber: r.vehicleNumber,
            lat: Number(r.latitude),
            lng: Number(r.longitude),
            lastSeenAt: r.lastSeenAt,
            isOnline: r.isOnline,
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
      )
    })()
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return

    const hub = new HubConnectionBuilder()
      .withUrl(`${signalrBase()}/hubs/transport`, {
        accessTokenFactory: () => token ?? '',
      })
      .withAutomaticReconnect()
      .build()

    hub.on('LocationUpdated', (driverProfileId: number, lat: number, lng: number) => {
      mergeLocation(driverProfileId, lat, lng)
    })

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

  const mapCenter = useMemo(() => {
    if (selectedId != null) {
      const d = drivers.find((x) => x.driverProfileId === selectedId)
      if (d && hasDriverPosition(d)) return { lat: d.lat, lng: d.lng }
    }
    return meanCenter(drivers)
  }, [selectedId, drivers])

  const mapZoom = useMemo(() => {
    if (selectedId == null) return 11
    const d = drivers.find((x) => x.driverProfileId === selectedId)
    return d && hasDriverPosition(d) ? 15 : 11
  }, [selectedId, drivers])

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
        {apiKey ? (
          <span className="text-slate-600"> · Google Maps</span>
        ) : (
          <span className="text-slate-600"> · OpenStreetMap (set VITE_GOOGLE_MAPS_API_KEY for Google tiles)</span>
        )}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {apiKey ? (
            <LoadScript googleMapsApiKey={apiKey}>
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                zoom={mapZoom}
                center={mapCenter}
              >
                {drivers.filter(hasDriverPosition).map((d) => (
                  <Marker
                    key={d.driverProfileId}
                    position={{ lat: d.lat, lng: d.lng }}
                    title={`${d.fullName} · ${d.vehicleNumber} (#${d.driverProfileId})`}
                    onClick={() => setSelectedId(d.driverProfileId)}
                  />
                ))}
              </GoogleMap>
            </LoadScript>
          ) : (
            <OsmLiveMap
              drivers={drivers}
              mapCenter={mapCenter}
              mapZoom={mapZoom}
              onSelectDriver={setSelectedId}
            />
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Drivers</h3>
            <button
              type="button"
              disabled={selectedId == null}
              onClick={() => setSelectedId(null)}
              className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              Show all
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Select a driver to center the map on their latest position. Live updates arrive over SignalR when drivers
            report GPS.
          </p>
          <ul className="max-h-[360px] space-y-1 overflow-y-auto text-sm">
            {drivers.map((d) => {
              const ok = hasDriverPosition(d)
              const active = selectedId === d.driverProfileId
              return (
                <li key={d.driverProfileId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.driverProfileId)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-violet-500 bg-violet-950/50 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-200 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium">{d.fullName}</div>
                    <div className="text-xs text-slate-400">
                      {d.vehicleNumber} · #{d.driverProfileId}
                      {d.isOnline ? (
                        <span className="ml-2 text-emerald-400">online</span>
                      ) : (
                        <span className="ml-2 text-slate-500">offline</span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">
                      {ok ? (
                        <>
                          {d.lat.toFixed(5)}, {d.lng.toFixed(5)}
                        </>
                      ) : (
                        'No GPS position yet'
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
            {drivers.length === 0 && (
              <li className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-slate-500">
                No drivers in scope. Admins see all approved drivers; branch managers and staff see their branch.
                Positions update when drivers run the mobile app with location on.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

function ProductsPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
  const branchId = Number(localStorage.getItem('transport_branch_id'))
  const managerBranchId = Number.isFinite(branchId) && branchId > 0 ? branchId : null
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
  const [delivering, setDelivering] = useState<ProductRow | null>(null)
  const [deliverReceiverPhone, setDeliverReceiverPhone] = useState('')
  const [deliverPaidBySender, setDeliverPaidBySender] = useState(true)
  const [deliverPaidAtBranch, setDeliverPaidAtBranch] = useState(false)
  const [deliverSaving, setDeliverSaving] = useState(false)

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
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  useEffect(() => {
    const s = location.state as { openLabel?: { trackingNumber: string; shippingPrice: number } } | null
    if (s?.openLabel) {
      setReprint(s.openLabel)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.pathname, location.state, navigate])

  if (!isAdmin && !isBranchManager) {
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

  const openDeliver = (p: ProductRow) => {
    setFormError(null)
    setDelivering(p)
    setDeliverReceiverPhone('')
    setDeliverPaidBySender(true)
    setDeliverPaidAtBranch(false)
  }

  const confirmDeliver = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!delivering) return
    if (!deliverReceiverPhone.trim()) {
      setFormError('Enter receiver phone for number verification.')
      return
    }
    if (!deliverPaidBySender && !deliverPaidAtBranch) {
      setFormError('If sender did not pay, confirm payment at branch before delivery.')
      return
    }
    setDeliverSaving(true)
    const res = await apiFetch(`/api/products/${delivering.id}/deliver`, {
      method: 'PATCH',
      body: JSON.stringify({
        receiverPhone: deliverReceiverPhone.trim(),
        paidBySender: deliverPaidBySender,
        paymentReceivedAtBranch: deliverPaidAtBranch,
      }),
    })
    setDeliverSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setFormError((j as { error?: string }).error ?? 'Could not mark delivered')
      return
    }
    setDelivering(null)
    await load()
  }

  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.branchName} ({b.code})
    </option>
  ))

  const branchScopeText = (p: ProductRow): string => {
    if (!isBranchManager || managerBranchId == null) return ''
    const fromHere = p.originBranchId === managerBranchId
    const toHere = p.destinationBranchId === managerBranchId
    if (fromHere && toHere) return 'Sending + Receiving'
    if (fromHere) return 'Sending'
    if (toHere) return 'Receiving'
    return 'In scope'
  }

  const canManagerDeliver = (p: ProductRow): boolean =>
    isBranchManager && managerBranchId != null && p.destinationBranchId === managerBranchId

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Products</h2>
          <p className="mt-1 text-sm text-slate-400">
            {isBranchManager
              ? 'Shipments linked to your branch (origin, destination, or current location). Reprint QR labels anytime.'
              : 'View, edit, or delete shipments. Reprint the shipping label QR anytime. Products on an active trip cannot be deleted.'}
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
              <th className="px-3 py-3">Origin branch</th>
              <th className="px-3 py-3">Destination branch</th>
              {isBranchManager && <th className="px-3 py-3">Your scope</th>}
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
                <td className="px-3 py-2 text-xs text-slate-300">{p.originBranchName}</td>
                <td className="px-3 py-2 text-xs text-slate-300">{p.destinationBranchName}</td>
                {isBranchManager && <td className="px-3 py-2 text-xs text-violet-300">{branchScopeText(p)}</td>}
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
                  {p.status === 'Downloaded' && (!isBranchManager || canManagerDeliver(p)) && (
                    <button
                      type="button"
                      onClick={() => openDeliver(p)}
                      className="mr-1 inline-flex items-center gap-1 rounded border border-emerald-700/50 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-900/30"
                    >
                      Deliver
                    </button>
                  )}
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
                <td className="px-4 py-8 text-center text-slate-500" colSpan={isBranchManager ? 8 : 7}>
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

      {delivering && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 no-print">
          <form
            onSubmit={confirmDeliver}
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <h3 className="mb-4 text-lg font-medium text-white">Mark as delivered</h3>
            <p className="mb-4 text-sm text-slate-400">
              Tracking: <span className="font-mono text-slate-200">{delivering.trackingNumber}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400">Receiver phone (number check)</label>
                <input
                  value={deliverReceiverPhone}
                  onChange={(e) => setDeliverReceiverPhone(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={deliverPaidBySender}
                  onChange={(e) => setDeliverPaidBySender(e.target.checked)}
                />
                Shipping paid by sender
              </label>

              {!deliverPaidBySender && (
                <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={deliverPaidAtBranch}
                    onChange={(e) => setDeliverPaidAtBranch(e.target.checked)}
                  />
                  Payment received at branch from customer
                </label>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={deliverSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {deliverSaving ? 'Saving…' : 'Confirm delivery'}
              </button>
              <button
                type="button"
                onClick={() => setDelivering(null)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function QrLabelPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
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
    if (!isAdmin && !isBranchManager) return
    void (async () => {
      const res = await apiFetch('/api/branches')
      if (!res.ok) return
      const list: Branch[] = await res.json()
      setBranches(list)
      const myBid = Number(localStorage.getItem('transport_branch_id'))
      if (isBranchManager && Number.isFinite(myBid) && myBid > 0) {
        setOriginBranchId(myBid)
        const other = list.find((b) => b.id !== myBid)?.id ?? list[0]?.id ?? 0
        setDestinationBranchId(other)
      } else if (list.length > 0) {
        setOriginBranchId(list[0].id)
        setDestinationBranchId(list[Math.min(1, list.length - 1)].id)
      }
    })()
  }, [role, isAdmin, isBranchManager])

  if (!isAdmin && !isBranchManager) {
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
    const mgrBid = Number(localStorage.getItem('transport_branch_id'))
    const originToSend =
      isBranchManager && Number.isFinite(mgrBid) && mgrBid > 0 ? mgrBid : originBranchId
    if (!originToSend || !destinationBranchId) {
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
        originBranchId: originToSend,
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
        {isBranchManager
          ? 'Shipments are created with your branch as origin. Choose any destination hub, then print the label from the product list.'
          : 'Enter parcel, sender, receiver, branches, and shipping price. After creation you will be taken to the product list where you can print the label or manage the shipment.'}
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
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white disabled:opacity-70"
            value={originBranchId || ''}
            onChange={(e) => setOriginBranchId(Number(e.target.value))}
            required
            disabled={isBranchManager}
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
            {(isAdmin || isBranchManager) && (
              <button
                type="button"
                onClick={() => navigate('/branches')}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
              >
                {isAdmin ? 'Manage branches' : 'View branches'}
              </button>
            )}
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

type CollectionRow = {
  branchId: number
  branchName: string
  totalCollection: number
}

function ReportsPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
  const [rows, setRows] = useState<CollectionRow[]>([])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const openNativeDatePicker = (el: HTMLInputElement) => {
    const pickerInput = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof pickerInput.showPicker === 'function') pickerInput.showPicker()
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const query = params.toString()
    const res = await apiFetch(`/api/reports/branch-collections${query ? `?${query}` : ''}`)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not load report.')
      setRows([])
    } else {
      setRows(await res.json())
    }
    setLoading(false)
  }, [fromDate, toDate])

  useEffect(() => {
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  if (!isAdmin && !isBranchManager) return <Navigate to="/map" replace />

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Delivered collection by branch</h2>
      <p className="mb-6 text-sm text-slate-400">
        Sum of shipping price for parcels in Delivered status, attributed to each destination branch.
        {isBranchManager && ' Your view is limited to your branch.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void load()
        }}
        className="mb-6 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 md:grid-cols-[1fr_1fr_auto_auto]"
      >
        <div>
          <label className="text-sm text-slate-400">From date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            onClick={(e) => openNativeDatePicker(e.currentTarget)}
            onFocus={(e) => openNativeDatePicker(e.currentTarget)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400">To date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            onClick={(e) => openNativeDatePicker(e.currentTarget)}
            onFocus={(e) => openNativeDatePicker(e.currentTarget)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </div>
        <button
          type="submit"
          className="self-end rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            setFromDate('')
            setToDate('')
            void (async () => {
              setLoading(true)
              setError(null)
              const res = await apiFetch('/api/reports/branch-collections')
              if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                setError((j as { error?: string }).error ?? 'Could not load report.')
                setRows([])
              } else {
                setRows(await res.json())
              }
              setLoading(false)
            })()
          }}
          className="self-end rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
        >
          Clear
        </button>
      </form>
      {error && (
        <p className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {loading && <p className="mb-4 text-slate-400">Loading…</p>}
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3 text-right">Total collection</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.branchId} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-200">{r.branchName}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-100">
                  {Number(r.totalCollection).toFixed(2)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={2}>
                  No delivered shipments yet for this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HomePage() {
  const role = localStorage.getItem('transport_role')
  if (role === 'Admin') return <ApprovalsPage />
  if (role === 'BranchManager') return <Navigate to="/reports" replace />
  return <Navigate to="/map" replace />
}

function DashboardRoutes() {
  if (!useAuth()) return <Navigate to="/login" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<LiveMapPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/branch-managers" element={<BranchManagersPage />} />
        <Route path="/staff" element={<StaffPage />} />
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
