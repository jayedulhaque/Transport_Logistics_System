import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
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
  Contact,
  Check,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Printer,
  Search,
  Settings,
  Trash2,
  Truck,
  UserCog,
  Users,
  Wallet,
  KeyRound,
} from 'lucide-react'
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api'
import L from 'leaflet'
import icon2x from 'leaflet/dist/images/marker-icon-2x.png'
import icon from 'leaflet/dist/images/marker-icon.png'
import shadow from 'leaflet/dist/images/marker-shadow.png'
import { MapContainer, Marker as LeafletMarker, Popup, TileLayer, useMap } from 'react-leaflet'
import { apiFetch, getToken, signalrBase } from './api'

/** Two-decimal display; dampens binary float noise from JSON (e.g. 399.99999999994 â†’ "400.00"). */
function formatMoneyDisplay(value: number): string {
  if (!Number.isFinite(value)) return '0.00'
  return (Math.round(value * 100) / 100).toFixed(2)
}

/** Normalize user/API money to cents before send or compare. */
function toMoneyCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

const LIST_PAGE_SIZE = 10

function useListPagination<T>(items: T[], pageSize = LIST_PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    setPage(1)
  }, [total])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, safePage, pageSize])

  return { page: safePage, setPage, pageItems, totalPages, total, pageSize }
}

function ListPagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (p: number) => void
}) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-slate-600 px-3 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="min-w-[5rem] text-center text-slate-300">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-slate-600 px-3 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}

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

type DriverEditFields = {
  phone: string
  vehicleNumber: string
  branchId: number
}

function normalizeMobile(input: string): string {
  return input.replace(/\D/g, '')
}

function isValidMobile(input: string): boolean {
  const n = normalizeMobile(input)
  return n.length >= 9 && n.length <= 15
}

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
  settlementType: string
  commissionPercent: number | null
}

type BranchSettlement = {
  branchId: number
  branchName: string
  settlementType: string
  commissionPercent: number | null
  collectedAsOrigin: number
  collectedAsDestination: number
  destinationShippingTotal: number
  commissionEarned: number
  netSettlement: number
  paidToAdmin: number
  paidFromAdmin: number
  pendingToAdmin: number
  dueToAdmin: number
  dueFromAdmin: number
  recentPayments: {
    id: number
    amount: number
    direction: string
    note: string | null
    createdAt: string
    recordedByName: string
    status: string
    branchName?: string | null
  }[]
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
  amountReceivedAtOrigin: number
  amountReceivedAtDestination: number
  dueAmount: number
  status: string
  createdAt: string
}

type ProductDetail = {
  id: string
  trackingNumber: string
  description: string
  status: string
  sender: { name: string; phone: string; address: string }
  receiver: { name: string; phone: string; address: string }
  originBranchName: string
  destinationBranchName: string
  originBranchManager: { branchName: string; fullName: string; phone: string } | null
  destinationBranchManager: { branchName: string; fullName: string; phone: string } | null
  trip: {
    tripId: string
    status: string
    driverName: string
    driverPhone: string
    vehicleNumber: string
    originBranchName: string
    destinationBranchesLabel: string
    driverPaymentAmount: number
    loadTime: string
  } | null
  shippingPrice: number
  amountReceivedAtOrigin: number
  amountReceivedAtDestination: number
  dueAmount: number
  createdAt: string
  deliveredAt: string | null
}

type PaymentBadge = {
  label: string
  className: string
}

const paymentBadgeBaseClass =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium'

function getPaymentBadge(product: ProductRow): PaymentBadge {
  const shipping = Number(product.shippingPrice ?? 0)
  const origin = Number(product.amountReceivedAtOrigin ?? 0)
  const destination = Number(product.amountReceivedAtDestination ?? 0)
  const due = Math.max(0, Number(product.dueAmount ?? 0))

  if (shipping <= 0) {
    return {
      label: 'No Charge',
      className: `${paymentBadgeBaseClass} border-slate-600 text-slate-300`,
    }
  }
  if (due <= 0 && origin >= shipping) {
    return {
      label: 'Paid by Sender',
      className: `${paymentBadgeBaseClass} border-emerald-700/60 bg-emerald-950/50 text-emerald-300`,
    }
  }
  if (due <= 0 && destination > 0) {
    return {
      label: 'Due Cleared',
      className: `${paymentBadgeBaseClass} border-cyan-700/60 bg-cyan-950/50 text-cyan-300`,
    }
  }
  if (due > 0 && origin > 0) {
    return {
      label: 'Partial',
      className: `${paymentBadgeBaseClass} border-amber-700/60 bg-amber-950/50 text-amber-300`,
    }
  }
  return {
    label: 'Due',
    className: `${paymentBadgeBaseClass} border-rose-700/60 bg-rose-950/50 text-rose-300`,
  }
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
        <p className="mt-4 text-center text-sm">
          <Link to="/forgot-password" className="text-violet-400 hover:text-violet-300">
            Forgot password?
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-slate-500">
          Defaults: admin / Admin123! Â· branchmanager / Manager123!
        </p>
      </form>
    </div>
  )
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setSending(true)
    const res = await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    })
    setSending(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not send reset email.')
      return
    }
    const j = (await res.json()) as { message?: string }
    setMessage(j.message ?? 'If an account exists for that email, a password reset link has been sent.')
    setEmail('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl"
      >
        <h1 className="mb-2 text-center text-2xl font-semibold text-white">Forgot password</h1>
        <p className="mb-6 text-center text-sm text-slate-400">
          Enter the email on your admin account. We will send a reset link if it is registered.
        </p>
        <label className="mb-2 block text-sm text-slate-400">Email</label>
        <input
          type="email"
          className="mb-6 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {message && <p className="mb-4 text-sm text-emerald-400">{message}</p>}
        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-lg bg-violet-600 py-2 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send reset link'}
        </button>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-violet-400 hover:text-violet-300">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  )
}

function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    if (!token) {
      setError('Reset link is invalid. Request a new link from the sign-in page.')
      return
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    const res = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not reset password.')
      return
    }
    const j = (await res.json()) as { message?: string }
    setMessage(j.message ?? 'Password updated.')
    setTimeout(() => navigate('/login'), 2000)
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 text-center shadow-xl">
          <p className="mb-4 text-red-400">This reset link is invalid or missing.</p>
          <Link to="/forgot-password" className="text-violet-400 hover:text-violet-300">
            Request a new link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl"
      >
        <h1 className="mb-6 text-center text-2xl font-semibold text-white">Set new password</h1>
        <label className="mb-2 block text-sm text-slate-400">New password</label>
        <input
          type="password"
          className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <label className="mb-2 block text-sm text-slate-400">Confirm password</label>
        <input
          type="password"
          className="mb-6 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
        />
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {message && <p className="mb-4 text-sm text-emerald-400">{message}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-violet-600 py-2 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}

function ResetUserPasswordButton({ apiPath, accountLabel }: { apiPath: string; accountLabel: string }) {
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const close = () => {
    setOpen(false)
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    const res = await apiFetch(apiPath, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not reset password.')
      return
    }
    setSuccess(true)
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setError(null)
          setSuccess(false)
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-amber-800/50 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950/40"
      >
        <KeyRound size={14} /> Reset password
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={submit}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <h3 className="mb-2 text-lg font-medium text-white">Reset password</h3>
            <p className="mb-4 text-sm text-slate-400">{accountLabel}</p>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400">New password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Confirm password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            {success && (
              <p className="mt-3 text-sm text-emerald-400">Password updated successfully.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Set password'}
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
              >
                {success ? 'Close' : 'Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const role = localStorage.getItem('transport_role')
  const wideMain = pathname === '/products' || pathname === '/customers'

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
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/approvals">
              <Users size={16} /> Approvals
            </Link>
          )}
          {role === 'Admin' && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/configuration">
              <Settings size={16} /> Configuration
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
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/customers">
              <Contact size={16} /> Customers
            </Link>
          )}
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/trips">
              <Truck size={16} /> Trips
            </Link>
          )}
          {(role === 'Admin' || role === 'BranchManager') && (
            <Link className="flex items-center gap-1 hover:text-violet-400" to="/driver-earnings">
              <Wallet size={16} /> Driver earnings
            </Link>
          )}
          <Link className="flex items-center gap-1 hover:text-violet-400" to="/account">
            <KeyRound size={16} /> Account
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
      <main
        className={`mx-auto px-6 py-8 ${wideMain ? 'max-w-[90rem]' : 'max-w-5xl'}`}
      >
        {children}
      </main>
    </div>
  )
}

type PendingSettlementPayment = {
  id: number
  amount: number
  direction: string
  note: string | null
  createdAt: string
  recordedByName: string
  status: string
  branchName?: string | null
}

function ApprovalsPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const [rows, setRows] = useState<PendingDriver[]>([])
  const [approved, setApproved] = useState<ApprovedDriver[]>([])
  const [pendingPayments, setPendingPayments] = useState<PendingSettlementPayment[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [driverEdits, setDriverEdits] = useState<Record<number, DriverEditFields>>({})
  const [savingDriverId, setSavingDriverId] = useState<number | null>(null)
  const [paymentActionId, setPaymentActionId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const requests = [
      apiFetch('/api/drivers/pending'),
      apiFetch('/api/drivers/approved'),
      apiFetch('/api/branches'),
      ...(isAdmin ? [apiFetch('/api/branches/settlement/payments/pending')] : []),
    ] as const
    const [pendingRes, approvedRes, branchesRes, paymentsRes] = await Promise.all(requests)
    if (pendingRes.ok) setRows(await pendingRes.json())
    if (approvedRes.ok) setApproved(await approvedRes.json())
    if (branchesRes.ok) setBranches(await branchesRes.json())
    if (isAdmin && paymentsRes?.ok) setPendingPayments(await paymentsRes.json())
    else if (!isAdmin) setPendingPayments([])
    setDriverEdits({})
    setLoading(false)
  }, [isAdmin])

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

  const settlePayment = async (paymentId: number, action: 'approve' | 'reject') => {
    setPaymentActionId(paymentId)
    setError(null)
    const res = await apiFetch(
      `/api/branches/settlement/payments/${paymentId}/${action}`,
      { method: 'PATCH' }
    )
    setPaymentActionId(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? `Could not ${action} payment.`)
      return
    }
    await load()
  }

  const getDriverEdit = (r: PendingDriver): DriverEditFields =>
    driverEdits[r.id] ?? {
      phone: r.phone,
      vehicleNumber: r.vehicleNumber,
      branchId: r.branchId ?? branches[0]?.id ?? 0,
    }

  const patchDriverEdit = (id: number, r: PendingDriver, patch: Partial<DriverEditFields>) => {
    setDriverEdits((prev) => {
      const current = prev[id] ?? {
        phone: r.phone,
        vehicleNumber: r.vehicleNumber,
        branchId: r.branchId ?? branches[0]?.id ?? 0,
      }
      return { ...prev, [id]: { ...current, ...patch } }
    })
  }

  const saveDriver = async (r: PendingDriver) => {
    const e = driverEdits[r.id] ?? getDriverEdit(r)
    if (!isValidMobile(e.phone)) {
      setError('Enter a valid mobile number (9â€“15 digits).')
      return
    }
    if (!e.vehicleNumber.trim()) {
      setError('Vehicle number is required.')
      return
    }
    if (!e.branchId) {
      setError('Select a branch.')
      return
    }
    setSavingDriverId(r.id)
    setError(null)
    const res = await apiFetch(`/api/drivers/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        phone: normalizeMobile(e.phone),
        vehicleNumber: e.vehicleNumber.trim(),
        branchId: e.branchId,
      }),
    })
    setSavingDriverId(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not save driver.')
      return
    }
    await load()
  }

  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.branchName} ({b.code})
    </option>
  ))

  const pendingPag = useListPagination(rows)
  const pendingPaymentsPag = useListPagination(pendingPayments)
  const approvedPag = useListPagination(approved)

  if (loading) return <p className="text-slate-400">Loadingâ€¦</p>

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
          {isAdmin
            ? 'Drivers who registered and are waiting for approval.'
            : 'Drivers assigned to your branch who registered and are waiting for approval.'}
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingPag.pageItems.map((r) => {
                const e = getDriverEdit(r)
                return (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">{r.fullName}</td>
                  <td className="px-4 py-3">
                    <input
                      type="tel"
                      className="w-full min-w-[120px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                      value={e.phone}
                      onChange={(ev) => patchDriverEdit(r.id, r, { phone: ev.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="w-full min-w-[100px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                      value={e.vehicleNumber}
                      onChange={(ev) => patchDriverEdit(r.id, r, { vehicleNumber: ev.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                      value={e.branchId || ''}
                      onChange={(ev) => patchDriverEdit(r.id, r, { branchId: Number(ev.target.value) })}
                    >
                      <option value="">Select branch</option>
                      {branchOptions}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={savingDriverId === r.id}
                        onClick={() => void saveDriver(r)}
                        className="rounded-lg border border-violet-700/60 px-3 py-1 text-xs text-violet-200 hover:bg-violet-900/40 disabled:opacity-50"
                      >
                        {savingDriverId === r.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void approve(r.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-500"
                      >
                        <Check size={16} /> Approve
                      </button>
                      <ResetUserPasswordButton
                        apiPath={`/api/drivers/${r.id}/reset-password`}
                        accountLabel={`Set a new password for driver ${r.fullName} (${r.phone}).`}
                      />
                    </div>
                  </td>
                </tr>
                )
              })}
              {pendingPag.total === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={5}>
                    No pending drivers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <ListPagination
            page={pendingPag.page}
            totalPages={pendingPag.totalPages}
            total={pendingPag.total}
            pageSize={pendingPag.pageSize}
            onPageChange={pendingPag.setPage}
          />
        </div>
      </div>

      {isAdmin && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-white">
            Pending branch payments to admin
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Branch managers submitted these payments; approve to settle the branch balance.
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">Submitted by</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingPaymentsPag.pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      No pending branch payments.
                    </td>
                  </tr>
                ) : (
                  pendingPaymentsPag.pageItems.map((p) => (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="px-4 py-3">{p.branchName ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-white">
                        {formatMoneyDisplay(Number(p.amount))}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{p.note ?? '—'}</td>
                      <td className="px-4 py-3">{p.recordedByName}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            disabled={paymentActionId === p.id}
                            onClick={() => void settlePayment(p.id, 'approve')}
                            className="rounded-lg bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={paymentActionId === p.id}
                            onClick={() => void settlePayment(p.id, 'reject')}
                            className="rounded-lg bg-slate-700 px-3 py-1 text-xs text-white hover:bg-slate-600 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <ListPagination
              page={pendingPaymentsPag.page}
              totalPages={pendingPaymentsPag.totalPages}
              total={pendingPaymentsPag.total}
              pageSize={pendingPaymentsPag.pageSize}
              onPageChange={pendingPaymentsPag.setPage}
            />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-xl font-semibold text-white">Approved drivers</h2>
        <p className="mb-3 text-sm text-slate-500">
          {isAdmin
            ? 'Drivers who can sign in and go online for trips at their branch.'
            : 'Drivers at your branch who can sign in and go online for trips.'}
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Online</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvedPag.pageItems.map((r) => {
                const e = getDriverEdit(r)
                return (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">{r.fullName}</td>
                  <td className="px-4 py-3">
                    <input
                      type="tel"
                      className="w-full min-w-[120px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                      value={e.phone}
                      onChange={(ev) => patchDriverEdit(r.id, r, { phone: ev.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="w-full min-w-[100px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                      value={e.vehicleNumber}
                      onChange={(ev) => patchDriverEdit(r.id, r, { vehicleNumber: ev.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
                      value={e.branchId || ''}
                      onChange={(ev) => patchDriverEdit(r.id, r, { branchId: Number(ev.target.value) })}
                    >
                      <option value="">Select branch</option>
                      {branchOptions}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {r.isOnline ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-slate-500">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={savingDriverId === r.id}
                        onClick={() => void saveDriver(r)}
                        className="rounded-lg border border-violet-700/60 px-3 py-1 text-xs text-violet-200 hover:bg-violet-900/40 disabled:opacity-50"
                      >
                        {savingDriverId === r.id ? 'Saving…' : 'Save'}
                      </button>
                      <ResetUserPasswordButton
                        apiPath={`/api/drivers/${r.id}/reset-password`}
                        accountLabel={`Set a new password for driver ${r.fullName} (${r.phone}).`}
                      />
                    </div>
                  </td>
                </tr>
                )
              })}
              {approvedPag.total === 0 && (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={6}>
                    No approved drivers yet. Approve a driver above to see them here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <ListPagination
            page={approvedPag.page}
            totalPages={approvedPag.totalPages}
            total={approvedPag.total}
            pageSize={approvedPag.pageSize}
            onPageChange={approvedPag.setPage}
          />
        </div>
      </div>
    </div>
  )
}

function BranchTable({
  title,
  description,
  rows,
  isAdmin,
  selectedBranchId,
  onSelectSettlement,
  onEdit,
  onRemove,
}: {
  title: string
  description: string
  rows: Branch[]
  isAdmin: boolean
  selectedBranchId: number | null
  onSelectSettlement: (b: Branch) => void
  onEdit: (b: Branch) => void
  onRemove: (id: number) => void
}) {
  const { page, setPage, pageItems, totalPages, total, pageSize } = useListPagination(rows)

  return (
    <div className="mb-8">
      <h3 className="mb-1 text-sm font-semibold text-violet-300">{title}</h3>
      <p className="mb-3 text-xs text-slate-500">{description}</p>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((b) => (
              <tr
                key={b.id}
                className={`border-t border-slate-800 ${selectedBranchId === b.id ? 'bg-violet-950/30' : ''}`}
              >
                <td className="px-4 py-3">{b.branchName}</td>
                <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                <td className="px-4 py-3 text-slate-300">{b.address}</td>
                <td className="px-4 py-3 text-slate-300">
                  {b.settlementType === 'Commission' && b.commissionPercent != null
                    ? `${b.commissionPercent}%`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onSelectSettlement(b)}
                    className="mr-2 rounded-lg border border-violet-700/60 px-2 py-1 text-violet-300 hover:bg-violet-950/50"
                  >
                    Settlement
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(b)}
                        className="mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRemove(b.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-950/40"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {total === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={5}>
                  No branches in this category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
        />
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
  const [formSettlementType, setFormSettlementType] = useState<'Normal' | 'Commission'>('Normal')
  const [formCommissionPercent, setFormCommissionPercent] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null)
  const [settlementFrom, setSettlementFrom] = useState('')
  const [settlementTo, setSettlementTo] = useState('')
  const [settlement, setSettlement] = useState<BranchSettlement | null>(null)
  const [settlementLoading, setSettlementLoading] = useState(false)
  const [settlementError, setSettlementError] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDirection, setPayDirection] = useState<'ToAdmin' | 'FromAdmin'>('ToAdmin')
  const [payNote, setPayNote] = useState('')
  const [paySaving, setPaySaving] = useState(false)
  const [paymentActionId, setPaymentActionId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/branches')
    if (res.ok) {
      const list: Branch[] = await res.json()
      setBranches(list)
      if (!isAdmin && list.length === 1) setSelectedBranchId(list[0].id)
    }
    setLoading(false)
  }, [isAdmin])

  const loadSettlement = useCallback(
    async (branchId: number) => {
      setSettlementLoading(true)
      setSettlementError(null)
      const qs = new URLSearchParams()
      if (settlementFrom) qs.set('fromDate', settlementFrom)
      if (settlementTo) qs.set('toDate', settlementTo)
      const suffix = qs.toString() ? `?${qs}` : ''
      const res = await apiFetch(`/api/branches/${branchId}/settlement${suffix}`)
      setSettlementLoading(false)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSettlementError((j as { error?: string }).error ?? 'Could not load settlement')
        setSettlement(null)
        return
      }
      setSettlement(await res.json())
    },
    [settlementFrom, settlementTo]
  )

  useEffect(() => {
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  useEffect(() => {
    if (selectedBranchId == null) return
    void loadSettlement(selectedBranchId)
  }, [selectedBranchId, loadSettlement])

  if (!isAdmin && !isBranchManager) {
    return <Navigate to="/map" replace />
  }

  const normalBranches = branches.filter(
    (b) => (b.settlementType ?? 'Normal').toLowerCase() !== 'commission'
  )
  const commissionBranches = branches.filter(
    (b) => (b.settlementType ?? '').toLowerCase() === 'commission'
  )

  const resetForm = () => {
    setFormName('')
    setFormCode('')
    setFormAddress('')
    setFormSettlementType('Normal')
    setFormCommissionPercent('')
    setEditingId(null)
    setError(null)
  }

  const startEdit = (b: Branch) => {
    setEditingId(b.id)
    setFormName(b.branchName)
    setFormCode(b.code)
    setFormAddress(b.address)
    setFormSettlementType(
      (b.settlementType ?? 'Normal').toLowerCase() === 'commission' ? 'Commission' : 'Normal'
    )
    setFormCommissionPercent(
      b.commissionPercent != null ? String(b.commissionPercent) : ''
    )
    setError(null)
  }

  const selectSettlement = (b: Branch) => {
    setSelectedBranchId(b.id)
    setPayAmount('')
    setPayNote('')
    setPayDirection('ToAdmin')
    setSettlementError(null)
  }

  const saveBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const commission =
      formSettlementType === 'Commission' && formCommissionPercent.trim() !== ''
        ? Number(formCommissionPercent)
        : null
    const body = JSON.stringify({
      branchName: formName,
      code: formCode,
      address: formAddress,
      settlementType: formSettlementType,
      commissionPercent: commission,
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
    if (selectedBranchId === id) {
      setSelectedBranchId(null)
      setSettlement(null)
    }
    await load()
  }

  const recordPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedBranchId == null) return
    const amount = toMoneyCents(Number(payAmount))
    if (amount <= 0) {
      setSettlementError('Enter a valid payment amount.')
      return
    }
    setPaySaving(true)
    setSettlementError(null)
    const res = await apiFetch(`/api/branches/${selectedBranchId}/settlement/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount,
        direction: payDirection,
        note: payNote.trim() || null,
      }),
    })
    setPaySaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setSettlementError((j as { error?: string }).error ?? 'Could not record payment')
      return
    }
    setSettlement(await res.json())
    setPayAmount('')
    setPayNote('')
  }

  const settlePayment = async (paymentId: number, action: 'approve' | 'reject') => {
    setPaymentActionId(paymentId)
    setSettlementError(null)
    const res = await apiFetch(
      `/api/branches/settlement/payments/${paymentId}/${action}`,
      { method: 'PATCH' }
    )
    setPaymentActionId(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setSettlementError((j as { error?: string }).error ?? `Could not ${action} payment`)
      return
    }
    if (selectedBranchId != null) {
      setSettlement(await res.json())
    }
  }

  const paymentsPag = useListPagination(settlement?.recentPayments ?? [])

  if (loading) return <p className="text-slate-400">Loading...</p>

  const isCommissionSettlement =
    settlement?.settlementType?.toLowerCase() === 'commission'

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Branches</h2>
      <p className="mb-6 text-sm text-slate-400">
        Branches are grouped into two settlement categories.{' '}
        <span className="text-slate-300">Normal</span> branches remit all collections
        (origin and destination) to admin; partial payments are tracked.{' '}
        <span className="text-slate-300">Commission</span> branches remit 100% of origin
        collections; destination delivery earns a commission on shipping price only.
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
            <div>
              <label className="text-sm text-slate-400">Settlement category</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                value={formSettlementType}
                onChange={(e) =>
                  setFormSettlementType(e.target.value as 'Normal' | 'Commission')
                }
              >
                <option value="Normal">Normal — all collections payable to admin</option>
                <option value="Commission">Commission — % on destination delivery only</option>
              </select>
            </div>
            {formSettlementType === 'Commission' && (
              <div>
                <label className="text-sm text-slate-400">Commission % (destination)</label>
                <input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  value={formCommissionPercent}
                  onChange={(e) => setFormCommissionPercent(e.target.value)}
                  required
                  placeholder="e.g. 15"
                />
              </div>
            )}
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

      {!isAdmin && (
        <p className="mb-4 text-sm text-slate-400">
          Branch list is read-only. Open settlement to see collections and record partial
          payments to admin.
        </p>
      )}

      <BranchTable
        title="Category 1 — Normal branches"
        description="All cash collected at origin and destination is payable to admin. Partial payments to admin are tracked."
        rows={normalBranches}
        isAdmin={isAdmin}
        selectedBranchId={selectedBranchId}
        onSelectSettlement={selectSettlement}
        onEdit={startEdit}
        onRemove={remove}
      />

      <BranchTable
        title="Category 2 — Commission branches"
        description="Origin: 100% to admin. Destination: commission on shipping price; branch keeps commission and remits the rest."
        rows={commissionBranches}
        isAdmin={isAdmin}
        selectedBranchId={selectedBranchId}
        onSelectSettlement={selectSettlement}
        onEdit={startEdit}
        onRemove={remove}
      />

      {selectedBranchId != null && (
        <div className="rounded-xl border border-violet-900/50 bg-slate-900/50 p-6">
          <h3 className="mb-1 text-lg font-medium text-white">
            Settlement — {settlement?.branchName ?? '…'}
          </h3>
          <p className="mb-4 text-xs text-slate-500">
            Delivered products only
            {settlementFrom || settlementTo
              ? ` (${settlementFrom || '…'} to ${settlementTo || '…'})`
              : ' (all time)'}
            . Approved payments reduce the balance; branch-manager payments to admin require admin approval.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-400">From</label>
              <input
                type="date"
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                value={settlementFrom}
                onChange={(e) => setSettlementFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">To</label>
              <input
                type="date"
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                value={settlementTo}
                onChange={(e) => setSettlementTo(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => void loadSettlement(selectedBranchId)}
              disabled={settlementLoading}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
            >
              {settlementLoading ? 'Loading…' : 'Apply dates'}
            </button>
          </div>

          {settlementError && (
            <p className="mb-3 text-sm text-red-400">{settlementError}</p>
          )}

          {settlement && !settlementLoading && (
            <>
              <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Collected as origin</p>
                  <p className="text-lg font-semibold text-white">
                    {formatMoneyDisplay(Number(settlement.collectedAsOrigin))}
                  </p>
                  <p className="text-xs text-slate-600">100% payable to admin</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Collected as destination</p>
                  <p className="text-lg font-semibold text-white">
                    {formatMoneyDisplay(Number(settlement.collectedAsDestination))}
                  </p>
                  {isCommissionSettlement && (
                    <p className="text-xs text-slate-600">
                      Shipping:{' '}
                      {formatMoneyDisplay(Number(settlement.destinationShippingTotal))}
                    </p>
                  )}
                </div>
                {isCommissionSettlement && (
                  <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
                    <p className="text-xs text-emerald-400/80">
                      Commission ({settlement.commissionPercent}%)
                    </p>
                    <p className="text-lg font-semibold text-emerald-300">
                      {formatMoneyDisplay(Number(settlement.commissionEarned))}
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-violet-900/40 bg-violet-950/20 p-3">
                  <p className="text-xs text-violet-300/80">Net position</p>
                  <p className="text-lg font-semibold text-violet-200">
                    {formatMoneyDisplay(Number(settlement.netSettlement))}
                  </p>
                  <p className="text-xs text-slate-600">
                    + branch owes admin · − admin owes branch
                  </p>
                </div>
              </div>

              <div className="mb-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
                  <p className="text-sm text-amber-200/90">Due to admin</p>
                  <p className="text-2xl font-bold text-amber-100">
                    {formatMoneyDisplay(Number(settlement.dueToAdmin))}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Paid: {formatMoneyDisplay(Number(settlement.paidToAdmin))}
                    {(settlement.pendingToAdmin ?? 0) > 0 && (
                      <>
                        {' '}
                        · Pending:{' '}
                        {formatMoneyDisplay(Number(settlement.pendingToAdmin))}
                      </>
                    )}
                  </p>
                </div>
                {(isCommissionSettlement || settlement.dueFromAdmin > 0) && (
                  <div className="rounded-lg border border-sky-900/40 bg-sky-950/20 p-4">
                    <p className="text-sm text-sky-200/90">Due from admin</p>
                    <p className="text-2xl font-bold text-sky-100">
                      {formatMoneyDisplay(Number(settlement.dueFromAdmin))}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Paid: {formatMoneyDisplay(Number(settlement.paidFromAdmin))}
                    </p>
                  </div>
                )}
              </div>

              {(settlement.dueToAdmin - (settlement.pendingToAdmin ?? 0) > 0.01 ||
                (isAdmin && settlement.dueFromAdmin > 0)) && (
                <form
                  onSubmit={recordPayment}
                  className="mb-6 rounded-lg border border-slate-800 bg-slate-950/40 p-4"
                >
                  <h4 className="mb-3 text-sm font-medium text-slate-300">
                    Record partial payment
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {isAdmin && settlement.dueFromAdmin > 0 && (
                      <select
                        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                        value={payDirection}
                        onChange={(e) =>
                          setPayDirection(e.target.value as 'ToAdmin' | 'FromAdmin')
                        }
                      >
                        <option value="ToAdmin">Branch pays admin</option>
                        <option value="FromAdmin">Admin pays branch</option>
                      </select>
                    )}
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      placeholder="Amount"
                      className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      placeholder="Note (optional)"
                      className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                      value={payNote}
                      onChange={(e) => setPayNote(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={paySaving}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      {paySaving
                        ? 'Saving…'
                        : isAdmin
                          ? 'Record payment'
                          : 'Submit for approval'}
                    </button>
                  </div>
                  {!isAdmin && (
                    <p className="mt-2 text-xs text-slate-500">
                      Payments to admin are submitted for admin approval before they reduce
                      the balance.
                    </p>
                  )}
                  {isAdmin && (
                    <p className="mt-2 text-xs text-slate-500">
                      Admin-recorded payments (to or from admin) are settled immediately.
                    </p>
                  )}
                </form>
              )}

              {paymentsPag.total > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-slate-400">Recent payments</h4>
                  <ul className="space-y-2 text-sm">
                    {paymentsPag.pageItems.map((p) => {
                      const status = p.status ?? 'Approved'
                      const isPending = status === 'Pending'
                      return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2"
                      >
                        <span>
                          {p.direction === 'ToAdmin' ? '→ Admin' : '← From admin'}{' '}
                          <span className="font-mono text-white">
                            {formatMoneyDisplay(Number(p.amount))}
                          </span>
                          {p.note && (
                            <span className="ml-2 text-slate-500">({p.note})</span>
                          )}
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                              isPending
                                ? 'bg-amber-900/40 text-amber-200'
                                : status === 'Rejected'
                                  ? 'bg-red-900/40 text-red-300'
                                  : 'bg-emerald-900/30 text-emerald-300'
                            }`}
                          >
                            {status}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-slate-500">
                          {new Date(p.createdAt).toLocaleString()} · {p.recordedByName}
                          {isAdmin && isPending && (
                            <>
                              <button
                                type="button"
                                disabled={paymentActionId === p.id}
                                onClick={() => void settlePayment(p.id, 'approve')}
                                className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={paymentActionId === p.id}
                                onClick={() => void settlePayment(p.id, 'reject')}
                                className="rounded bg-slate-700 px-2 py-0.5 text-xs text-white hover:bg-slate-600 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </span>
                      </li>
                    )})}
                  </ul>
                  <ListPagination
                    page={paymentsPag.page}
                    totalPages={paymentsPag.totalPages}
                    total={paymentsPag.total}
                    pageSize={paymentsPag.pageSize}
                    onPageChange={paymentsPag.setPage}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
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

  const staffPag = useListPagination(staffRows)

  if (!isAdmin && !isBranchManager) return <Navigate to="/map" replace />
  if (loading) return <p className="text-slate-400">Loadingâ€¦</p>

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
            {creating ? 'Creatingâ€¦' : 'Create staff'}
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
            {staffPag.pageItems.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{s.fullName}</td>
                <td className="px-4 py-3">{s.phone}</td>
                <td className="px-4 py-3 text-slate-300">{s.branchName ?? 'â€”'}</td>
                <td className="px-4 py-3">
                  {s.isActive ? (
                    <span className="text-emerald-400">Yes</span>
                  ) : (
                    <span className="text-slate-500">No</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setEditing(s)
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <ResetUserPasswordButton
                      apiPath={`/api/staff/${s.id}/reset-password`}
                      accountLabel={`Set a new password for ${s.fullName} (${s.phone}).`}
                    />
                    <button
                      type="button"
                      onClick={() => void removeStaff(s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-950/40"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {staffPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                  No staff accounts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={staffPag.page}
          totalPages={staffPag.totalPages}
          total={staffPag.total}
          pageSize={staffPag.pageSize}
          onPageChange={staffPag.setPage}
        />
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

  const managersPag = useListPagination(rows)

  if (role !== 'Admin') return <Navigate to="/map" replace />
  if (loading) return <p className="text-slate-400">Loadingâ€¦</p>

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
            {creating ? 'Creatingâ€¦' : 'Create branch manager'}
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
            {managersPag.pageItems.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{s.fullName}</td>
                <td className="px-4 py-3">{s.phone}</td>
                <td className="px-4 py-3 text-slate-300">{s.branchName ?? 'â€”'}</td>
                <td className="px-4 py-3">
                  {s.isActive ? (
                    <span className="text-emerald-400">Yes</span>
                  ) : (
                    <span className="text-slate-500">No</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setEditing(s)
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <ResetUserPasswordButton
                      apiPath={`/api/branch-managers/${s.id}/reset-password`}
                      accountLabel={`Set a new password for ${s.fullName} (${s.phone}).`}
                    />
                    <button
                      type="button"
                      onClick={() => void remove(s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-950/40"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {managersPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                  No branch manager accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={managersPag.page}
          totalPages={managersPag.totalPages}
          total={managersPag.total}
          pageSize={managersPag.pageSize}
          onPageChange={managersPag.setPage}
        />
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
              {d.fullName} Â· {d.vehicleNumber} (#{d.driverProfileId})
            </span>
          </Popup>
        </LeafletMarker>
      ))}
    </MapContainer>
  )
}

function LiveMapPage() {
  const envApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim()
  const [dbApiKey, setDbApiKey] = useState<string>('')
  const [drivers, setDrivers] = useState<DriverOnMap[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [connection, setConnection] = useState<HubConnection | null>(null)
  const apiKey = dbApiKey || envApiKey

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
      const res = await apiFetch('/api/tracking/map-settings')
      if (!res.ok) return
      const payload = (await res.json()) as { googleMapsApiKey?: string }
      setDbApiKey((payload.googleMapsApiKey ?? '').trim())
    })()
  }, [])

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
  const driversPag = useListPagination(drivers)

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">Live driver map</h2>
      <p className="mb-4 text-sm text-slate-500">
        SignalR:{' '}
        {connection?.state === HubConnectionState.Connected ? (
          <span className="text-emerald-400">connected</span>
        ) : (
          <span className="text-amber-400">connectingâ€¦</span>
        )}
        {apiKey ? (
          <span className="text-slate-600"> Â· Google Maps</span>
        ) : (
          <span className="text-slate-600"> Â· OpenStreetMap (set VITE_GOOGLE_MAPS_API_KEY for Google tiles)</span>
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
                    title={`${d.fullName} Â· ${d.vehicleNumber} (#${d.driverProfileId})`}
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
            {driversPag.pageItems.map((d) => {
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
                      {d.vehicleNumber} Â· #{d.driverProfileId}
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
            {driversPag.total === 0 && (
              <li className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-slate-500">
                No drivers in scope. Admins see all approved drivers; branch managers and staff see their branch.
                Positions update when drivers run the mobile app with location on.
              </li>
            )}
          </ul>
          <ListPagination
            page={driversPag.page}
            totalPages={driversPag.totalPages}
            total={driversPag.total}
            pageSize={driversPag.pageSize}
            onPageChange={driversPag.setPage}
          />
        </div>
      </div>
    </div>
  )
}

type CustomerRow = {
  phone: string
  senderName: string | null
  senderAddress: string | null
  sentCount: number
  receiverName: string | null
  receiverAddress: string | null
  receivedCount: number
}

function CustomersPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [phoneSearch, setPhoneSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const load = useCallback(async (phone?: string) => {
    setLoading(true)
    setError(null)
    const qs = phone?.trim() ? `?phone=${encodeURIComponent(phone.trim())}` : ''
    const res = await apiFetch(`/api/customers${qs}`)
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not load customers')
      setCustomers([])
      return
    }
    setCustomers(await res.json())
  }, [])

  useEffect(() => {
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPhoneSearch(searchInput.trim())
    void load(searchInput.trim() || undefined)
  }

  const clearSearch = () => {
    setSearchInput('')
    setPhoneSearch('')
    void load()
  }

  const customersPag = useListPagination(customers)

  if (!isAdmin && !isBranchManager) {
    return <Navigate to="/map" replace />
  }

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Customers</h2>
      <p className="mb-6 text-sm text-slate-400">
        {isAdmin
          ? 'All senders and receivers across the network, with shipment counts.'
          : 'Senders and receivers linked to your branch through shipments, with shipment counts.'}
      </p>

      <form onSubmit={runSearch} className="mb-6 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Filter by phone"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500"
        >
          <Search size={16} /> Search
        </button>
        {phoneSearch && (
          <button
            type="button"
            onClick={clearSearch}
            className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <p className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Sender name</th>
                <th className="px-4 py-3">Sender address</th>
                <th className="px-4 py-3 text-right">Sent</th>
                <th className="px-4 py-3">Receiver name</th>
                <th className="px-4 py-3">Receiver address</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {customersPag.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {phoneSearch ? 'No customers match this phone.' : 'No customers yet.'}
                  </td>
                </tr>
              ) : (
                customersPag.pageItems.map((c) => (
                  <tr key={c.phone} className="border-t border-slate-800">
                    <td className="px-4 py-3 font-mono text-emerald-300">{c.phone}</td>
                    <td className="px-4 py-3 text-white">{c.senderName ?? '—'}</td>
                    <td className="max-w-[10rem] truncate px-4 py-3 text-slate-400" title={c.senderAddress ?? undefined}>
                      {c.senderAddress ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white">{c.sentCount}</td>
                    <td className="px-4 py-3 text-white">{c.receiverName ?? '—'}</td>
                    <td className="max-w-[10rem] truncate px-4 py-3 text-slate-400" title={c.receiverAddress ?? undefined}>
                      {c.receiverAddress ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white">{c.receivedCount}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-violet-300">
                      {c.sentCount + c.receivedCount}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <ListPagination
            page={customersPag.page}
            totalPages={customersPag.totalPages}
            total={customersPag.total}
            pageSize={customersPag.pageSize}
            onPageChange={customersPag.setPage}
          />
        </div>
      )}
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
  const [deliverDestinationAmount, setDeliverDestinationAmount] = useState('')
  const [deliverSaving, setDeliverSaving] = useState(false)
  const [searchMode, setSearchMode] = useState<'tracking' | 'phone'>('tracking')
  const [searchInput, setSearchInput] = useState('')
  const [activeSearch, setActiveSearch] = useState<{ mode: 'tracking' | 'phone'; q: string } | null>(
    null,
  )
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (activeSearch?.q) {
      if (activeSearch.mode === 'tracking') params.set('tracking', activeSearch.q)
      else params.set('phone', activeSearch.q)
    }
    const productsPath = params.toString() ? `/api/products?${params}` : '/api/products'
    const [pr, br] = await Promise.all([apiFetch(productsPath), apiFetch('/api/branches')])
    if (pr.ok) setProducts(await pr.json())
    if (br.ok) setBranches(await br.json())
    setLoading(false)
  }, [activeSearch])

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
    const price = toMoneyCents(Number(fd.get('shippingPrice')))
    const originAmount = toMoneyCents(Number(fd.get('amountReceivedAtOrigin')))
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Enter a valid shipping price.')
      return
    }
    if (!Number.isFinite(originAmount) || originAmount < 0 || originAmount > price) {
      setFormError('Origin received amount must be between 0 and shipping price.')
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
      amountReceivedAtOrigin: originAmount,
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
    setDeliverDestinationAmount('')
  }

  const deliverDue = delivering ? Math.max(0, Number(delivering.dueAmount ?? 0)) : 0
  const deliverPhoneMatches =
    !!delivering &&
    deliverReceiverPhone.trim() !== '' &&
    deliverReceiverPhone.trim() === delivering.receiverPhone.trim()
  const deliverAmountMatchesDue =
    deliverDue <= 0 ||
    Math.abs(Number(deliverDestinationAmount || NaN) - deliverDue) < 0.00001
  const canConfirmDeliver = !!delivering && deliverPhoneMatches && deliverAmountMatchesDue

  const confirmDeliver = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!delivering) return
    if (!deliverReceiverPhone.trim()) {
      setFormError('Enter receiver phone for number verification.')
      return
    }
    if (deliverReceiverPhone.trim() !== delivering.receiverPhone.trim()) {
      setFormError('Receiver phone must match this shipment.')
      return
    }
    const due = Math.max(0, delivering.dueAmount)
    const destinationAmount = Number(deliverDestinationAmount || '0')
    if (!Number.isFinite(destinationAmount) || destinationAmount < 0) {
      setFormError('Enter a valid destination received amount.')
      return
    }
    if (due > 0 && Math.abs(destinationAmount - due) > 0.00001) {
      setFormError(`Destination branch must collect full due amount (${due.toFixed(2)}) before delivery.`)
      return
    }
    if (due === 0 && destinationAmount > 0) {
      setFormError('No due amount remains for this product.')
      return
    }
    setDeliverSaving(true)
    const res = await apiFetch(`/api/products/${delivering.id}/deliver`, {
      method: 'PATCH',
      body: JSON.stringify({
        receiverPhone: deliverReceiverPhone.trim(),
        amountReceivedAtDestination: destinationAmount,
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

  const runSearch = () => {
    const q = searchInput.trim()
    if (!q) {
      setActiveSearch(null)
      return
    }
    setActiveSearch({ mode: searchMode, q })
  }

  const clearSearch = () => {
    setSearchInput('')
    setActiveSearch(null)
  }

  const openDetail = async (p: ProductRow) => {
    setDetail(null)
    setDetailLoading(true)
    setFormError(null)
    const res = await apiFetch(`/api/products/${p.id}`)
    setDetailLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setFormError((j as { error?: string }).error ?? 'Could not load product details.')
      return
    }
    setDetail((await res.json()) as ProductDetail)
  }

  const closeDetail = () => setDetail(null)

  const productsPag = useListPagination(products)

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Products</h2>
          <p className="mt-1 text-sm text-slate-400">
            {isBranchManager
              ? 'Shipments linked to your branch (origin, destination, or current location). Reprint QR labels anytime.'
              : 'View, edit, or delete shipments. Click a row for full details. Products on an active trip cannot be deleted.'}
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

      <form
        className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          runSearch()
        }}
      >
        <div className="min-w-[160px]">
          <label className="text-xs text-slate-400">Search by</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as 'tracking' | 'phone')}
          >
            <option value="tracking">Tracking number</option>
            <option value="phone">Sender or receiver phone</option>
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="text-xs text-slate-400">
            {searchMode === 'tracking' ? 'Tracking number' : 'Phone number'}
          </label>
          <input
            type="search"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            placeholder={
              searchMode === 'tracking' ? 'e.g. TN-abc123â€¦' : 'Sender or receiver phone'
            }
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500"
        >
          <Search size={16} /> Search
        </button>
        {activeSearch && (
          <button
            type="button"
            onClick={clearSearch}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Clear
          </button>
        )}
      </form>

      {activeSearch && (
        <p className="no-print mb-3 text-xs text-slate-500">
          Showing results for{' '}
          {activeSearch.mode === 'tracking' ? 'tracking' : 'phone'} &quot;{activeSearch.q}&quot;
        </p>
      )}

      <div className="no-print overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[1320px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="min-w-[10rem] whitespace-nowrap px-4 py-3.5">Tracking</th>
              <th className="min-w-[14rem] px-4 py-3.5">Description</th>
              <th className="min-w-[9rem] whitespace-nowrap px-4 py-3.5">Origin branch</th>
              <th className="min-w-[9rem] whitespace-nowrap px-4 py-3.5">Destination branch</th>
              {isBranchManager && (
                <th className="min-w-[7rem] whitespace-nowrap px-4 py-3.5">Your scope</th>
              )}
              <th className="min-w-[5.5rem] whitespace-nowrap px-4 py-3.5 text-right">Price</th>
              <th className="min-w-[8rem] whitespace-nowrap px-4 py-3.5">Payment mode</th>
              <th className="min-w-[7rem] whitespace-nowrap px-4 py-3.5 text-right">Origin received</th>
              <th className="min-w-[7.5rem] whitespace-nowrap px-4 py-3.5 text-right">Dest. received</th>
              <th className="min-w-[5rem] whitespace-nowrap px-4 py-3.5 text-right">Due</th>
              <th className="min-w-[6.5rem] whitespace-nowrap px-4 py-3.5">Status</th>
              <th className="min-w-[15rem] whitespace-nowrap px-4 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {productsPag.pageItems.map((p) => {
              const badge = getPaymentBadge(p)
              return (
                <tr
                  key={p.id}
                  className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60"
                  onClick={() => void openDetail(p)}
                >
                <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-white">
                  {p.trackingNumber}
                </td>
                <td className="max-w-[18rem] px-4 py-3 leading-snug text-slate-300" title={p.description}>
                  {p.description}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-300">{p.originBranchName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-300">{p.destinationBranchName}</td>
                {isBranchManager && (
                  <td className="whitespace-nowrap px-4 py-3 text-violet-300">{branchScopeText(p)}</td>
                )}
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-300">
                  {p.shippingPrice.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={badge.className}>{badge.label}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-emerald-300">
                  {Number(p.amountReceivedAtOrigin ?? 0).toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-cyan-300">
                  {Number(p.amountReceivedAtDestination ?? 0).toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-amber-300">
                  {Math.max(0, Number(p.dueAmount ?? 0)).toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-400">{p.status}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null)
                      setReprint({ trackingNumber: p.trackingNumber, shippingPrice: p.shippingPrice })
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Printer size={12} /> QR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null)
                      setEditing(p)
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  {p.status === 'Downloaded' && (!isBranchManager || canManagerDeliver(p)) && (
                    <button
                      type="button"
                      onClick={() => openDeliver(p)}
                      className="inline-flex items-center gap-1 rounded border border-emerald-700/50 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/30"
                    >
                      Deliver
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(p)}
                    className="inline-flex items-center gap-1 rounded border border-red-900/40 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-950/30"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                  </div>
                </td>
                </tr>
              )
            })}
            {productsPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={isBranchManager ? 12 : 11}>
                  {activeSearch ? (
                    <>No products match your search.</>
                  ) : (
                    <>
                      No products yet. Use{' '}
                      <Link className="text-violet-400 hover:underline" to="/qr">
                        New product
                      </Link>{' '}
                      to create one.
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={productsPag.page}
          totalPages={productsPag.totalPages}
          total={productsPag.total}
          pageSize={productsPag.pageSize}
          onPageChange={productsPag.setPage}
        />
      </div>

      {(detailLoading || detail) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closeDetail}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading && <p className="text-slate-400">Loading details…</p>}
            {detail && !detailLoading && (
              <>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Product details</h3>
                    <p className="mt-1 font-mono text-sm text-violet-300">{detail.trackingNumber}</p>
                    <p className="text-xs text-slate-500">{detail.status}</p>
                  </div>
                  <button type="button" onClick={closeDetail} className="text-slate-400 hover:text-white">
                    ✕
                  </button>
                </div>

                <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sender</h4>
                  <p className="mt-1 text-sm text-white">{detail.sender.name}</p>
                  <p className="font-mono text-sm text-emerald-300">{detail.sender.phone}</p>
                  <p className="text-xs text-slate-400">{detail.sender.address}</p>
                </section>

                <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receiver</h4>
                  <p className="mt-1 text-sm text-white">{detail.receiver.name}</p>
                  <p className="font-mono text-sm text-emerald-300">{detail.receiver.phone}</p>
                  <p className="text-xs text-slate-400">{detail.receiver.address}</p>
                </section>

                <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branches</h4>
                  <p className="mt-1 text-sm text-slate-200">
                    <span className="text-slate-500">Origin:</span> {detail.originBranchName}
                  </p>
                  <p className="text-sm text-slate-200">
                    <span className="text-slate-500">Destination:</span> {detail.destinationBranchName}
                  </p>
                </section>

                <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Branch managers
                  </h4>
                  {detail.originBranchManager ? (
                    <p className="mt-2 text-sm text-slate-200">
                      <span className="text-slate-500">Origin ({detail.originBranchManager.branchName}):</span>{' '}
                      {detail.originBranchManager.fullName} ·{' '}
                      <span className="font-mono text-emerald-300">{detail.originBranchManager.phone}</span>
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">No branch manager assigned at origin.</p>
                  )}
                  {detail.destinationBranchManager ? (
                    <p className="mt-1 text-sm text-slate-200">
                      <span className="text-slate-500">
                        Destination ({detail.destinationBranchManager.branchName}):
                      </span>{' '}
                      {detail.destinationBranchManager.fullName} ·{' '}
                      <span className="font-mono text-emerald-300">{detail.destinationBranchManager.phone}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">No branch manager assigned at destination.</p>
                  )}
                </section>

                <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver & trip</h4>
                  {detail.trip ? (
                    <>
                      <p className="mt-1 text-sm text-white">{detail.trip.driverName}</p>
                      <p className="font-mono text-sm text-emerald-300">{detail.trip.driverPhone}</p>
                      <p className="text-xs text-slate-400">Vehicle {detail.trip.vehicleNumber}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        Trip {detail.trip.tripId.slice(0, 8)}… · {detail.trip.status} ·{' '}
                        {new Date(detail.trip.loadTime).toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-400">
                        {detail.trip.originBranchName} → {detail.trip.destinationBranchesLabel}
                      </p>
                      <p className="text-xs text-amber-300">
                        Trip pay {Number(detail.trip.driverPaymentAmount).toFixed(2)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Not loaded on a trip yet.</p>
                  )}
                </section>

                <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
                  <p>
                    Shipping {Number(detail.shippingPrice).toFixed(2)} · Due{' '}
                    {Number(detail.dueAmount).toFixed(2)}
                  </p>
                  <p className="mt-1">Created {new Date(detail.createdAt).toLocaleString()}</p>
                </section>
              </>
            )}
          </div>
        </div>
      )}

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
              <div>
                <label className="text-sm text-slate-400">Amount received at origin</label>
                <input
                  name="amountReceivedAtOrigin"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={editing.amountReceivedAtOrigin}
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
            onSubmit={(e) => {
              e.preventDefault()
              if (!canConfirmDeliver || deliverSaving) return
              void confirmDeliver(e)
            }}
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <h3 className="mb-4 text-lg font-medium text-white">Mark as delivered</h3>
            <p className="mb-3 text-sm text-slate-400">
              Tracking: <span className="font-mono text-slate-200">{delivering.trackingNumber}</span>
            </p>
            <p className="mb-4 text-sm text-slate-400">
              Payment:{' '}
              <span className={getPaymentBadge(delivering).className}>{getPaymentBadge(delivering).label}</span>
            </p>
            {deliverDue <= 0 ? (
              <p className="mb-4 rounded-lg border border-emerald-900/40 bg-emerald-950/25 px-3 py-2 text-sm text-emerald-200/90">
                Shipping was paid in full at the origin branch (sender). There is no balance to collect at
                destination â€” only receiver phone verification is required.
              </p>
            ) : (
              <p className="mb-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-100/90">
                Partial payment was taken at origin. Collect the remaining balance from the receiver at this
                branch:{' '}
                <span className="font-mono font-semibold text-amber-200">{deliverDue.toFixed(2)}</span>.
                Enter that full amount below â€” Confirm delivery stays hidden until it matches exactly.
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400">Receiver phone (must match shipment)</label>
                <input
                  value={deliverReceiverPhone}
                  onChange={(e) => setDeliverReceiverPhone(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
                {deliverReceiverPhone.trim() !== '' && !deliverPhoneMatches && (
                  <p className="mt-1 text-xs text-amber-400">Phone must match the receiver phone on file.</p>
                )}
              </div>

              {deliverDue > 0 && (
                <div>
                  <label className="text-sm text-slate-400">Amount received at destination (full due)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={deliverDestinationAmount}
                    onChange={(e) => setDeliverDestinationAmount(e.target.value)}
                    placeholder={deliverDue.toFixed(2)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  />
                  {!deliverAmountMatchesDue && deliverDestinationAmount.trim() !== '' && (
                    <p className="mt-1 text-xs text-amber-400">
                      Enter exactly {deliverDue.toFixed(2)} to enable Confirm delivery.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {canConfirmDeliver && (
                <button
                  type="submit"
                  disabled={deliverSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {deliverSaving ? 'Saving…' : 'Confirm delivery'}
                </button>
              )}
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
  const [paymentMode, setPaymentMode] = useState<'sender_full' | 'sender_partial' | 'receiver_full'>('sender_full')
  const [originReceivedAmount, setOriginReceivedAmount] = useState('')
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
    const price = toMoneyCents(Number(shippingPrice))
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Enter a valid shipping price (0 or greater).')
      return
    }
    let originAmount = 0
    if (paymentMode === 'sender_full') originAmount = price
    else if (paymentMode === 'receiver_full') originAmount = 0
    else {
      originAmount = toMoneyCents(Number(originReceivedAmount))
      if (!Number.isFinite(originAmount) || originAmount <= 0 || originAmount >= price) {
        setFormError('For partial sender payment, origin received amount must be greater than 0 and less than shipping price.')
        return
      }
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
        amountReceivedAtOrigin: originAmount,
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
              <option value="">No branches â€” add branches first</option>
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
              <option value="">No branches â€” add branches first</option>
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
        <div className="md:col-span-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="mb-2 text-sm text-slate-300">Who is paying the product price?</p>
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === 'sender_full'}
              onChange={() => setPaymentMode('sender_full')}
            />
            Paid fully by sender
          </label>
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === 'sender_partial'}
              onChange={() => setPaymentMode('sender_partial')}
            />
            Paid partially by sender
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="radio"
              name="paymentMode"
              checked={paymentMode === 'receiver_full'}
              onChange={() => setPaymentMode('receiver_full')}
            />
            Receiver will pay full amount at destination
          </label>
          {paymentMode === 'sender_partial' && (
            <div className="mt-3 max-w-sm">
              <label className="text-sm text-slate-400">Amount received at origin branch</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                value={originReceivedAmount}
                onChange={(e) => setOriginReceivedAmount(e.target.value)}
                placeholder="e.g. 100.00"
                required={paymentMode === 'sender_partial'}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end gap-2 md:col-span-2">
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting || branches.length === 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {submitting ? 'Creatingâ€¦' : 'Create product'}
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
  collectedAsOrigin: number
  collectedAsDestination: number
  totalCollection: number
}

type BookingsByDestinationRow = {
  destinationBranchId: number
  destinationBranchName: string
  productCount: number
  totalShippingPrice: number
}

type BookingsByDestinationReport = {
  originBranchId: number
  originBranchName: string
  rows: BookingsByDestinationRow[]
}

function ReportsPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBranchManager = role === 'BranchManager'
  const [rows, setRows] = useState<CollectionRow[]>([])
  const [paymentRows, setPaymentRows] = useState<ProductRow[]>([])
  const [bookingReport, setBookingReport] = useState<BookingsByDestinationReport | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [reportBranches, setReportBranches] = useState<Branch[]>([])
  const [bookingOriginId, setBookingOriginId] = useState(0)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const openNativeDatePicker = (el: HTMLInputElement) => {
    const pickerInput = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof pickerInput.showPicker === 'function') pickerInput.showPicker()
  }

  useEffect(() => {
    if (!isAdmin) return
    void (async () => {
      const r = await apiFetch('/api/branches')
      if (!r.ok) return
      const list: Branch[] = await r.json()
      setReportBranches(list)
      setBookingOriginId((prev) => (prev > 0 ? prev : list[0]?.id ?? 0))
    })()
  }, [isAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setBookingError(null)
    const params = new URLSearchParams()
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const query = params.toString()
    const [collectionRes, productRes] = await Promise.all([
      apiFetch(`/api/reports/branch-collections${query ? `?${query}` : ''}`),
      apiFetch('/api/products'),
    ])
    if (!collectionRes.ok) {
      const j = await collectionRes.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not load report.')
      setRows([])
    } else {
      setRows(await collectionRes.json())
    }
    if (productRes.ok) {
      const list = (await productRes.json()) as ProductRow[]
      setPaymentRows(
        list
          .filter((p) => p.status === 'Delivered')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      )
    } else {
      setPaymentRows([])
    }

    setBookingReport(null)
    if (isBranchManager || (isAdmin && bookingOriginId > 0)) {
      const bp = new URLSearchParams()
      if (fromDate) bp.set('fromDate', fromDate)
      if (toDate) bp.set('toDate', toDate)
      if (isAdmin) bp.set('originBranchId', String(bookingOriginId))
      const bq = bp.toString()
      const bookingRes = await apiFetch(`/api/reports/bookings-by-destination${bq ? `?${bq}` : ''}`)
      if (!bookingRes.ok) {
        const j = await bookingRes.json().catch(() => ({}))
        setBookingError((j as { error?: string }).error ?? 'Could not load bookings by destination.')
      } else {
        setBookingReport((await bookingRes.json()) as BookingsByDestinationReport)
      }
    }

    setLoading(false)
  }, [fromDate, toDate, bookingOriginId, isAdmin, isBranchManager])

  useEffect(() => {
    if (!isAdmin && !isBranchManager) return
    void load()
  }, [load, isAdmin, isBranchManager])

  const collectionsPag = useListPagination(rows)
  const bookingPag = useListPagination(bookingReport?.rows ?? [])
  const paymentPag = useListPagination(paymentRows)

  if (!isAdmin && !isBranchManager) return <Navigate to="/map" replace />

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Delivered collection by branch</h2>
      <p className="mb-6 text-sm text-slate-400">
        For each branch: amounts collected when it was the booking (origin) branch plus when it was the destination
        branch, counting only shipments with Delivered status in the date range (by delivery date).
        {isBranchManager && ' Your view is limited to your branch.'}
      </p>
      {isAdmin && reportBranches.length > 0 && (
        <div className="mb-6 max-w-md rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <label className="text-sm text-slate-400">Booking volume report â€” sending (origin) branch</label>
          <select
            value={bookingOriginId}
            onChange={(e) => setBookingOriginId(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          >
            {reportBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branchName} ({b.code})
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            Counts only <strong className="text-slate-400">Pending</strong> parcels still at the origin (not yet on a
            trip), grouped by destination â€” same date range as below, by booking date.
          </p>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void load()
        }}
        className="mb-6 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 md:grid-cols-[1fr_1fr_auto_auto]"
      >
        <p className="md:col-span-4 text-xs text-slate-500">
          Date range applies to <strong className="text-slate-400">delivered collection</strong> by delivery date and
          to <strong className="text-slate-400">pending routing report</strong> by booking date (when the product was
          created). Routing counts only <strong className="text-slate-400">Pending</strong> status at the origin.
        </p>
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
      {bookingError && (
        <p className="mb-4 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
          {bookingError}
        </p>
      )}
      {loading && <p className="mb-4 text-slate-400">Loadingâ€¦</p>}
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3 text-right">Collected as origin</th>
              <th className="px-4 py-3 text-right">Collected as destination</th>
              <th className="px-4 py-3 text-right">Total collection</th>
            </tr>
          </thead>
          <tbody>
            {collectionsPag.pageItems.map((r) => (
              <tr key={r.branchId} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-200">{r.branchName}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-200">
                  {Number(r.collectedAsOrigin ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cyan-200">
                  {Number(r.collectedAsDestination ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-100">
                  {Number(r.totalCollection).toFixed(2)}
                </td>
              </tr>
            ))}
            {collectionsPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                  No delivered shipments yet for this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={collectionsPag.page}
          totalPages={collectionsPag.totalPages}
          total={collectionsPag.total}
          pageSize={collectionsPag.pageSize}
          onPageChange={collectionsPag.setPage}
        />
      </div>

      <div className="mt-8 overflow-x-auto rounded-xl border border-slate-800">
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Pending at origin â€” by destination (routing priority)</h3>
          <p className="mt-1 text-xs text-slate-400">
            From your sending branch: how many <span className="text-slate-300">Pending</span> parcels (still at
            origin, not loaded on a trip) are destined for each branch in the date range (by{' '}
            <span className="text-slate-300">booking date</span>). Highest counts first â€” prioritize routes and hubs
            with the largest backlog.
            {isBranchManager && ' Your branch is always the origin for this table.'}
          </p>
          {bookingReport && (
            <p className="mt-2 text-xs text-violet-300">
              Origin: <span className="font-medium text-white">{bookingReport.originBranchName}</span>
            </p>
          )}
        </div>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Destination branch</th>
              <th className="px-4 py-3 text-right">Pending products</th>
              <th className="px-4 py-3 text-right">Total shipping (sum)</th>
            </tr>
          </thead>
          <tbody>
            {bookingPag.pageItems.map((r, idx) => {
              const globalIdx = (bookingPag.page - 1) * bookingPag.pageSize + idx
              return (
              <tr key={r.destinationBranchId} className="border-t border-slate-800">
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex min-w-[2rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      globalIdx === 0
                        ? 'bg-violet-600 text-white'
                        : globalIdx === 1
                          ? 'bg-slate-600 text-white'
                          : globalIdx === 2
                            ? 'bg-amber-800/80 text-amber-100'
                            : 'border border-slate-600 text-slate-400'
                    }`}
                  >
                    #{globalIdx + 1}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-200">{r.destinationBranchName}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-100">{r.productCount}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-200/90">
                  {formatMoneyDisplay(Number(r.totalShippingPrice))}
                </td>
              </tr>
              )
            })}
            {bookingPag.total === 0 && !loading && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                  No pending products at this origin for the selected date range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={bookingPag.page}
          totalPages={bookingPag.totalPages}
          total={bookingPag.total}
          pageSize={bookingPag.pageSize}
          onPageChange={bookingPag.setPage}
        />
      </div>

      <div className="mt-8 overflow-x-auto rounded-xl border border-slate-800">
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Delivered products payment report</h3>
          <p className="mt-1 text-xs text-slate-400">
            Shows booking branch and amount received at origin and destination for each delivered product.
          </p>
        </div>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Tracking</th>
              <th className="px-4 py-3">Booked (origin)</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3">Payment status</th>
              <th className="px-4 py-3 text-right">Shipping</th>
              <th className="px-4 py-3 text-right">Origin received</th>
              <th className="px-4 py-3 text-right">Destination received</th>
            </tr>
          </thead>
          <tbody>
            {paymentPag.pageItems.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="px-4 py-3 font-mono text-xs text-slate-200">{p.trackingNumber}</td>
                <td className="px-4 py-3 text-slate-200">{p.originBranchName}</td>
                <td className="px-4 py-3 text-slate-200">{p.destinationBranchName}</td>
                <td className="px-4 py-3">
                  <span className={getPaymentBadge(p).className}>{getPaymentBadge(p).label}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-100">{Number(p.shippingPrice).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-300">
                  {Number(p.amountReceivedAtOrigin ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cyan-300">
                  {Number(p.amountReceivedAtDestination ?? 0).toFixed(2)}
                </td>
              </tr>
            ))}
            {paymentPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                  No delivered product payment data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={paymentPag.page}
          totalPages={paymentPag.totalPages}
          total={paymentPag.total}
          pageSize={paymentPag.pageSize}
          onPageChange={paymentPag.setPage}
        />
      </div>
    </div>
  )
}

function ConfigurationPage() {
  const role = localStorage.getItem('transport_role')
  const [apiKey, setApiKey] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await apiFetch('/api/configurations/GoogleMapsApiKey')
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not load configuration.')
      setLoading(false)
      return
    }
    const row = (await res.json()) as {
      configKey: string
      configValue: string
      updatedAt: string
    }
    setApiKey(row.configValue ?? '')
    setUpdatedAt(row.updatedAt ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (role !== 'Admin') return
    void load()
  }, [role, load])

  if (role !== 'Admin') return <Navigate to="/map" replace />
  if (loading) return <p className="text-slate-400">Loadingâ€¦</p>

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    const res = await apiFetch('/api/configurations/GoogleMapsApiKey', {
      method: 'PUT',
      body: JSON.stringify({ configValue: apiKey }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not save configuration.')
      return
    }
    const row = (await res.json()) as { updatedAt: string }
    setUpdatedAt(row.updatedAt ?? null)
    setSuccess('Configuration saved.')
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-white">System configuration</h2>
      <p className="mb-6 text-sm text-slate-400">
        Admin-only settings stored in the database.
      </p>
      <form
        onSubmit={save}
        className="rounded-xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <label className="text-sm text-slate-300">Google Maps API key</label>
        <input
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="AIza..."
          required
        />
        <p className="mt-2 text-xs text-slate-500">
          Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : 'N/A'}
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {success && <p className="mt-3 text-sm text-emerald-400">{success}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  )
}

type TripRow = {
  id: string
  driverProfileId: number
  driverName: string
  vehicleNumber: string
  originBranchId: number
  originBranchName: string
  destinationBranchIds: number[]
  destinationBranchesLabel: string
  status: string
  driverPaymentAmount: number
  productCount: number
  inTransitCount: number
  loadTime: string
}

type ApprovedDriverPick = {
  id: number
  fullName: string
  vehicleNumber: string
  branchId: number | null
}

function TripsPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBm = role === 'BranchManager'
  const [trips, setTrips] = useState<TripRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [drivers, setDrivers] = useState<ApprovedDriverPick[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [driverId, setDriverId] = useState(0)
  const [destIds, setDestIds] = useState<number[]>([])
  const [originId, setOriginId] = useState(0)
  const [payment, setPayment] = useState('')
  const [editing, setEditing] = useState<TripRow | null>(null)
  const [editDestIds, setEditDestIds] = useState<number[]>([])

  const managerOriginId = Number(localStorage.getItem('transport_branch_id')) || 0
  const originForDestChoices = isAdmin ? originId : managerOriginId

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [tRes, bRes, dRes] = await Promise.all([
      apiFetch('/api/trips'),
      apiFetch('/api/branches'),
      apiFetch('/api/drivers/approved'),
    ])
    if (tRes.ok) setTrips(await tRes.json())
    else {
      setTrips([])
      const j = await tRes.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not load trips.')
    }
    if (bRes.ok) {
      const list = (await bRes.json()) as Branch[]
      setBranches(list)
      if (isAdmin && list.length > 0)
        setOriginId((prev) => (prev > 0 ? prev : list[0].id))
    }
    if (dRes.ok) {
      const list = (await dRes.json()) as {
        id: number
        fullName: string
        vehicleNumber: string
        branchId: number | null
      }[]
      setDrivers(list.map((d) => ({ id: d.id, fullName: d.fullName, vehicleNumber: d.vehicleNumber, branchId: d.branchId })))
    }
    setLoading(false)
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin && !isBm) return
    void load()
  }, [load, isAdmin, isBm])

  useEffect(() => {
    if (!isAdmin) return
    setDestIds((prev) => prev.filter((id) => id !== originId))
  }, [isAdmin, originId])

  if (!isAdmin && !isBm) return <Navigate to="/map" replace />

  const createTrip = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const amt = toMoneyCents(Number(payment))
    if (!driverId || destIds.length === 0) {
      setError('Select driver and at least one destination branch.')
      return
    }
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Enter a valid trip payment amount.')
      return
    }
    setSaving(true)
    const body: Record<string, unknown> = {
      driverProfileId: driverId,
      destinationBranchIds: [...destIds].sort((a, b) => a - b),
      driverPaymentAmount: amt,
    }
    if (isAdmin) body.originBranchId = originId
    const res = await apiFetch('/api/trips', { method: 'POST', body: JSON.stringify(body) })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not create trip.')
      return
    }
    setPayment('')
    setDestIds([])
    await load()
  }

  const openEdit = (t: TripRow) => {
    setEditing(t)
    setEditDestIds([...t.destinationBranchIds])
    setError(null)
  }

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editing) return
    setError(null)
    if (editDestIds.length === 0) {
      setError('Select at least one destination branch.')
      return
    }
    const fd = new FormData(e.currentTarget)
    const dId = Number(fd.get('editDriverId'))
    const amt = toMoneyCents(Number(fd.get('driverPayment')))
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Enter a valid trip payment amount.')
      return
    }
    setSaving(true)
    const res = await apiFetch(`/api/trips/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        driverProfileId: dId,
        destinationBranchIds: [...editDestIds].sort((a, b) => a - b),
        driverPaymentAmount: amt,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not update trip.')
      return
    }
    setEditing(null)
    await load()
  }

  const branchOpts = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.branchName} ({b.code})
    </option>
  ))

  const driverOpts = drivers.map((d) => (
    <option key={d.id} value={d.id}>
      {d.fullName} Â· {d.vehicleNumber}
    </option>
  ))

  const tripsPag = useListPagination(trips)

  if (loading) return <p className="text-slate-400">Loadingâ€¦</p>

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Trips</h2>
      <p className="mb-6 text-sm text-slate-400">
        Pick one or more destination hubs for the same trip. Staff can then load pending parcels booked to any of those
        hubs (including mixing destinations across scans). The driver starts the trip from the driver app when ready
        (GPS on); after that, staff no longer see the trip for loading. When all parcels are unloaded, trip pay is
        credited to the driver&apos;s earnings.
      </p>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form
        onSubmit={createTrip}
        className="mb-10 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-6 md:grid-cols-2"
      >
        <h3 className="text-lg font-medium text-white md:col-span-2">Create trip</h3>
        {isAdmin && (
          <div>
            <label className="text-sm text-slate-400">Origin branch</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={originId || ''}
              onChange={(e) => setOriginId(Number(e.target.value))}
              required
            >
              {branches.length === 0 ? <option value="">No branches</option> : branchOpts}
            </select>
          </div>
        )}
        <div>
          <label className="text-sm text-slate-400">Driver</label>
          <select
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={driverId || ''}
            onChange={(e) => setDriverId(Number(e.target.value))}
            required
          >
            <option value="">Select driver</option>
            {driverOpts}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-sm text-slate-400">Destination branches (select any)</label>
          <div className="mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-3">
            {branches
              .filter((b) => b.id !== originForDestChoices)
              .map((b) => {
                const checked = destIds.includes(b.id)
                return (
                  <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDestIds((prev) => (prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id]))
                      }
                    />
                    {b.branchName} ({b.code})
                  </label>
                )
              })}
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-400">Trip payment (driver)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div className="flex items-end md:col-span-2">
          <button
            type="submit"
            disabled={saving || branches.length === 0}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create trip'}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Origin â†’ dest</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Payment</th>
              <th className="px-4 py-3 text-right">Products</th>
              <th className="px-4 py-3 text-right">In transit</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {tripsPag.pageItems.map((t) => (
              <tr key={t.id} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-300">{new Date(t.loadTime).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-200">
                  {t.driverName}
                  <span className="block text-xs text-slate-500">{t.vehicleNumber}</span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {t.originBranchName} â†’ {t.destinationBranchesLabel}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      t.status === 'Completed'
                        ? 'bg-slate-700 text-slate-200'
                        : t.status === 'AwaitingLoad'
                          ? 'bg-amber-900/50 text-amber-200'
                          : 'bg-emerald-900/40 text-emerald-200'
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-100">
                  {formatMoneyDisplay(Number(t.driverPaymentAmount))}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{t.productCount}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{t.inTransitCount}</td>
                <td className="px-4 py-3 text-right">
                  {t.status !== 'Completed' && (
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      className="text-violet-400 hover:text-violet-300"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tripsPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                  No trips yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={tripsPag.page}
          totalPages={tripsPag.totalPages}
          total={tripsPag.total}
          pageSize={tripsPag.pageSize}
          onPageChange={tripsPag.setPage}
        />
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-6 shadow-xl"
          >
            <h3 className="mb-4 text-lg font-semibold text-white">Edit trip</h3>
            <p className="mb-4 text-xs text-slate-500">
              Driver and destination list can only be changed before any products are loaded. After load, only payment
              may be updated if the API allows.
            </p>
            <div className="mb-4">
              <label className="text-sm text-slate-400">Driver</label>
              <select
                name="editDriverId"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                defaultValue={editing.driverProfileId}
              >
                {driverOpts}
              </select>
            </div>
            <div className="mb-4">
              <label className="text-sm text-slate-400">Destination branches</label>
              <div className="mt-2 flex max-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-3">
                {branches
                  .filter((b) => b.id !== editing.originBranchId)
                  .map((b) => (
                    <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={editDestIds.includes(b.id)}
                        onChange={() =>
                          setEditDestIds((prev) =>
                            prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id],
                          )
                        }
                      />
                      {b.branchName} ({b.code})
                    </label>
                  ))}
              </div>
            </div>
            <div className="mb-4">
              <label className="text-sm text-slate-400">Trip payment</label>
              <input
                name="driverPayment"
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                defaultValue={editing.driverPaymentAmount}
                required
              />
            </div>
            <div className="flex flex-wrap gap-2">
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
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300"
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

type EarningsRow = {
  driverProfileId: number
  fullName: string
  vehicleNumber: string
  branchId: number | null
  branchName: string | null
  accruedTripEarnings: number
  paidToDriver: number
  due: number
}

function DriverEarningsPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const isBm = role === 'BranchManager'
  const [rows, setRows] = useState<EarningsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payOpen, setPayOpen] = useState<EarningsRow | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [paySaving, setPaySaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await apiFetch('/api/drivers/earnings')
    if (res.ok) setRows(await res.json())
    else {
      setRows([])
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not load earnings.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAdmin && !isBm) return
    void load()
  }, [load, isAdmin, isBm])

  if (!isAdmin && !isBm) return <Navigate to="/map" replace />

  const submitPay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payOpen) return
    const amt = toMoneyCents(Number(payAmount))
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid payment amount.')
      return
    }
    if (amt > payOpen.due + 0.0001) {
      setError('Amount cannot exceed due.')
      return
    }
    setPaySaving(true)
    setError(null)
    const res = await apiFetch(`/api/drivers/${payOpen.driverProfileId}/pay-earnings`, {
      method: 'POST',
      body: JSON.stringify({ amount: amt }),
    })
    setPaySaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Payment failed.')
      return
    }
    setPayOpen(null)
    setPayAmount('')
    await load()
  }

  const earningsPag = useListPagination(rows)

  if (loading) return <p className="text-slate-400">Loadingâ€¦</p>

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Driver earnings</h2>
      <p className="mb-6 text-sm text-slate-400">
        Accrued amounts are added when a trip is completed (all parcels unloaded at destination). Record payouts here;
        due is accrued minus paid.
      </p>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3 text-right">Accrued</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3 text-right">Due</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {earningsPag.pageItems.map((r) => (
              <tr key={r.driverProfileId} className="border-t border-slate-800">
                <td className="px-4 py-3 text-slate-200">
                  {r.fullName}
                  <span className="block text-xs text-slate-500">{r.vehicleNumber}</span>
                </td>
                <td className="px-4 py-3 text-slate-400">{r.branchName ?? 'â€”'}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-200/90">
                  {formatMoneyDisplay(Number(r.accruedTripEarnings))}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">
                  {formatMoneyDisplay(Number(r.paidToDriver))}
                </td>
                <td className="px-4 py-3 text-right font-mono text-amber-200">
                  {formatMoneyDisplay(Number(r.due))}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.due > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPayOpen(r)
                        setPayAmount(String(r.due))
                        setError(null)
                      }}
                      className="text-violet-400 hover:text-violet-300"
                    >
                      Pay
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {earningsPag.total === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                  No drivers in scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ListPagination
          page={earningsPag.page}
          totalPages={earningsPag.totalPages}
          total={earningsPag.total}
          pageSize={earningsPag.pageSize}
          onPageChange={earningsPag.setPage}
        />
      </div>

      {payOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={submitPay} className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-950 p-6">
            <h3 className="mb-2 text-lg font-semibold text-white">Pay {payOpen.fullName}</h3>
            <p className="mb-4 text-xs text-slate-500">Due: {formatMoneyDisplay(Number(payOpen.due))}</p>
            <label className="text-sm text-slate-400">Amount</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
            />
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={paySaving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {paySaving ? 'Saving…' : 'Record payment'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPayOpen(null)
                  setPayAmount('')
                }}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300"
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

function AccountPage() {
  const role = localStorage.getItem('transport_role')
  const isAdmin = role === 'Admin'
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [profileLoading, setProfileLoading] = useState(isAdmin)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    void (async () => {
      setProfileLoading(true)
      const res = await apiFetch('/api/auth/me/account')
      if (res.ok) {
        const data = (await res.json()) as { fullName: string; phone: string; email: string | null }
        setFullName(data.fullName)
        setPhone(data.phone)
        setEmail(data.email ?? '')
      }
      setProfileLoading(false)
    })()
  }, [isAdmin])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdmin) return
    setProfileError(null)
    setProfileSuccess(false)
    setProfileSaving(true)
    const res = await apiFetch('/api/auth/me/account', {
      method: 'PATCH',
      body: JSON.stringify({ phone: phone.trim(), email: email.trim() || null }),
    })
    setProfileSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setProfileError((j as { error?: string }).error ?? 'Could not save profile.')
      return
    }
    const data = (await res.json()) as { fullName: string; phone: string; email: string | null }
    setFullName(data.fullName)
    setPhone(data.phone)
    setEmail(data.email ?? '')
    setProfileSuccess(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    setSaving(true)
    const res = await apiFetch('/api/auth/me/password', {
      method: 'PATCH',
      body: JSON.stringify({
        currentPassword,
        newPassword,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError((j as { error?: string }).error ?? 'Could not change password.')
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setSuccess(true)
  }

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Account</h2>
      <p className="mb-6 text-sm text-slate-400">
        {isAdmin
          ? 'Update your contact details and password. Your email is used for password recovery.'
          : 'Update the password you use to sign in.'}
      </p>

      {isAdmin && (
        <form
          onSubmit={saveProfile}
          className="mb-8 max-w-md rounded-xl border border-slate-800 bg-slate-900/40 p-6"
        >
          <h3 className="mb-4 text-sm font-medium text-slate-300">Admin profile</h3>
          {profileLoading ? (
            <p className="text-slate-400">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400">Full name</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-400"
                  value={fullName}
                  readOnly
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Mobile number / login ID</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm text-slate-400">Email (for password reset)</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            </div>
          )}
          {profileError && <p className="mt-4 text-sm text-red-400">{profileError}</p>}
          {profileSuccess && <p className="mt-4 text-sm text-emerald-400">Profile saved.</p>}
          <button
            type="submit"
            disabled={profileSaving || profileLoading}
            className="mt-6 rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {profileSaving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}

      <form
        onSubmit={submit}
        className="max-w-md rounded-xl border border-slate-800 bg-slate-900/40 p-6"
      >
        <h3 className="mb-4 text-sm font-medium text-slate-300">Change password</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-400">Current password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">New password</label>
            <input
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div>
            <label className="text-sm text-slate-400">Confirm new password</label>
            <input
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {success && (
          <p className="mt-4 text-sm text-emerald-400">Password updated successfully.</p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="mt-6 rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}

function ApprovalsRoute() {
  const role = localStorage.getItem('transport_role')
  if (role !== 'Admin' && role !== 'BranchManager') return <Navigate to="/map" replace />
  return <ApprovalsPage />
}

function HomePage() {
  const role = localStorage.getItem('transport_role')
  if (role === 'Admin') return <Navigate to="/approvals" replace />
  if (role === 'BranchManager') return <Navigate to="/reports" replace />
  return <Navigate to="/map" replace />
}

function DashboardRoutes() {
  if (!useAuth()) return <Navigate to="/login" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/approvals" element={<ApprovalsRoute />} />
        <Route path="/map" element={<LiveMapPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/branch-managers" element={<BranchManagersPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/qr" element={<QrLabelPage />} />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/driver-earnings" element={<DriverEarningsPage />} />
        <Route path="/configuration" element={<ConfigurationPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/*" element={<DashboardRoutes />} />
      </Routes>
    </BrowserRouter>
  )
}
