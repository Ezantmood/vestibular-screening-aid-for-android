import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { APP_NAME, APP_TAGLINE, MVP_TESTS } from '../../config/constants';
import Camera2ProbeScreen from './Camera2ProbeScreen';

export default function HomeScreen() {
  const [showProbe, setShowProbe] = useState(false);

  if (showProbe) {
    return (
      <View style={styles.probeWrapper}>
        <Button title="Back" onPress={() => setShowProbe(false)} />
        <Camera2ProbeScreen />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="home-screen">
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.subtitle}>{APP_TAGLINE}</Text>
      <Text style={styles.body}>Bootstrap OK — MVP tests: {MVP_TESTS.join(' + ')}</Text>
      <Text style={styles.note}>Screening aid, not a diagnostic device.</Text>
      <Button title="Camera2 capability probe (P0.1)" onPress={() => setShowProbe(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#fff',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    textAlign: 'center',
  },
  note: {
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
  probeWrapper: {
    backgroundColor: '#fff',
    flex: 1,
    paddingTop: 48,
  },
});
