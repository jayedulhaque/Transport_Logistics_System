import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
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
  | 'staffLogin'
  | 'staffDrivers'
  | 'staffScan'
  | 'staffUnload';

type BranchOption = {
  id: number;
  branchName: string;
  code: string;
};

function AppButton({
  title,
  onPress,
  variant = 'primary',
  compact = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btnBase,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'danger' && styles.btnDanger,
        compact && styles.btnCompact,
        pressed && styles.btnPressed,
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
  const hubRef = useRef<HubConnection | null>(null);

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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>Transport Logistics</Text>
      <Text style={styles.sub}>API: {apiBase()}</Text>

      {screen === 'home' && (
        <View style={styles.section}>
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
        <DriverWait token={driverToken} onApproved={() => setScreen('driverTrack')} />
      )}

      {screen === 'driverTrack' && driverToken && driverProfileId != null && (
        <DriverTrack token={driverToken} driverProfileId={driverProfileId} hub={hub} />
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
          onPicked={(id) => {
            setSelectedDriverProfileId(id);
            setScreen('staffScan');
          }}
          onUnload={() => {
            setSelectedDriverProfileId(null);
            setScreen('staffUnload');
          }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'staffScan' && staffToken && (
        <StaffScanner
          token={staffToken}
          driverProfileId={selectedDriverProfileId}
          mode="load"
          title="Load parcels to selected driver"
          onBack={() => setScreen('staffDrivers')}
        />
      )}

      {screen === 'staffUnload' && staffToken && (
        <StaffScanner
          token={staffToken}
          driverProfileId={null}
          mode="unload"
          title="Unload parcels at destination branch"
          onBack={() => setScreen('staffDrivers')}
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
    if (!branchId) {
      Alert.alert('Select branch', 'Please select your home branch.');
      return;
    }
    const res = await apiFetch('/api/auth/register-driver', {
      method: 'POST',
      body: JSON.stringify({
        fullName,
        phone,
        password,
        vehicleNumber: vehicle,
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
      <Text style={styles.label}>Mobile / login id</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} />
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
      ) : (
        <View style={styles.branchList}>
          {branches.map((b) => {
            const selected = branchId === b.id;
            return (
              <Text
                key={b.id}
                onPress={() => setBranchId(b.id)}
                style={[styles.branchOption, selected && styles.branchOptionSelected]}
              >
                {b.branchName} ({b.code})
              </Text>
            );
          })}
          {branches.length === 0 && <Text style={styles.sub}>No branches found.</Text>}
        </View>
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
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
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
      <Text style={styles.label}>Phone</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} autoCapitalize="none" />
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

function DriverWait({
  token,
  onApproved,
}: {
  token: string;
  onApproved: () => void;
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
    </View>
  );
}

function DriverTrack({
  token,
  driverProfileId,
  hub,
}: {
  token: string;
  driverProfileId: number;
  hub: HubConnection | null;
}) {
  const [status, setStatus] = useState('starting');

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setStatus('location denied');
        return;
      }
      setStatus('tracking');

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
      }
    };

    void run();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [token, driverProfileId, hub]);

  return (
    <View style={styles.section}>
      <Text style={styles.waitText}>Trip / GPS ({status})</Text>
      <Text style={styles.sub}>Reporting location every 30s. Profile #{driverProfileId}</Text>
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
  onBack,
}: {
  token: string;
  onPicked: (driverProfileId: number) => void;
  onUnload: () => void;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<{ driverProfileId: number; fullName: string; vehicleNumber: string }[]>(
    []
  );

  const load = useCallback(async () => {
    const res = await apiFetch('/api/staff/available-drivers', {}, token);
    if (res.ok) setRows(await res.json());
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Online drivers at your branch</Text>
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.driverProfileId)}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowText}>
              {item.fullName} · {item.vehicleNumber}
            </Text>
            <AppButton
              title="Select"
              compact
              onPress={() => onPicked(item.driverProfileId)}
            />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No drivers online. Drivers must mark presence.</Text>}
      />
      <AppButton title="Refresh list" variant="secondary" onPress={() => void load()} />
      <View style={styles.gap} />
      <AppButton title="Unload at destination branch" onPress={onUnload} />
      <View style={styles.gap} />
      <AppButton title="Back" variant="secondary" onPress={onBack} />
    </View>
  );
}

function StaffScanner({
  token,
  driverProfileId,
  mode,
  title,
  onBack,
}: {
  token: string;
  driverProfileId: number | null;
  mode: 'load' | 'unload';
  title: string;
  onBack: () => void;
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
      Alert.alert('Select a driver first');
      return;
    }
    if (scanned.length === 0) {
      Alert.alert('Scan at least one parcel');
      return;
    }
    const res = await apiFetch('/api/trips/load', {
      method: 'POST',
      body: JSON.stringify({
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#020617' },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 4 },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  section: { gap: 8 },
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
  gap: { height: 12 },
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
  branchList: { gap: 8 },
  branchOption: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    color: '#e2e8f0',
    backgroundColor: '#020617',
  },
  branchOptionSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#312e81',
    color: '#fff',
  },
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
