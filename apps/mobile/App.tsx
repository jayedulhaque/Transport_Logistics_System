import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
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
  | 'staffScan';

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
          <Button title="Driver: register" onPress={() => setScreen('driverRegister')} />
          <View style={styles.gap} />
          <Button title="Driver: login" onPress={() => setScreen('driverLogin')} />
          <View style={styles.gap} />
          <Button title="Staff: login" onPress={() => setScreen('staffLogin')} />
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
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'staffScan' && staffToken && (
        <StaffScanner
          token={staffToken}
          driverProfileId={selectedDriverProfileId}
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
  const [branchId, setBranchId] = useState('1');

  const submit = async () => {
    const res = await apiFetch('/api/auth/register-driver', {
      method: 'POST',
      body: JSON.stringify({
        fullName,
        phone,
        password,
        vehicleNumber: vehicle,
        branchId: Number(branchId),
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
      <Text style={styles.label}>Home branch id</Text>
      <TextInput style={styles.input} value={branchId} onChangeText={setBranchId} keyboardType="number-pad" />
      <Button title="Submit registration" onPress={() => void submit()} />
      <View style={styles.gap} />
      <Button title="Back" onPress={onBack} />
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
      <Button title="Login" onPress={() => void submit()} />
      <View style={styles.gap} />
      <Button title="Back" onPress={onBack} />
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
      <Button title="Login" onPress={() => void submit()} />
      <View style={styles.gap} />
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

function StaffPickDriver({
  token,
  onPicked,
  onBack,
}: {
  token: string;
  onPicked: (driverProfileId: number) => void;
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
            <Button title="Select" onPress={() => onPicked(item.driverProfileId)} />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No drivers online. Drivers must mark presence.</Text>}
      />
      <Button title="Refresh" onPress={() => void load()} />
      <View style={styles.gap} />
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

function StaffScanner({
  token,
  driverProfileId,
  onBack,
}: {
  token: string;
  driverProfileId: number | null;
  onBack: () => void;
}) {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState<{ id: string; tracking: string }[]>([]);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    void (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setPermission(status === 'granted');
    })();
  }, []);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (!scanning) return;
    setScanning(false);
    const res = await apiFetch(
      `/api/staff/products/lookup?tracking=${encodeURIComponent(data)}`,
      {},
      token
    );
    if (!res.ok) {
      Alert.alert('Lookup failed', await res.text());
      setScanning(true);
      return;
    }
    const p = await res.json();
    setScanned((prev) => {
      if (prev.some((x) => x.id === p.id)) return prev;
      return [...prev, { id: p.id as string, tracking: p.trackingNumber as string }];
    });
    setScanning(true);
  };

  const confirmLoad = async () => {
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
  };

  if (permission === null) return <Text style={styles.sub}>Requesting camera…</Text>;
  if (permission === false) return <Text style={styles.sub}>Camera permission denied</Text>;

  return (
    <View style={{ flex: 1 }}>
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
      <FlatList
        data={scanned}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Text style={styles.rowText}>
            {item.tracking} ({item.id.slice(0, 8)}…)
          </Text>
        )}
      />
      <Button title="Confirm load" onPress={() => void confirmLoad()} />
      <View style={styles.gap} />
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#0f172a' },
  title: { fontSize: 22, fontWeight: '600', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  section: { gap: 8 },
  form: { gap: 8, paddingBottom: 32 },
  label: { color: '#cbd5e1', marginTop: 8 },
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
});
