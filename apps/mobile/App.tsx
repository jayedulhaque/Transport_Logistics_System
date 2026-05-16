import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import * as Location from 'expo-location';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
} from '@microsoft/signalr';
import { StatusBar } from 'expo-status-bar';

const apiBase = () =>
  (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000').replace(/\/$/, '');

async function apiFetch(path: string, opts: RequestInit = {}, token?: string | null) {
  const headers = new Headers(opts.headers as HeadersInit);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  return fetch(`${apiBase()}${path}`, { ...opts, headers });
}

type Screen =
  | 'home'
  | 'driverRegister'
  | 'driverLogin'
  | 'driverWait'
  | 'driverTrack'
  | 'driverProfile'
  | 'staffLogin'
  | 'staffDrivers'
  | 'staffScan'
  | 'staffUnload';

type BranchOption = {
  id: number;
  branchName: string;
  code: string;
};

function normalizeMobile(input: string): string {
  return input.replace(/\D/g, '');
}

function ChangePasswordForm({ token }: { token: string }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (newPassword.length < 6) {
      Alert.alert('Validation', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation', 'New password and confirmation do not match.');
      return;
    }
    setSaving(true);
    const res = await apiFetch(
      '/api/auth/me/password',
      {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      },
      token
    );
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      Alert.alert('Could not update', (j as { error?: string }).error ?? 'Request failed');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    Alert.alert('Password updated', 'Use your new password next time you sign in.');
  };

  return (
    <View style={styles.passwordBlock}>
      <Text style={styles.sectionTitle}>Change password</Text>
      <Text style={styles.label}>Current password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={currentPassword}
        onChangeText={setCurrentPassword}
        autoCapitalize="none"
      />
      <Text style={styles.label}>New password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={newPassword}
        onChangeText={setNewPassword}
        autoCapitalize="none"
      />
      <Text style={styles.label}>Confirm new password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        autoCapitalize="none"
      />
      <AppButton
        title={saving ? 'Updating…' : 'Update password'}
        disabled={saving}
        variant="secondary"
        onPress={() => void submit()}
      />
    </View>
  );
}

function isValidMobile(input: string): boolean {
  const n = normalizeMobile(input);
  return n.length >= 9 && n.length <= 15;
}

function confirmLogout(onConfirm: () => void) {
  Alert.alert('Log out?', 'You will need to sign in again.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: onConfirm },
  ]);
}

function branchLabel(b: BranchOption): string {
  return `${b.branchName} (${b.code})`;
}

function BranchDropdown({
  branches,
  value,
  onChange,
  placeholder = 'Select branch',
  disabled = false,
}: {
  branches: BranchOption[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = branches.find((b) => b.id === value);

  return (
    <>
      <Pressable
        disabled={disabled || branches.length === 0}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.dropdown,
          (disabled || branches.length === 0) && styles.dropdownDisabled,
          pressed && !disabled && styles.dropdownPressed,
        ]}
      >
        <Text style={[styles.dropdownText, !selected && styles.dropdownPlaceholder]} numberOfLines={1}>
          {selected ? branchLabel(selected) : placeholder}
        </Text>
        <Text style={styles.dropdownChevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.dropdownSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.dropdownSheetTitle}>Home branch</Text>
            <ScrollView style={styles.dropdownList} keyboardShouldPersistTaps="handled">
              {branches.map((b) => {
                const isSelected = b.id === value;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => {
                      onChange(b.id);
                      setOpen(false);
                    }}
                    style={[styles.dropdownOption, isSelected && styles.dropdownOptionSelected]}
                  >
                    <Text style={[styles.dropdownOptionText, isSelected && styles.dropdownOptionTextSelected]}>
                      {branchLabel(b)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

type DriverProfileData = {
  driverProfileId: number;
  userId: number;
  fullName: string;
  phone: string;
  vehicleNumber: string;
  branchId: number | null;
  branchName: string | null;
  isApproved: boolean;
};

type DriverEarningsData = {
  accruedTripEarnings: number;
  paidToDriver: number;
  due: number;
};

function DriverEarningsCard({ token, refreshKey = 0 }: { token: string; refreshKey?: number }) {
  const [earnings, setEarnings] = useState<DriverEarningsData | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/drivers/me/earnings', {}, token);
    if (res.ok) setEarnings(await res.json());
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!earnings) return null;

  const due = Number(earnings.due ?? 0);
  const accrued = Number(earnings.accruedTripEarnings ?? 0);
  const paid = Number(earnings.paidToDriver ?? 0);

  return (
    <View style={styles.earningsCard}>
      <Text style={styles.earningsTitle}>Trip earnings</Text>
      <Text style={styles.earningsDueLabel}>Amount due to you</Text>
      <Text style={styles.earningsDueValue}>{due.toFixed(2)}</Text>
      <Text style={styles.earningsMeta}>
        Total earned {accrued.toFixed(2)} · Paid {paid.toFixed(2)}
      </Text>
    </View>
  );
}

function AppButton({
  title,
  onPress,
  variant = 'primary',
  compact = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btnBase,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'danger' && styles.btnDanger,
        compact && styles.btnCompact,
        disabled && { opacity: 0.45 },
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={[styles.btnText, variant !== 'primary' && styles.btnTextAlt]}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [driverToken, setDriverToken] = useState<string | null>(null);
  const [driverProfileId, setDriverProfileId] = useState<number | null>(null);
  const [staffToken, setStaffToken] = useState<string | null>(null);
  const [hub, setHub] = useState<HubConnection | null>(null);
  const [selectedDriverProfileId, setSelectedDriverProfileId] = useState<number | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [driverProfileReturn, setDriverProfileReturn] = useState<Screen>('driverTrack');
  const hubRef = useRef<HubConnection | null>(null);

  const openDriverProfile = () => {
    if (screen === 'driverWait' || screen === 'driverTrack') {
      setDriverProfileReturn(screen);
    }
    setScreen('driverProfile');
  };

  useEffect(() => {
    hubRef.current = hub;
  }, [hub]);

  const connectDriverHub = useCallback(
    async (token: string, userId: number) => {
      const connection = new HubConnectionBuilder()
        .withUrl(`${apiBase()}/hubs/transport`, {
          accessTokenFactory: () => token,
        })
        .withAutomaticReconnect()
        .build();

      connection.on('DriverApproved', () => {
        void apiFetch(
          '/api/drivers/me/presence',
          { method: 'PATCH', body: JSON.stringify({ isOnline: true }) },
          token
        );
        setScreen('driverTrack');
      });

      await connection.start();
      await connection.invoke('JoinUserChannel', userId);
      setHub(connection);
      return connection;
    },
    []
  );

  useEffect(() => {
    return () => {
      void hubRef.current?.stop();
    };
  }, []);

  const logoutDriver = useCallback(async () => {
    const token = driverToken;
    if (token) {
      try {
        await apiFetch(
          '/api/drivers/me/presence',
          { method: 'PATCH', body: JSON.stringify({ isOnline: false }) },
          token
        );
      } catch {
        // clear local session even if presence update fails
      }
    }
    try {
      await hubRef.current?.stop();
    } catch {
      // ignore
    }
    setHub(null);
    setDriverToken(null);
    setDriverProfileId(null);
    setScreen('home');
  }, [driverToken]);

  const logoutStaff = useCallback(() => {
    setStaffToken(null);
    setSelectedDriverProfileId(null);
    setSelectedTripId(null);
    setScreen('home');
  }, []);

  const onDriverLogout = () => confirmLogout(() => void logoutDriver());
  const onStaffLogout = () => confirmLogout(logoutStaff);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>Transport Logistics</Text>
      <Text style={styles.sub}>API: {apiBase()}</Text>

      {screen === 'home' && (
        <View style={[styles.section, styles.centerBlock]}>
          <AppButton title="Driver: Register" onPress={() => setScreen('driverRegister')} />
          <View style={styles.gap} />
          <AppButton title="Driver: Login" onPress={() => setScreen('driverLogin')} />
          <View style={styles.gap} />
          <AppButton title="Staff: Login" variant="secondary" onPress={() => setScreen('staffLogin')} />
        </View>
      )}

      {screen === 'driverRegister' && (
        <DriverRegister
          onDone={async () => {
            Alert.alert('Registered', 'Sign in with your phone and password.');
            setScreen('driverLogin');
          }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'driverLogin' && (
        <DriverLogin
          onSuccess={async (token, userId, profileId, approved) => {
            setDriverToken(token);
            setDriverProfileId(profileId);
            await connectDriverHub(token, userId);
            await apiFetch(
              '/api/drivers/me/presence',
              { method: 'PATCH', body: JSON.stringify({ isOnline: true }) },
              token
            );
            setScreen(approved ? 'driverTrack' : 'driverWait');
          }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'driverWait' && driverToken && (
        <DriverWait
          token={driverToken}
          onApproved={() => setScreen('driverTrack')}
          onOpenProfile={openDriverProfile}
          onLogout={onDriverLogout}
        />
      )}

      {screen === 'driverTrack' && driverToken && driverProfileId != null && (
        <DriverTrack
          token={driverToken}
          driverProfileId={driverProfileId}
          hub={hub}
          onOpenProfile={openDriverProfile}
          onLogout={onDriverLogout}
        />
      )}

      {screen === 'driverProfile' && driverToken && (
        <DriverProfile
          token={driverToken}
          onBack={() => setScreen(driverProfileReturn)}
          onLogout={onDriverLogout}
        />
      )}

      {screen === 'staffLogin' && (
        <StaffLogin
          onSuccess={(token) => {
            setStaffToken(token);
            setScreen('staffDrivers');
          }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'staffDrivers' && staffToken && (
        <StaffPickDriver
          token={staffToken}
          onPicked={(driverProfileId, tripId) => {
            setSelectedDriverProfileId(driverProfileId);
            setSelectedTripId(tripId);
            setScreen('staffScan');
          }}
          onUnload={() => {
            setSelectedDriverProfileId(null);
            setSelectedTripId(null);
            setScreen('staffUnload');
          }}
          onLogout={onStaffLogout}
        />
      )}

      {screen === 'staffScan' && staffToken && (
        <StaffScanner
          token={staffToken}
          driverProfileId={selectedDriverProfileId}
          tripId={selectedTripId}
          mode="load"
          title="Load parcels onto the selected trip"
          onBack={() => {
            setScreen('staffDrivers');
          }}
          onLogout={onStaffLogout}
        />
      )}

      {screen === 'staffUnload' && staffToken && (
        <StaffScanner
          token={staffToken}
          driverProfileId={null}
          mode="unload"
          title="Unload parcels at destination branch"
          onBack={() => setScreen('staffDrivers')}
          onLogout={onStaffLogout}
        />
      )}
    </View>
  );
}

function DriverRegister({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);

  const loadBranches = useCallback(async () => {
    setLoadingBranches(true);
    const res = await apiFetch('/api/public/branches');
    if (!res.ok) {
      setLoadingBranches(false);
      Alert.alert('Error', 'Could not load branch list.');
      return;
    }
    const data = (await res.json()) as BranchOption[];
    setBranches(data);
    if (data.length > 0) setBranchId((prev) => prev ?? data[0].id);
    setLoadingBranches(false);
  }, []);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const submit = async () => {
    if (!fullName.trim()) {
      Alert.alert('Validation', 'Enter your full name.');
      return;
    }
    if (!isValidMobile(phone)) {
      Alert.alert('Validation', 'Enter a valid mobile number (9–15 digits).');
      return;
    }
    if (!password || password.length < 6) {
      Alert.alert('Validation', 'Password must be at least 6 characters.');
      return;
    }
    if (!vehicle.trim()) {
      Alert.alert('Validation', 'Enter your vehicle number.');
      return;
    }
    if (!branchId) {
      Alert.alert('Select branch', 'Please select your home branch.');
      return;
    }
    const res = await apiFetch('/api/auth/register-driver', {
      method: 'POST',
      body: JSON.stringify({
        fullName: fullName.trim(),
        phone: normalizeMobile(phone),
        password,
        vehicleNumber: vehicle.trim(),
        branchId,
      }),
    });
    if (!res.ok) {
      Alert.alert('Error', await res.text());
      return;
    }
    onDone();
  };

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.label}>Full name</Text>
      <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />
      <Text style={styles.label}>Mobile number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="e.g. 0771234567"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Text style={styles.label}>Vehicle number</Text>
      <TextInput style={styles.input} value={vehicle} onChangeText={setVehicle} />
      <Text style={styles.label}>Home branch</Text>
      {loadingBranches ? (
        <Text style={styles.sub}>Loading branches…</Text>
      ) : branches.length === 0 ? (
        <Text style={styles.sub}>No branches found.</Text>
      ) : (
        <BranchDropdown branches={branches} value={branchId} onChange={setBranchId} />
      )}
      <AppButton title="Submit registration" onPress={() => void submit()} />
      <View style={styles.gap} />
      <AppButton title="Back" variant="secondary" onPress={onBack} />
    </ScrollView>
  );
}

function DriverLogin({
  onSuccess,
  onBack,
}: {
  onSuccess: (
    token: string,
    userId: number,
    profileId: number | null,
    approved: boolean
  ) => void;
  onBack: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const submit = async () => {
    if (!isValidMobile(phone)) {
      Alert.alert('Validation', 'Enter a valid mobile number (9–15 digits).');
      return;
    }
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: normalizeMobile(phone), password }),
    });
    if (!res.ok) {
      Alert.alert('Login failed');
      return;
    }
    const data = await res.json();
    onSuccess(
      data.accessToken as string,
      data.userId as number,
      (data.driverProfileId as number | null) ?? null,
      (data.driverApproved as boolean) ?? false
    );
  };

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Mobile number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
        placeholder="e.g. 0771234567"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <AppButton title="Login" onPress={() => void submit()} />
      <View style={styles.gap} />
      <AppButton title="Back" variant="secondary" onPress={onBack} />
    </View>
  );
}

function DriverProfile({
  token,
  onBack,
  onLogout,
}: {
  token: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, bRes] = await Promise.all([
      apiFetch('/api/drivers/me/profile', {}, token),
      apiFetch('/api/public/branches'),
    ]);
    if (bRes.ok) setBranches(await bRes.json());
    if (pRes.ok) {
      const p = (await pRes.json()) as DriverProfileData;
      setProfile(p);
      setPhone(p.phone);
      setVehicle(p.vehicleNumber);
      setBranchId(p.branchId);
    } else {
      Alert.alert('Error', 'Could not load profile.');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!isValidMobile(phone)) {
      Alert.alert('Validation', 'Enter a valid mobile number (9–15 digits).');
      return;
    }
    if (!vehicle.trim()) {
      Alert.alert('Validation', 'Enter your vehicle number.');
      return;
    }
    if (!branchId) {
      Alert.alert('Validation', 'Select your home branch.');
      return;
    }
    setSaving(true);
    const res = await apiFetch('/api/drivers/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        phone: normalizeMobile(phone),
        vehicleNumber: vehicle.trim(),
        branchId,
      }),
    }, token);
    setSaving(false);
    if (!res.ok) {
      const t = await res.text();
      Alert.alert('Could not save', t || 'Request failed');
      return;
    }
    const updated = (await res.json()) as DriverProfileData;
    setProfile(updated);
    setPhone(updated.phone);
    setVehicle(updated.vehicleNumber);
    setBranchId(updated.branchId);
    Alert.alert('Saved', 'Profile updated.');
  };

  if (loading) {
    return (
      <View style={styles.section}>
        <Text style={styles.waitText}>Loading profile…</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.section}>
        <Text style={styles.sub}>Profile not available.</Text>
        <AppButton title="Back" variant="secondary" onPress={onBack} />
        <View style={styles.gap} />
        <AppButton title="Log out" variant="danger" onPress={onLogout} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.label}>Full name</Text>
      <Text style={styles.inputReadonly}>{profile.fullName}</Text>
      <Text style={styles.label}>Mobile number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Text style={styles.label}>Vehicle number</Text>
      <TextInput style={styles.input} value={vehicle} onChangeText={setVehicle} />
      <Text style={styles.label}>Home branch</Text>
      {branches.length === 0 ? (
        <Text style={styles.sub}>No branches found.</Text>
      ) : (
        <BranchDropdown branches={branches} value={branchId} onChange={setBranchId} />
      )}
      <Text style={styles.sub}>
        Status: {profile.isApproved ? 'Approved' : 'Pending approval'}
        {profile.branchName ? ` · ${profile.branchName}` : ''}
      </Text>
      {profile.isApproved && <DriverEarningsCard token={token} />}
      <ChangePasswordForm token={token} />
      <AppButton title={saving ? 'Saving…' : 'Save profile'} disabled={saving} onPress={() => void save()} />
      <View style={styles.gap} />
      <AppButton title="Back" variant="secondary" onPress={onBack} />
      <View style={styles.gap} />
      <AppButton title="Log out" variant="danger" onPress={onLogout} />
    </ScrollView>
  );
}

function DriverWait({
  token,
  onApproved,
  onOpenProfile,
  onLogout,
}: {
  token: string;
  onApproved: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}) {
  useEffect(() => {
    const id = setInterval(async () => {
      const res = await apiFetch('/api/drivers/me/status', {}, token);
      if (!res.ok) return;
      const data = await res.json();
      if (data.isApproved) onApproved();
    }, 8000);
    return () => clearInterval(id);
  }, [token, onApproved]);

  return (
    <View style={styles.section}>
      <Text style={styles.waitText}>Waiting for admin approval…</Text>
      <Text style={styles.sub}>You will be notified when approved.</Text>
      <View style={styles.gap} />
      <AppButton title="My profile" variant="secondary" onPress={onOpenProfile} />
      <View style={styles.gap} />
      <AppButton title="Log out" variant="danger" onPress={onLogout} />
    </View>
  );
}

type TripStatePayload = {
  phase: string;
  tripId: string | null;
  destinationBranchesLabel: string | null;
  driverPaymentAmount: number | null;
  productCount: number;
};

function DriverTrack({
  token,
  driverProfileId,
  hub,
  onOpenProfile,
  onLogout,
}: {
  token: string;
  driverProfileId: number;
  hub: HubConnection | null;
  onOpenProfile: () => void;
  onLogout: () => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'idle' | 'awaiting' | 'tracking'>('loading');
  const [trip, setTrip] = useState<TripStatePayload | null>(null);
  const [gpsStatus, setGpsStatus] = useState('');
  const [earningsRefreshKey, setEarningsRefreshKey] = useState(0);

  const refreshState = useCallback(async () => {
    const res = await apiFetch('/api/drivers/me/trip-state', {}, token);
    if (!res.ok) {
      setPhase('idle');
      setTrip(null);
      setEarningsRefreshKey((k) => k + 1);
      return;
    }
    const d = (await res.json()) as TripStatePayload;
    setTrip(d);
    setEarningsRefreshKey((k) => k + 1);
    if (d.phase === 'None') {
      setPhase('idle');
    } else if (d.phase === 'AwaitingDriverStart') {
      setPhase('awaiting');
    } else if (d.phase === 'InTransit') {
      setPhase('tracking');
    } else {
      setPhase('idle');
    }
  }, [token]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (phase !== 'awaiting') return;
    const id = setInterval(() => void refreshState(), 12000);
    return () => clearInterval(id);
  }, [phase, refreshState]);

  const startTrip = async () => {
    if (!trip?.tripId) return;
    const res = await apiFetch(`/api/drivers/me/trips/${trip.tripId}/start`, { method: 'POST' }, token);
    if (!res.ok) {
      const t = await res.text();
      Alert.alert('Cannot start trip', t || 'Request failed');
      return;
    }
    await refreshState();
  };

  useEffect(() => {
    if (phase !== 'tracking') return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const run = async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setGpsStatus('location denied');
        return;
      }
      setGpsStatus('tracking');

      timer = setInterval(async () => {
        const loc = await Location.getCurrentPositionAsync({});
        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;
        if (hub && hub.state === HubConnectionState.Connected) {
          await hub.invoke('ReportLocation', lat, lng);
        } else {
          await apiFetch(
            '/api/drivers/me/location',
            {
              method: 'PATCH',
              body: JSON.stringify({ latitude: lat, longitude: lng }),
            },
            token
          );
        }
      }, 30000);

      const first = await Location.getCurrentPositionAsync({});
      if (hub && hub.state === HubConnectionState.Connected) {
        await hub.invoke('ReportLocation', first.coords.latitude, first.coords.longitude);
      } else {
        await apiFetch(
          '/api/drivers/me/location',
          {
            method: 'PATCH',
            body: JSON.stringify({ latitude: first.coords.latitude, longitude: first.coords.longitude }),
          },
          token
        );
      }
    };

    void run();
    poll = setInterval(() => void refreshState(), 45000);

    return () => {
      if (timer) clearInterval(timer);
      if (poll) clearInterval(poll);
    };
  }, [phase, token, hub, refreshState]);

  if (phase === 'loading') {
    return (
      <View style={styles.section}>
        <Text style={styles.waitText}>Loading trip…</Text>
      </View>
    );
  }

  const earningsBanner = <DriverEarningsCard token={token} refreshKey={earningsRefreshKey} />;

  if (phase === 'idle') {
    return (
      <View style={styles.section}>
        {earningsBanner}
        <Text style={styles.waitText}>No active trip</Text>
        <Text style={styles.sub}>
          When your branch manager creates a trip for you, staff can load parcels at origin. After loading, pull to
          refresh here — then start the trip to turn on GPS tracking.
        </Text>
        <AppButton title="Refresh" variant="secondary" onPress={() => void refreshState()} />
        <View style={styles.gap} />
        <AppButton title="My profile" variant="secondary" onPress={onOpenProfile} />
        <View style={styles.gap} />
        <AppButton title="Log out" variant="danger" onPress={onLogout} />
      </View>
    );
  }

  if (phase === 'awaiting' && trip) {
    const canStart = trip.productCount > 0;
    return (
      <View style={styles.section}>
        {earningsBanner}
        <Text style={styles.waitText}>Ready to depart</Text>
        <Text style={styles.sub}>To {trip.destinationBranchesLabel ?? '—'}</Text>
        <Text style={styles.sub}>
          Parcels on trip: {trip.productCount} · Trip pay {Number(trip.driverPaymentAmount ?? 0).toFixed(2)}
        </Text>
        {!canStart && (
          <Text style={styles.sub}>Wait for staff to scan at least one parcel before you start.</Text>
        )}
        <AppButton title="Start trip (GPS on)" disabled={!canStart} onPress={() => void startTrip()} />
        <View style={styles.gap} />
        <AppButton title="Refresh status" variant="secondary" onPress={() => void refreshState()} />
        <View style={styles.gap} />
        <AppButton title="My profile" variant="secondary" onPress={onOpenProfile} />
        <View style={styles.gap} />
        <AppButton title="Log out" variant="danger" onPress={onLogout} />
        <Text style={[styles.sub, { marginTop: 12 }]}>Profile #{driverProfileId}</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {earningsBanner}
      <Text style={styles.waitText}>Trip in progress · GPS ({gpsStatus || '…'})</Text>
      <Text style={styles.sub}>
        {trip?.destinationBranchesLabel
          ? `Heading to ${trip.destinationBranchesLabel}`
          : 'Reporting location every 30s.'}
      </Text>
      <Text style={styles.sub}>Profile #{driverProfileId}</Text>
      <AppButton title="Refresh trip status" variant="secondary" onPress={() => void refreshState()} />
      <View style={styles.gap} />
      <AppButton title="My profile" variant="secondary" onPress={onOpenProfile} />
      <View style={styles.gap} />
      <AppButton title="Log out" variant="danger" onPress={onLogout} />
    </View>
  );
}

function StaffLogin({
  onSuccess,
  onBack,
}: {
  onSuccess: (token: string) => void;
  onBack: () => void;
}) {
  const [phone, setPhone] = useState('staff');
  const [password, setPassword] = useState('Staff123!');

  const submit = async () => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });
    if (!res.ok) {
      Alert.alert('Login failed');
      return;
    }
    const data = await res.json();
    if (data.role !== 'Staff') {
      Alert.alert('Use a staff account');
      return;
    }
    onSuccess(data.accessToken as string);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Staff phone</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <AppButton title="Login" onPress={() => void submit()} />
      <View style={styles.gap} />
      <AppButton title="Back" variant="secondary" onPress={onBack} />
    </View>
  );
}

function StaffPickDriver({
  token,
  onPicked,
  onUnload,
  onLogout,
}: {
  token: string;
  onPicked: (driverProfileId: number, tripId: string) => void;
  onUnload: () => void;
  onLogout: () => void;
}) {
  const [rows, setRows] = useState<
    {
      tripId: string;
      driverProfileId: number;
      fullName: string;
      vehicleNumber: string;
      destinationBranchesLabel: string;
      driverPaymentAmount: number;
    }[]
  >([]);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/staff/available-drivers', {}, token);
    if (res.ok) setRows(await res.json());
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Trips ready for loading (your branch)</Text>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.tripId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowText}>
              {item.fullName} · {item.vehicleNumber}
              {'\n'}
              <Text style={styles.sub}>
                To {item.destinationBranchesLabel} · trip pay {Number(item.driverPaymentAmount).toFixed(2)}
              </Text>
            </Text>
            <AppButton
              title="Select"
              compact
              onPress={() => onPicked(item.driverProfileId, item.tripId)}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.sub}>
            No trips awaiting load. A branch manager must create a trip first (driver + destination(s) + payment).
          </Text>
        }
      />
      <AppButton title="Refresh list" variant="secondary" onPress={() => void load()} />
      <ChangePasswordForm token={token} />
      <View style={styles.gap} />
      <AppButton title="Unload at destination branch" onPress={onUnload} />
      <View style={styles.gap} />
      <AppButton title="Log out" variant="danger" onPress={onLogout} />
    </View>
  );
}

function StaffScanner({
  token,
  driverProfileId,
  tripId,
  mode,
  title,
  onBack,
  onLogout,
}: {
  token: string;
  driverProfileId: number | null;
  tripId?: string | null;
  mode: 'load' | 'unload';
  title: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState<{ id: string; tracking: string }[]>([]);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const lastScanRef = useRef<{ data: string; at: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setPermission(status === 'granted');
    })();
  }, []);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (!scanning || inFlightRef.current) return;
    const now = Date.now();
    const last = lastScanRef.current;
    // Camera callbacks can fire many times for the same QR while it stays in frame.
    if (last && last.data === data && now - last.at < 1500) return;
    lastScanRef.current = { data, at: now };
    inFlightRef.current = true;
    setScanning(false);
    setScanError(null);
    const lookupMode = mode === 'unload' ? '&mode=unload' : '';
    const res = await apiFetch(
      `/api/staff/products/lookup?tracking=${encodeURIComponent(data)}${lookupMode}`,
      {},
      token
    );
    if (!res.ok) {
      const message = await res.text();
      setScanError(message || 'Lookup failed.');
      inFlightRef.current = false;
      setScanning(true);
      return;
    }
    const p = await res.json();
    setScanned((prev) => {
      if (prev.some((x) => x.id === p.id)) return prev;
      return [...prev, { id: p.id as string, tracking: p.trackingNumber as string }];
    });
    inFlightRef.current = false;
    setScanning(true);
  };

  const confirmLoad = async () => {
    if (mode === 'unload') {
      if (scanned.length === 0) {
        Alert.alert('Scan at least one parcel');
        return;
      }
      const res = await apiFetch(
        '/api/trips/unload',
        {
          method: 'POST',
          body: JSON.stringify({
            productIds: scanned.map((s) => s.id),
          }),
        },
        token
      );
      if (!res.ok) {
        Alert.alert('Unload failed', await res.text());
        return;
      }
      Alert.alert('Unload confirmed');
      setScanned([]);
      setScanning(false);
      lastScanRef.current = null;
      setScanError('Unload confirmed. Tap "Resume scan" to scan more parcels.');
      return;
    }

    if (driverProfileId == null) {
      Alert.alert('Select a trip first');
      return;
    }
    if (!tripId) {
      Alert.alert('Missing trip', 'Go back and select a trip that is ready for loading.');
      return;
    }
    if (scanned.length === 0) {
      Alert.alert('Scan at least one parcel');
      return;
    }
    const res = await apiFetch('/api/trips/load', {
      method: 'POST',
      body: JSON.stringify({
        tripId,
        driverProfileId,
        productIds: scanned.map((s) => s.id),
      }),
    }, token);
    if (!res.ok) {
      Alert.alert('Load failed', await res.text());
      return;
    }
    Alert.alert('Load confirmed');
    setScanned([]);
    setScanning(false);
    lastScanRef.current = null;
    setScanError('Load confirmed. Tap "Resume scan" to scan more parcels.');
  };

  if (permission === null) return <Text style={styles.sub}>Requesting camera…</Text>;
  if (permission === false) return <Text style={styles.sub}>Camera permission denied</Text>;

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{title}</Text>
      <View style={{ height: 220 }}>
        <CameraView
          facing="back"
          style={StyleSheet.absoluteFillObject}
          barcodeScannerSettings={{
            barcodeTypes: [
              'qr',
              'code128',
              'code39',
              'codabar',
              'ean13',
              'ean8',
              'upc_a',
              'upc_e',
              'pdf417',
              'aztec',
              'datamatrix',
              'code93',
              'itf14',
            ],
          }}
          onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
        />
      </View>
      <Text style={styles.label}>Scanned items</Text>
      {scanError && <Text style={styles.sub}>{scanError}</Text>}
      <FlatList
        data={scanned}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Text style={styles.rowText}>
            {item.tracking} ({item.id.slice(0, 8)}…)
          </Text>
        )}
      />
      <AppButton
        title={mode === 'unload' ? 'Confirm unload' : 'Confirm load'}
        onPress={() => void confirmLoad()}
      />
      <View style={styles.gap} />
      <AppButton
        title={scanning ? 'Pause scan' : 'Resume scan'}
        onPress={() => {
          setScanError(null);
          setScanning((v) => !v);
        }}
        variant="secondary"
      />
      <View style={styles.gap} />
      <AppButton title="Back" variant="secondary" onPress={onBack} />
      <View style={styles.gap} />
      <AppButton title="Log out" variant="danger" onPress={onLogout} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#020617' },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 4 },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  section: { gap: 8 },
  centerBlock: { flex: 1, justifyContent: 'center' },
  form: {
    gap: 8,
    paddingBottom: 32,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#0f172a',
  },
  label: { color: '#cbd5e1', marginTop: 8, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    backgroundColor: '#020617',
  },
  inputReadonly: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    color: '#94a3b8',
    backgroundColor: '#1e293b',
  },
  earningsCard: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4c1d95',
    backgroundColor: '#1e1b4b',
  },
  earningsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c4b5fd',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  earningsDueLabel: {
    marginTop: 8,
    fontSize: 13,
    color: '#94a3b8',
  },
  earningsDueValue: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '700',
    color: '#fbbf24',
  },
  earningsMeta: {
    marginTop: 8,
    fontSize: 12,
    color: '#94a3b8',
  },
  gap: { height: 12 },
  passwordBlock: {
    marginTop: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e2e8f0',
    marginBottom: 8,
  },
  waitText: { color: '#fff', fontSize: 18, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  rowText: { color: '#e2e8f0', flex: 1, paddingRight: 8 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#020617',
    gap: 8,
  },
  dropdownDisabled: { opacity: 0.45 },
  dropdownPressed: { opacity: 0.85 },
  dropdownText: { flex: 1, color: '#e2e8f0', fontSize: 15 },
  dropdownPlaceholder: { color: '#64748b' },
  dropdownChevron: { color: '#94a3b8', fontSize: 14 },
  dropdownBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
  },
  dropdownSheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingTop: 16,
    paddingBottom: 24,
  },
  dropdownSheetTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  dropdownList: { maxHeight: 360 },
  dropdownOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  dropdownOptionSelected: { backgroundColor: '#312e81' },
  dropdownOptionText: { color: '#e2e8f0', fontSize: 15 },
  dropdownOptionTextSelected: { color: '#fff', fontWeight: '600' },
  btnBase: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    borderWidth: 1,
    borderColor: '#818cf8',
  },
  btnSecondary: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  btnDanger: {
    backgroundColor: '#b91c1c',
    borderColor: '#ef4444',
  },
  btnCompact: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  btnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  btnTextAlt: {
    color: '#e2e8f0',
  },
});
